// Task 12.2c: a student reports an agent or teacher reply in their own chat (ROUTE_POLICY
// `/api/sessions/**` POST, clearance 'agent'). The student id is always the session's principal;
// the session id is the URL param; the body names only the agent, the reported message and a
// closed-set category (12.2 Q2: no free text). `studentTurnScope` (imported, not edited) turns the
// body's agentId into the scope `reports.file` needs; a scope that can't be built this way (the
// agent is not live right now) is `not_found`, exactly like the turn routes. `created` is true or
// false either way the reply is `{ ok: true }`: a duplicate report is not an error (12.2 design).
import { createHash } from 'node:crypto';
import {
  REPORT_CATEGORIES,
  RepositoryError,
  type ReportCategory,
  type Repositories,
} from '@edmate/db';
import { TurnInputSchema } from '@edmate/contracts';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError } from '../../../../../src/auth/errors';
import type { RoleContext } from '../../../../../src/auth/guard';
import { readJson, TOO_LARGE } from '../../../../../src/studio/routes';
import { studentTurnScope, type AgentOwners } from '../../../../../src/turn/scope';

const agentIdShape = TurnInputSchema.shape.agentId;

/**
 * Task 12.2f Phase B: the staff alert inbox row id for a filed report, derived from the report's
 * own id with a domain tag different from `reportRowId`'s (`@edmate/db`) so it can never collide
 * with a report id. Deterministic: a retried or replayed report never double-records (the
 * safety-alerts insert is `on conflict (id) do nothing`).
 */
function reportAlertId(reportId: string): string {
  const digest = createHash('sha256').update(`report-alert\u0000${reportId}`).digest('hex');
  return `ra_${digest.slice(0, 40)}`;
}

const ParamsSchema = z.object({ id: z.string().min(1).max(200) });
const ReportBody = z.strictObject({
  agentId: agentIdShape,
  messageId: z.string().min(1).max(200),
  category: z.enum(REPORT_CATEGORIES),
});

/**
 * Task 12.2h: a grammatical excerpt per category for the staff alert inbox. A plain
 * `${category} reply` template reads as "a inappropriate reply" or "a other reply"; this map is
 * typed over the route's own category enum so a new category fails typecheck here too.
 */
const CATEGORY_EXCERPT: Record<ReportCategory, string> = {
  harmful: 'a harmful reply',
  inappropriate: 'an inappropriate reply',
  wrong_information: 'a reply with wrong information',
  copyright: 'a reply that may break copyright',
  other: 'a reply for another reason',
};

/** The server log the route writes to: an event name and codes, never message text. */
export interface ServerLog {
  error(event: string, fields?: Readonly<Record<string, string>>): void;
}

/** Everything the route needs, built once per process (runtime.ts) or per test. */
export interface SessionReportsBackend {
  agents: AgentOwners;
  repos(): Pick<Repositories, 'reports' | 'safetyAlerts'>;
  log?: ServerLog;
}

const MSG = {
  validation: 'Check the request and try again.',
  tooLarge: 'The request is too large.',
  notFound: 'This chat is not available any more.',
  forbidden: "You can't report this.",
  failed: 'Something went wrong. Try again.',
} as const;

const ok = (status: number) =>
  Response.json({ ok: true }, { status, headers: { 'cache-control': 'no-store' } });
const notFound = () => apiError('not_found', MSG.notFound, 404);
const validation = () => apiError('validation', MSG.validation, 400);
const tooLarge = () => apiError('input_too_large', MSG.tooLarge, 413);

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

export function createSessionReportsHandlers(backend: SessionReportsBackend): { file: Handler } {
  const log = backend.log ?? { error: (event, fields) => console.error(event, fields) };
  const failed = (error: unknown): Response => {
    log.error('sessions.reports.file_failed', {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return apiError('provider_error', MSG.failed, 500);
  };

  return {
    file: async (req, { principal, params }) => {
      const path = ParamsSchema.safeParse(await params);
      if (!path.success) return notFound();
      const raw = await readJson(req);
      if (raw === TOO_LARGE) return tooLarge();
      const body = ReportBody.safeParse(raw);
      if (!body.success) return validation();
      try {
        const scope = await studentTurnScope(backend.agents, principal, body.data.agentId);
        if (scope === null) return notFound();
        const { id, created } = await backend.repos().reports.file(scope, {
          sessionId: path.data.id,
          messageId: body.data.messageId,
          category: body.data.category,
        });
        if (created) {
          try {
            await backend.repos().safetyAlerts.record({
              id: reportAlertId(id),
              level: 'info',
              kind: 'other',
              studentId: scope.studentId,
              teacherId: scope.teacherId,
              sessionId: path.data.id,
              excerptRedacted: `A student reported ${CATEGORY_EXCERPT[body.data.category]}.`,
              createdAt: new Date().toISOString(),
            });
          } catch (error) {
            log.error('sessions.reports.alert_failed', {
              error: error instanceof Error ? error.name : 'unknown',
            });
          }
        }
        return ok(created ? 201 : 200);
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
