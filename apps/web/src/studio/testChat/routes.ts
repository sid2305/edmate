// The teacher's test-chat API (task 8.5 Phase B): a teacher previews one of their own agent's
// packages as a student would see it, and corrects a wrong answer. Four handlers, each wrapped by
// the route files in `withRole(['teacher'], …)` (ROUTE_POLICY `/api/studio/**`):
//
// - `GET  /api/studio/agents/:agentId/packages`       → listPackages
// - `POST /api/studio/agents/:agentId/test-sessions`  → startTestSession
// - `POST /api/studio/test-sessions/:id/turns`        → postTestTurn (SSE)
// - `POST /api/studio/corrections`                    → postCorrection
//
// A preview turn is the student turn's pipeline (`runTurn`, the same SSE wire format and body
// rules) with `entitlementSource: 'teacher_preview'`: the student is the teacher themself, any
// agent status is allowed, and the package is the session's own, at its newest version.
import type { EntitlementStore } from '@edmate/contracts';
import {
  RepositoryError,
  type CorrectionRecordInput,
  type CorrectionRecordResult,
  type StudentScope,
  type TeacherPackageSummary,
  type TeacherScope,
} from '@edmate/db';
import { runTurn, type Cancel, type PipelineDeps, type Steps } from '@edmate/harness';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError } from '../../auth/errors';
import type { RoleContext } from '../../auth/guard';
import { ClientTurnSchema, StartSessionSchema, toTurnInput } from '../../turn/clientInput';
import {
  errorName,
  MAX_BODY_BYTES,
  sseBody,
  TurnUnavailableError,
  type ServerLog,
} from '../../turn/routes';
import { previewScope, teacherTestChatScope, type TeacherAgents } from './scope';

/** A preview session as the turn route needs it. */
export interface TestSessionRow {
  agentId: string;
  endedAt: string | null;
  /** The package the session was started on; null only on very old sessions. */
  packageId: string | null;
}

/** Everything the four routes need, built once per process (runtime.ts) or per test. */
export interface TestChatBackend {
  agents: TeacherAgents;
  agentVersions: {
    latest(scope: TeacherScope, agentId: string): Promise<{ version: number } | null>;
  };
  packageVersions: {
    listForAgent(scope: TeacherScope, agentId: string): Promise<TeacherPackageSummary[]>;
  };
  sessions: {
    create(
      scope: StudentScope,
      input: { agentId: string; agentVersion: number; packageId: string; packageVersion: number },
    ): Promise<{ id: string }>;
    get(scope: StudentScope, sessionId: string): Promise<TestSessionRow | null>;
  };
  corrections: {
    record(scope: TeacherScope, input: CorrectionRecordInput): Promise<CorrectionRecordResult>;
  };
  /** A `teacher_preview` entitlement store for one package (its newest version). */
  previewEntitlements(packageId: string): EntitlementStore;
  /** One preview turn's pipeline dependencies (the teacher as the student, one package). */
  depsFor(scope: StudentScope, packageId: string): PipelineDeps;
  steps: Steps;
  now(): Date;
  log: ServerLog;
}

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  'x-accel-buffering': 'no',
} as const;
const NO_STORE = { 'cache-control': 'no-store' } as const;

const Id = StartSessionSchema.shape.agentId;
const AgentParams = z.object({ agentId: Id });
const SessionParams = z.object({ id: Id });
const StartTestSessionSchema = z.strictObject({ packageId: Id });
/** Lengths and blanks are the repository's rule (`invalid` → 400); the body cap bounds size. */
const CorrectionSchema = z.strictObject({
  moduleId: Id,
  question: z.string(),
  badAnswer: z.string(),
  correctedAnswer: z.string(),
});

const MSG = {
  validation: 'Check the request and try again.',
  agent: 'That agent is not available.',
  package: 'That package is not available.',
  session: 'That test chat is not available.',
  module: 'That module is not available.',
  unavailable: 'Test chat is not available right now. Try again soon.',
  failed: 'Something went wrong. Try again.',
} as const;

const notFound = (message: string) => apiError('not_found', message, 404);
const validation = () => apiError('validation', MSG.validation, 400);
const tooLarge = () => apiError('input_too_large', 'The request is too large.', 413);

const TOO_LARGE = Symbol('too large');

/**
 * The body as JSON, `undefined` when it is not JSON or can't be read, or TOO_LARGE: a declared
 * content-length over the cap is refused before reading, and the bytes read are capped too (the
 * student turn route's rule, `MAX_BODY_BYTES`).
 */
async function readJson(req: Request): Promise<unknown> {
  if (Number(req.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return TOO_LARGE;
  if (req.body === null) return undefined;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
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
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

/** The request's abort as the harness's runtime-neutral cancel. */
function cancelOf(signal: AbortSignal): Cancel {
  return {
    onCancel(fn) {
      if (signal.aborted) fn();
      else signal.addEventListener('abort', () => fn(), { once: true });
    },
  };
}

/** The four handlers over a lazily built backend. */
export function createTestChatHandlers(backend: () => Promise<TestChatBackend>) {
  async function load(): Promise<TestChatBackend | Response> {
    try {
      return await backend();
    } catch {
      // The runtime logs the reason once; nothing about it reaches the client.
      return apiError('provider_error', MSG.unavailable, 503);
    }
  }

  function failed(b: TestChatBackend, event: string, error: unknown): Response {
    b.log.error(event, { error: errorName(error) });
    if (error instanceof TurnUnavailableError) {
      return apiError('provider_error', MSG.unavailable, 503);
    }
    return apiError('provider_error', MSG.failed, 500);
  }

  async function listPackages(_req: NextRequest, { principal, params }: RoleContext): Promise<Response> {
    const path = AgentParams.safeParse(await params);
    if (!path.success) return notFound(MSG.agent);
    const { agentId } = path.data;
    const b = await load();
    if (b instanceof Response) return b;
    try {
      const scope = await teacherTestChatScope(b.agents, principal, agentId);
      if (scope === null) return notFound(MSG.agent);
      const packages = await b.packageVersions.listForAgent(scope, agentId);
      return Response.json({ packages }, { status: 200, headers: NO_STORE });
    } catch (error) {
      return failed(b, 'testChat.packages_failed', error);
    }
  }

  async function startTestSession(req: NextRequest, { principal, params }: RoleContext): Promise<Response> {
    const path = AgentParams.safeParse(await params);
    if (!path.success) return notFound(MSG.agent);
    const { agentId } = path.data;
    const raw = await readJson(req);
    if (raw === TOO_LARGE) return tooLarge();
    const body = StartTestSessionSchema.safeParse(raw);
    if (!body.success) return validation();
    const b = await load();
    if (b instanceof Response) return b;
    try {
      const scope = await teacherTestChatScope(b.agents, principal, agentId);
      if (scope === null) return notFound(MSG.agent);
      // The same resolve the turn's `entitle` step will make: own agent, this agent's package.
      const entitlement = await b
        .previewEntitlements(body.data.packageId)
        .resolve({ studentId: scope.teacherId, agentId, source: 'teacher_preview' }, b.now().toISOString());
      if (entitlement === null) return notFound(MSG.package);
      // The newest agent version, not the live one: drafts must be previewable.
      const latest = await b.agentVersions.latest(scope, agentId);
      if (latest === null) return notFound(MSG.agent);
      const { id } = await b.sessions.create(previewScope(scope), {
        agentId,
        agentVersion: latest.version,
        packageId: entitlement.packageId,
        packageVersion: entitlement.packageVersion,
      });
      return Response.json({ sessionId: id }, { status: 201, headers: NO_STORE });
    } catch (error) {
      return failed(b, 'testChat.start_failed', error);
    }
  }

  async function postTestTurn(req: NextRequest, { principal, params }: RoleContext): Promise<Response> {
    const path = SessionParams.safeParse(await params);
    if (!path.success) return notFound(MSG.session);
    const sessionId = path.data.id;
    const raw = await readJson(req);
    if (raw === TOO_LARGE) return tooLarge();
    const body = ClientTurnSchema.safeParse(raw);
    if (!body.success) return validation();
    const input = toTurnInput(body.data, { studentId: principal.userId, sessionId });
    if (input === null) return validation();
    const b = await load();
    if (b instanceof Response) return b;
    let deps: PipelineDeps;
    try {
      const scope = await teacherTestChatScope(b.agents, principal, input.agentId);
      if (scope === null) return notFound(MSG.session);
      const student = previewScope(scope);
      const session = await b.sessions.get(student, sessionId);
      if (
        session === null ||
        session.endedAt !== null ||
        session.agentId !== input.agentId ||
        session.packageId === null
      ) {
        return notFound(MSG.session);
      }
      deps = b.depsFor(student, session.packageId);
    } catch (error) {
      return failed(b, 'testChat.turn_start_failed', error);
    }
    const run = runTurn(input, { deps, steps: b.steps, cancel: cancelOf(req.signal) });
    return new Response(sseBody(run, b.log), { status: 200, headers: SSE_HEADERS });
  }

  async function postCorrection(req: NextRequest, { principal }: RoleContext): Promise<Response> {
    const raw = await readJson(req);
    if (raw === TOO_LARGE) return tooLarge();
    const body = CorrectionSchema.safeParse(raw);
    if (!body.success) return validation();
    const b = await load();
    if (b instanceof Response) return b;
    try {
      const scope: TeacherScope = { teacherId: principal.userId };
      const ids = await b.corrections.record(scope, body.data);
      return Response.json(ids, { status: 201, headers: NO_STORE });
    } catch (error) {
      if (error instanceof RepositoryError && error.kind === 'not_found') return notFound(MSG.module);
      if (error instanceof RepositoryError && error.kind === 'invalid') return validation();
      return failed(b, 'testChat.correction_failed', error);
    }
  }

  return { listPackages, startTestSession, postTestTurn, postCorrection };
}
