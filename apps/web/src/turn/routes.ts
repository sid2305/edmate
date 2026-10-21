// The student chat's two API routes (task 9.4): `POST /api/sessions` starts a session and
// `POST /api/sessions/:id/turns` runs one turn as server-sent events. The route files wrap these
// handlers in `withRole(['student'], …)`; ROUTE_POLICY gives both `clearance: 'agent'`, so a
// learner still waiting on a parent's consent is refused (403) before any handler code runs.
//
// The handlers take a `TurnBackend` factory, so tests run them over memory ports and the scripted
// gateway, and production over the database, Redis and the real gateway (runtime.ts).
import type { EntitlementStore, Entitlement, TurnEvent } from '@edmate/contracts';
import type { StudentScope } from '@edmate/db';
import {
  formatSseEvent,
  runTurn,
  type Cancel,
  type PipelineDeps,
  type Steps,
  type TurnRun,
} from '@edmate/harness';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError } from '../auth/errors';
import type { RoleContext } from '../auth/guard';
import { ClientTurnSchema, StartSessionSchema, toTurnInput } from './clientInput';
import { studentTurnScope, type AgentOwners } from './scope';

/** A session as the turn route needs it. */
export interface TurnSessionRow {
  agentId: string;
  endedAt: string | null;
}

/** The server log the turn routes write to: an event name and codes, never message text. */
export interface ServerLog {
  error(event: string, fields?: Readonly<Record<string, string>>): void;
}

/** Everything the two routes need, built once per process (runtime.ts) or per test. */
export interface TurnBackend {
  agents: AgentOwners & {
    get(
      scope: { teacherId: string },
      agentId: string,
    ): Promise<{ status: string; liveVersion: number | null } | null>;
  };
  sessions: {
    create(
      scope: StudentScope,
      input: { agentId: string; agentVersion: number; packageId: string; packageVersion: number },
    ): Promise<{ id: string }>;
    get(scope: StudentScope, sessionId: string): Promise<TurnSessionRow | null>;
  };
  /** Resolves the student's subscription (and asks the age gate again, as a second line). */
  entitlements: EntitlementStore;
  /** One turn's pipeline dependencies for this student x teacher. */
  depsFor(scope: StudentScope): PipelineDeps;
  steps: Steps;
  now(): Date;
  log: ServerLog;
}

/** Thrown by a backend factory that can't serve turns (no Redis, no provider key). */
export class TurnUnavailableError extends Error {
  /** A fixed reason code (`REDIS_URL`, `provider_key`); safe to log. */
  readonly reason: string;
  constructor(reason: string) {
    super(`turn backend unavailable: ${reason}`);
    this.reason = reason;
    this.name = 'TurnUnavailableError';
  }
}

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  'x-accel-buffering': 'no',
} as const;

/** The last net for a throw after headers are sent: one retryable error event. */
const STREAM_FAILED: TurnEvent = { type: 'error', code: 'provider_error', retryable: true };

const ParamsSchema = z.object({ id: StartSessionSchema.shape.agentId });

const MSG = {
  validation: 'Check the request and try again.',
  agent: 'That agent is not available.',
  session: 'That chat session is not available.',
  noAccess: 'You need a live package with this teacher first.',
  unavailable: 'The tutor is not available right now. Try again soon.',
  failed: 'Something went wrong. Try again.',
} as const;

const notFound = (message: string) => apiError('not_found', message, 404);
const validation = () => apiError('validation', MSG.validation, 400);

/** An error's name only (never its message, which may quote ids or content). */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** The largest request body either route reads (bytes). A turn's text limit is far below it. */
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

/**
 * The body as JSON, `undefined` when it is not JSON or can't be read, or TOO_LARGE. A declared
 * content-length over the cap is refused before reading; the bytes actually read are capped too,
 * so a missing or false content-length can't get past it.
 */
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

const tooLarge = () => apiError('input_too_large', 'The request is too large.', 413);

/** Paused and ended subscriptions can't start a session (the turn's `entitle` refuses them too). */
function usable(e: Entitlement | null): e is Entitlement {
  return e !== null && e.status !== 'paused' && e.status !== 'ended';
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

/** The turn's events as SSE bytes. A client hang-up closes the event stream (`return()`). */
export function sseBody(run: TurnRun, log: ServerLog): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const events = run.events[Symbol.asyncIterator]();
  void run.finished;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await events.next();
        if (next.done === true) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(formatSseEvent(next.value)));
      } catch (error) {
        log.error('turn.stream_failed', { error: errorName(error) });
        controller.enqueue(encoder.encode(formatSseEvent(STREAM_FAILED)));
        controller.close();
        await events.return?.();
      }
    },
    async cancel() {
      await events.return?.();
    },
  });
}

/** The two handlers over a lazily built backend. */
export function createSessionHandlers(backend: () => Promise<TurnBackend>) {
  /** The backend, or the 503 response when it can't be built. */
  async function load(): Promise<TurnBackend | Response> {
    try {
      return await backend();
    } catch {
      // The runtime logs the reason once; nothing about it reaches the client.
      return apiError('provider_error', MSG.unavailable, 503);
    }
  }

  function failed(b: TurnBackend, event: string, error: unknown): Response {
    b.log.error(event, { error: errorName(error) });
    if (error instanceof TurnUnavailableError) {
      return apiError('provider_error', MSG.unavailable, 503);
    }
    return apiError('provider_error', MSG.failed, 500);
  }

  async function startSession(req: NextRequest, { principal }: RoleContext): Promise<Response> {
    const raw = await readJson(req);
    if (raw === TOO_LARGE) return tooLarge();
    const body = StartSessionSchema.safeParse(raw);
    if (!body.success) return validation();
    const { agentId } = body.data;
    const b = await load();
    if (b instanceof Response) return b;
    try {
      const scope = await studentTurnScope(b.agents, principal, agentId);
      if (scope === null) return notFound(MSG.agent);
      const entitlement = await b.entitlements.resolve(
        { studentId: scope.studentId, agentId, source: 'subscription' },
        b.now().toISOString(),
      );
      if (!usable(entitlement)) return apiError('no_access', MSG.noAccess, 403);
      const agent = await b.agents.get({ teacherId: scope.teacherId }, agentId);
      if (agent === null || agent.status !== 'live' || agent.liveVersion === null) {
        return notFound(MSG.agent);
      }
      const { id } = await b.sessions.create(scope, {
        agentId,
        agentVersion: agent.liveVersion,
        packageId: entitlement.packageId,
        packageVersion: entitlement.packageVersion,
      });
      return Response.json(
        { sessionId: id },
        { status: 201, headers: { 'cache-control': 'no-store' } },
      );
    } catch (error) {
      return failed(b, 'sessions.start_failed', error);
    }
  }

  async function postTurn(req: NextRequest, { principal, params }: RoleContext): Promise<Response> {
    const path = ParamsSchema.safeParse(await params);
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
      const scope = await studentTurnScope(b.agents, principal, input.agentId);
      if (scope === null) return notFound(MSG.session);
      const session = await b.sessions.get(scope, sessionId);
      if (session === null || session.endedAt !== null || session.agentId !== input.agentId) {
        return notFound(MSG.session);
      }
      deps = b.depsFor(scope);
    } catch (error) {
      return failed(b, 'turns.start_failed', error);
    }
    const run = runTurn(input, { deps, steps: b.steps, cancel: cancelOf(req.signal) });
    return new Response(sseBody(run, b.log), { status: 200, headers: SSE_HEADERS });
  }

  return { startSession, postTurn };
}
