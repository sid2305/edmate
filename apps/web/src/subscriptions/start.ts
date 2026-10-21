// Task 9.3 Phase B: the no-payment package-start route. Until M10 a paid package starts as an
// active subscription with no payment call anywhere (checkout is 10.8). The route never trusts a
// client-given `version` or `packageVersionId`: the body is only `{ agentId, packageId }`, and the
// package version is looked up server-side from the agent's own live packages.
import type { LivePackage, Repositories, StudentScope } from '@edmate/db';
import { RepositoryError } from '@edmate/db';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { serverDatabase } from '../auth';
import { apiError } from '../auth/errors';
import type { RoleContext } from '../auth/guard';
import { MAX_BODY_BYTES, readJson, TOO_LARGE } from '../studio/routes';

/** Everything the start route needs: the agent/package/subscription repos, built once per process. */
export interface StartBackend {
  repos(): Pick<Repositories, 'agents' | 'packageVersions' | 'subscriptions'>;
}

const BodySchema = z.strictObject({
  agentId: z.string().min(1).max(200),
  packageId: z.string().min(1).max(200),
});

/** A no-payment subscription runs for 30 days when active, or the package's own trial length. */
const DEFAULT_PERIOD_DAYS = 30;

const MSG = {
  validation: 'Check the request and try again.',
  bodyTooLarge: 'The request is too large.',
  notFound: 'That package was not found.',
  alreadySubscribed: 'You already have a package with this teacher.',
  failed: 'Something went wrong. Try again.',
} as const;

const ok = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const validation = () => apiError('validation', MSG.validation, 400);
const tooLarge = () => apiError('input_too_large', MSG.bodyTooLarge, 413);
const notFound = () => apiError('not_found', MSG.notFound, 404);

/** A thrown `RepositoryError`'s kind mapped to this route's fixed response; anything else is 500. */
function fromError(error: unknown): Response {
  if (error instanceof RepositoryError) {
    switch (error.kind) {
      case 'not_found':
      case 'scope':
        return notFound();
      case 'invalid':
        // The one-live-row-per-pair unique index: this pair already has a live subscription.
        return apiError('validation', MSG.alreadySubscribed, 409);
      case 'integrity':
        return validation();
      case 'failed':
        return apiError('provider_error', MSG.failed, 500);
    }
  }
  return apiError('provider_error', MSG.failed, 500);
}

function findPackage(packages: LivePackage[], packageId: string): LivePackage | null {
  return packages.find((p) => p.config.id === packageId) ?? null;
}

/** `status`/`periodEnd` from the package's own `trialDays` (9.3 Phase B's own call, logged). */
function startParams(pkg: LivePackage, now: Date): { status: 'trial' | 'active'; periodEnd: string } {
  const trialDays = pkg.config.trialDays;
  if (trialDays !== undefined && trialDays > 0) {
    const periodEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
    return { status: 'trial', periodEnd: periodEnd.toISOString() };
  }
  const periodEnd = new Date(now.getTime() + DEFAULT_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return { status: 'active', periodEnd: periodEnd.toISOString() };
}

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

/** The start handler over an injected backend (no database in tests; rule 4). */
export function createSubscriptionHandlers(backend: StartBackend): { start: Handler } {
  const start: Handler = async (req, ctx) => {
    const raw = await readJson(req);
    if (raw === TOO_LARGE) return tooLarge();
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) return validation();
    const { agentId, packageId } = parsed.data;
    const repos = backend.repos();
    try {
      const owner = await repos.agents.owner({ agentId });
      if (owner === null) return notFound();
      const packages = await repos.packageVersions.liveForAgent({ agentId });
      const pkg = findPackage(packages, packageId);
      if (pkg === null) return notFound();
      const scope: StudentScope = { studentId: ctx.principal.userId, teacherId: owner.teacherId };
      const { status, periodEnd } = startParams(pkg, new Date());
      const subscription = await repos.subscriptions.start(scope, {
        packageVersionId: pkg.packageVersionId,
        status,
        periodEnd,
      });
      return ok({ subscription }, 201);
    } catch (error) {
      return fromError(error);
    }
  };
  return { start };
}

export { MAX_BODY_BYTES };

/** Wired to the shared auth runtime's database (same memoised pool the other routes use). */
export const subscriptionHandlers = createSubscriptionHandlers({
  repos: () => serverDatabase().repos,
});
