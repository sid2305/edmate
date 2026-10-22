// Task 9.6 Phase D: `PATCH /api/subscriptions/[id]` -- upgrade, downgrade, switch (all mapped by
// the repository as `change`), pause, resume and cancel. No payment exists yet (9.6c, Q1 = (a)):
// every action applies at once. The scope always comes from `studentTurnScope` (the signed-in
// student plus the live agent's own teacher) -- a client-given `studentId`, `status` or
// `packageVersionId` is never read, and the body is a strict discriminated union so one can't
// even be sent. `packageId` (the public offer's id) is mapped to the real `packageVersionId`
// server-side via `packageVersions.liveForAgent`, never trusted from the client.
import type { LiveSubscription, Repositories } from '@edmate/db';
import { RepositoryError } from '@edmate/db';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { serverDatabase } from '../auth';
import { apiError } from '../auth/errors';
import type { RoleContext } from '../auth/guard';
import { StartSessionSchema } from '../turn/clientInput';
import { studentTurnScope, type AgentOwners } from '../turn/scope';

/** Everything the plan-change route needs, built once per process or per test (rule 4). */
export interface PlanBackend {
  agents: AgentOwners;
  packageVersions: Pick<Repositories['packageVersions'], 'liveForAgent' | 'getById'>;
  subscriptions: Pick<
    Repositories['subscriptions'],
    'findLive' | 'changePackage' | 'pause' | 'resume' | 'cancel'
  >;
}

const AgentIdSchema = StartSessionSchema.shape.agentId;
const PackageIdSchema = z.string().min(1).max(200);
/** The URL's `[id]`: compared against `findLive(scope).id`, never used to widen a query itself. */
const SubscriptionIdSchema = z.string().min(1).max(200);

const BodySchema = z.discriminatedUnion('action', [
  z.strictObject({ agentId: AgentIdSchema, action: z.literal('change'), packageId: PackageIdSchema }),
  z.strictObject({ agentId: AgentIdSchema, action: z.literal('pause') }),
  z.strictObject({ agentId: AgentIdSchema, action: z.literal('resume') }),
  z.strictObject({ agentId: AgentIdSchema, action: z.literal('cancel') }),
]);
type Body = z.infer<typeof BodySchema>;

const MSG = {
  bodyTooLarge: 'The request is too large.',
  validation: 'Check the request and try again.',
  notFound: 'That plan was not found.',
  failed: 'Something went wrong. Try again.',
  invalidChange: "That package isn't available right now.",
  invalidPause: "This plan can't be paused right now.",
  invalidResume: "This plan can't be resumed right now.",
  invalidCancel: "This plan can't be cancelled right now.",
} as const;

/** The fixed 409 text for each action's `invalid` kind (the plan page decides its own copy for a
 * refused resume -- "paused by Edmate" -- rather than reading this message). */
const INVALID_MSG: Record<Body['action'], string> = {
  change: MSG.invalidChange,
  pause: MSG.invalidPause,
  resume: MSG.invalidResume,
  cancel: MSG.invalidCancel,
};

const ok = (body: unknown) =>
  Response.json(body, { status: 200, headers: { 'cache-control': 'no-store' } });
const tooLarge = () => apiError('input_too_large', MSG.bodyTooLarge, 413);
const validation = () => apiError('validation', MSG.validation, 400);
const notFound = () => apiError('not_found', MSG.notFound, 404);
const failed = () => apiError('provider_error', MSG.failed, 500);

/** The largest body this route reads (bytes); the JSON bodies here are tiny. */
export const MAX_BODY_BYTES = 64 * 1024;

const TOO_LARGE = Symbol('too large');

/** The body's bytes, or TOO_LARGE as soon as more than the cap has been read. */
async function readCapped(body: ReadableStream<Uint8Array>): Promise<Uint8Array | typeof TOO_LARGE> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      void reader.cancel().catch(() => undefined);
      return TOO_LARGE;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return bytes;
}

/** The body as JSON, `undefined` when it is not JSON or can't be read, or TOO_LARGE. */
async function readJson(req: Request): Promise<unknown> {
  if (Number(req.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return TOO_LARGE;
  if (req.body === null) return undefined;
  try {
    const bytes = await readCapped(req.body);
    if (bytes === TOO_LARGE) return TOO_LARGE;
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

/** The error's constructor name only -- never its message, which can carry a method name or
 * ids (same convention as `export/routes.ts`; task 9.6i). */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** A 500, logging only the error's name (task 9.6i). */
function failedLogged(error: unknown): Response {
  console.error(`[subscriptions] ${errorName(error)}`);
  return failed();
}

/** A thrown `RepositoryError`'s kind mapped to this route's fixed response per action. */
function fromError(error: unknown, action: Body['action']): Response {
  if (!(error instanceof RepositoryError)) return failedLogged(error);
  switch (error.kind) {
    case 'not_found':
    case 'scope':
      return notFound();
    case 'invalid':
      return apiError('validation', INVALID_MSG[action], 409);
    case 'integrity':
      return validation();
    case 'failed':
      return failedLogged(error);
    default: {
      const _exhaustive: never = error.kind;
      return _exhaustive;
    }
  }
}

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

/** The plan-change PATCH handler over an injected backend (no database in tests; rule 4). */
export function createPlanHandlers(backend: PlanBackend): { patch: Handler } {
  const patch: Handler = async (req, ctx) => {
    const rawParams = (await ctx.params) as { id?: unknown } | undefined;
    const idParsed = SubscriptionIdSchema.safeParse(rawParams?.id);
    if (!idParsed.success) return notFound();
    const subscriptionId = idParsed.data;

    const raw = await readJson(req);
    if (raw === TOO_LARGE) return tooLarge();
    const body = BodySchema.safeParse(raw);
    if (!body.success) return validation();

    const scope = await studentTurnScope(backend.agents, ctx.principal, body.data.agentId);
    if (scope === null) return notFound();

    try {
      const live = await backend.subscriptions.findLive(scope);
      if (live === null || live.id !== subscriptionId) return notFound();

      let result: LiveSubscription;
      if (body.data.action === 'change') {
        const { agentId, packageId } = body.data;
        const offers = await backend.packageVersions.liveForAgent({ agentId });
        const match = offers.find((o) => o.offer.packageId === packageId);
        if (!match) return notFound();
        result = await backend.subscriptions.changePackage(scope, {
          subscriptionId,
          packageVersionId: match.packageVersionId,
        });
      } else if (body.data.action === 'pause') {
        result = await backend.subscriptions.pause(scope, { subscriptionId });
      } else if (body.data.action === 'resume') {
        result = await backend.subscriptions.resume(scope, { subscriptionId });
      } else {
        result = await backend.subscriptions.cancel(scope, { subscriptionId });
      }

      const config = await backend.packageVersions.getById(
        { teacherId: scope.teacherId },
        result.packageVersionId,
      );
      // A write that succeeds names a real package_versions row (the FK guarantees it); if the
      // lookup still misses, fail closed rather than return an empty or guessed packageId.
      if (config === null) {
        throw new RepositoryError('integrity', 'subscriptions.change');
      }
      return ok({ status: result.status, packageId: config.id });
    } catch (error) {
      return fromError(error, body.data.action);
    }
  };
  return { patch };
}

/** Wired to the shared auth runtime's database (same memoised pool the other routes use). */
export const planHandlers: { patch: Handler } = createPlanHandlers({
  agents: { owner: (scope) => serverDatabase().repos.agents.owner(scope) },
  packageVersions: {
    liveForAgent: (scope) => serverDatabase().repos.packageVersions.liveForAgent(scope),
    getById: (scope, id) => serverDatabase().repos.packageVersions.getById(scope, id),
  },
  subscriptions: {
    findLive: (scope) => serverDatabase().repos.subscriptions.findLive(scope),
    changePackage: (scope, input) => serverDatabase().repos.subscriptions.changePackage(scope, input),
    pause: (scope, input) => serverDatabase().repos.subscriptions.pause(scope, input),
    resume: (scope, input) => serverDatabase().repos.subscriptions.resume(scope, input),
    cancel: (scope, input) => serverDatabase().repos.subscriptions.cancel(scope, input),
  },
});
