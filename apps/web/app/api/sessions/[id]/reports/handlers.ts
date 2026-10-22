// Task 12.2c: a student reports an agent or teacher reply in their own chat (ROUTE_POLICY
// `/api/sessions/**` POST, clearance 'agent'). The student id is always the session's principal;
// the session id is the URL param; the body names only the agent, the reported message and a
// closed-set category (12.2 Q2: no free text). `studentTurnScope` (imported, not edited) turns the
// body's agentId into the scope `reports.file` needs; a scope that can't be built this way (the
// agent is not live right now) is `not_found`, exactly like the turn routes. `created` is true or
// false either way the reply is `{ ok: true }`: a duplicate report is not an error (12.2 design).
import { RepositoryError, type Repositories } from '@edmate/db';
import { TurnInputSchema } from '@edmate/contracts';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError } from '../../../../../src/auth/errors';
import type { RoleContext } from '../../../../../src/auth/guard';
import { readJson, TOO_LARGE } from '../../../../../src/studio/routes';
import { studentTurnScope, type AgentOwners } from '../../../../../src/turn/scope';

const agentIdShape = TurnInputSchema.shape.agentId;

const ParamsSchema = z.object({ id: z.string().min(1).max(200) });
const ReportBody = z.strictObject({
  agentId: agentIdShape,
  messageId: z.string().min(1).max(200),
  category: z.enum(['harmful', 'inappropriate', 'wrong_information', 'copyright', 'other']),
});

/** The server log the route writes to: an event name and codes, never message text. */
export interface ServerLog {
  error(event: string, fields?: Readonly<Record<string, string>>): void;
}

/** Everything the route needs, built once per process (runtime.ts) or per test. */
export interface SessionReportsBackend {
  agents: AgentOwners;
  repos(): Pick<Repositories, 'reports'>;
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
        const { created } = await backend.repos().reports.file(scope, {
          sessionId: path.data.id,
          messageId: body.data.messageId,
          category: body.data.category,
        });
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
