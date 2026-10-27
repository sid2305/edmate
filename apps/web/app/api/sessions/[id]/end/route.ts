// Task 6.4a Phase B: POST /api/sessions/:id/end -- a real "this session is over" trigger
// (ROUTE_POLICY /api/sessions/**, student, clearance 'agent'). Follows the reports route's
// pattern (apps/web/app/api/sessions/[id]/reports/route.ts): the session id is the URL param, the
// body names only the agentId so the teacher-owner scope can be built the same way
// (`studentTurnScope`). Only the student who owns the session can end it -- anyone else, or a
// missing session, gets the same 404 (lead answer, 27 Oct 2026).
//
// The transcript and the session row come straight from `serverDatabase().repos` -- the same
// `messages.history` reader `loadChat.ts` already uses for a reopened chat -- not the turn
// pipeline's `TurnBackend`/`depsFor`: ending a session is housekeeping, not a teaching turn, and
// needs no Redis or queue machinery just to read a few messages and flip one row (see the 6.4a
// handoff decisions).
//
// Summarising is one bare, unmetered `generateObject` call, same shape as `styleCardRuntime.ts`'s
// drafter (8.4a): there is no natural turn or entitlement to bill it to (lead answer, Q4). The dev
// model's own fixed `{"summary": ...}` candidate (`turn/devModel.ts`'s `CANDIDATES`) already
// answers `SessionSummarySchema`, so a local stack with `EDMATE_DEV_MODEL=scripted` needs no
// separate dev-only drafter, unlike the style card's drafter.
//
// A failed or unavailable summariser never blocks ending the session: `sessionSummary.ts`'s own
// doc comment states the rule ("don't block ending a session on a model failure") -- the session
// still ends, with `summary: undefined` (stored as SQL NULL, `sessionsRepo.end`'s existing
// contract). Ending an already-ended session is a no-op success: it never re-summarises or
// overwrites the stored summary (also `sessionsRepo.end`'s existing guarantee, 6.4/3.16).
import { TurnInputSchema, type Message, type ModelGateway } from '@edmate/contracts';
import { RepositoryError, type Repositories } from '@edmate/db';
import { createRouter, DEFAULT_MODEL_POLICY, type ProviderAdapterFactories } from '@edmate/gateway';
import { summarizeSession } from '@edmate/harness';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { serverDatabase, withRole } from '../../../../../src/auth';
import { apiError } from '../../../../../src/auth/errors';
import type { RoleContext } from '../../../../../src/auth/guard';
import { devFactories, devModelEnabled } from '../../../../../src/turn/devModel';
import { anthropicFactories, type Env } from '../../../../../src/turn/runtime';
import {
  errorName,
  readJson,
  TOO_LARGE,
  TurnUnavailableError,
  type ServerLog,
} from '../../../../../src/turn/routes';
import { studentTurnScope, type AgentOwners } from '../../../../../src/turn/scope';

export const dynamic = 'force-dynamic';

const agentIdShape = TurnInputSchema.shape.agentId;
const ParamsSchema = z.object({ id: z.string().min(1).max(200) });
const EndBody = z.strictObject({ agentId: agentIdShape });

/** The newest messages summarised into the stored recap; a fixed cap (lead answer, Q4) so one
 * `summarizeSession` call per session stays small. */
export const SUMMARY_HISTORY_LIMIT = 50;

/** Everything the route needs, built once per process (below) or per test. */
export interface SessionEndBackend {
  agents: AgentOwners;
  repos(): Pick<Repositories, 'sessions' | 'messages'>;
  /** A bare, unmetered drafter for one `summarizeSession` call; built once, memoised. */
  gateway(): Promise<Pick<ModelGateway, 'generateObject'>>;
  log?: ServerLog;
}

const MSG = {
  validation: 'Check the request and try again.',
  tooLarge: 'The request is too large.',
  notFound: 'This chat is not available any more.',
  forbidden: "You can't end this chat.",
  failed: 'Something went wrong. Try again.',
} as const;

const ok = () =>
  Response.json({ ok: true }, { status: 200, headers: { 'cache-control': 'no-store' } });
const notFound = () => apiError('not_found', MSG.notFound, 404);
const validation = () => apiError('validation', MSG.validation, 400);
const tooLarge = () => apiError('input_too_large', MSG.tooLarge, 413);

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

export function createSessionEndHandlers(backend: SessionEndBackend): { end: Handler } {
  const log = backend.log ?? { error: (event, fields) => console.error(event, fields) };
  const failed = (error: unknown): Response => {
    log.error('sessions.end.failed', { error: errorName(error) });
    return apiError('provider_error', MSG.failed, 500);
  };

  return {
    end: async (req, { principal, params }) => {
      const path = ParamsSchema.safeParse(await params);
      if (!path.success) return notFound();
      const raw = await readJson(req);
      if (raw === TOO_LARGE) return tooLarge();
      const body = EndBody.safeParse(raw);
      if (!body.success) return validation();
      try {
        const scope = await studentTurnScope(backend.agents, principal, body.data.agentId);
        if (scope === null) return notFound();
        const repos = backend.repos();
        const session = await repos.sessions.get(scope, path.data.id);
        if (session === null || session.agentId !== body.data.agentId) return notFound();
        // Already ended (a race, or a retried call): a no-op success, never re-summarised and
        // never overwriting the stored summary (lead answer; sessionsRepo.end's own guarantee).
        if (session.endedAt !== null) return ok();
        const history: readonly Pick<Message, 'role' | 'text'>[] = await repos.messages.history(
          scope,
          path.data.id,
          SUMMARY_HISTORY_LIMIT,
        );
        // The gateway is built lazily, inside this one-method shim: an empty transcript (no
        // messages yet) must never build or call it (`summarizeSession` itself short-circuits on
        // an empty history, but only if the gateway is never awaited ahead of that check).
        const lazyGateway: Pick<ModelGateway, 'generateObject'> = {
          generateObject: async (req, schema) =>
            (await backend.gateway()).generateObject(req, schema),
        };
        let summary: string | undefined;
        try {
          summary = await summarizeSession(lazyGateway, history);
        } catch (error) {
          // sessionSummary.ts's own rule (6.4): a model failure never blocks ending the session.
          log.error('sessions.end.summarize_failed', { error: errorName(error) });
        }
        await repos.sessions.end(scope, path.data.id, summary);
        return ok();
      } catch (error) {
        if (error instanceof RepositoryError) {
          switch (error.kind) {
            case 'not_found':
              return notFound();
            case 'invalid':
            case 'integrity':
              return validation();
            case 'scope':
              return apiError('forbidden', MSG.forbidden, 403);
            case 'failed':
              break;
          }
        }
        return failed(error);
      }
    },
  };
}

/** The bare, unmetered drafter (`styleCardRuntime.ts`'s precedent): Anthropic for every tier, or
 * -- on a local stack with `EDMATE_DEV_MODEL=scripted` -- the dev model, whose own fixed
 * `{"summary": ...}` candidate already answers `SessionSummarySchema`. */
async function buildGateway(env: Env): Promise<Pick<ModelGateway, 'generateObject'>> {
  const factories: ProviderAdapterFactories = devModelEnabled(env)
    ? devFactories()
    : await anthropicFactories(env).catch(() => {
        throw new TurnUnavailableError('provider_key');
      });
  return createRouter(DEFAULT_MODEL_POLICY, factories);
}

/** The production backend: a memoised bare gateway over the auth runtime's repositories. A
 * gateway build failure is logged once and never retried this process (same rule as
 * `createStyleCardRuntime`); the handler above turns any such failure into a skipped summary,
 * never a failed request. */
function createSessionEndBackend(log: ServerLog): SessionEndBackend {
  let gateway: Promise<Pick<ModelGateway, 'generateObject'>> | undefined;
  return {
    agents: { owner: (scope) => serverDatabase().repos.agents.owner(scope) },
    repos: () => serverDatabase().repos,
    gateway: () => {
      gateway ??= buildGateway(process.env).catch((error: unknown) => {
        const reason = error instanceof TurnUnavailableError ? error.reason : errorName(error);
        log.error('sessions.end.gateway_unavailable', { reason });
        throw error;
      });
      return gateway;
    },
    log,
  };
}

const log: ServerLog = {
  error: (event, fields = {}) => {
    const rest = Object.entries(fields)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    console.error(`[sessions.end] ${event}${rest === '' ? '' : ` ${rest}`}`);
  },
};

const handlers = createSessionEndHandlers(createSessionEndBackend(log));

export const POST = withRole(['student'], handlers.end);
