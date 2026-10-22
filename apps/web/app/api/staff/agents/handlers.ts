// Task 12.4c: the staff regulated-subject API (ROUTE_POLICY `/api/staff/**`, staff only). GET
// lists every agent with its flag (12.4a's `listForStaff`, ids and the public slug only). POST
// sets an agent's regulated subject (`action: 'subject'`) or approves/revokes it
// (`action: 'approval'`) through `setSubject` / `setApproval`, which check staff under `lockRole`
// and write the `agent.regulated_flag` / `agent.regulated_approval` audit row in the same
// transaction. The staff id is always the session's principal: each body is a strict object, so a
// `by` (or any other unknown key) is a 400, never read. Repository errors map to fixed codes; only
// the error's name is logged, never its message or the note (either can hold personal data).
import {
  RepositoryError,
  REGULATED_NOTE_MAX,
  REGULATED_SUBJECTS,
  type RegulatedAgentRow,
  type Repositories,
} from '@edmate/db';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { describeError } from '../../../../src/auth/describe-error';
import { apiError } from '../../../../src/auth/errors';
import type { RoleContext } from '../../../../src/auth/guard';
import { readJson, TOO_LARGE } from '../../../../src/studio/routes';

const AgentId = z.string().min(1).max(200);
const Note = z.string().trim().min(1).max(REGULATED_NOTE_MAX).optional();

/** One staff change. Strict on each branch: a `by`, `approvedBy` or stray key is refused. */
const UpdateBody = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('subject'),
    agentId: AgentId,
    subject: z.enum(REGULATED_SUBJECTS).nullable(),
    note: Note,
  }),
  z.strictObject({
    action: z.literal('approval'),
    agentId: AgentId,
    approved: z.boolean(),
    note: Note,
  }),
]);

/** What the console shows for one agent: exactly the repository row's known columns. */
export function toAgentItem(row: RegulatedAgentRow): RegulatedAgentRow {
  return {
    agentId: row.agentId,
    teacherSlug: row.teacherSlug,
    status: row.status,
    liveVersion: row.liveVersion,
    regulatedSubject: row.regulatedSubject,
    approvedAt: row.approvedAt,
    approvedBy: row.approvedBy,
  };
}

export interface StaffAgentBackend {
  repos(): Pick<Repositories, 'regulatedSubjects'>;
  /** One line per unexpected failure (name only); defaults to console.error. */
  log?(line: string): void;
}

const MSG = {
  validation: 'Check the request and try again.',
  needsSubject: 'Set a regulated subject on this agent before approving it.',
  tooLarge: 'The request is too large.',
  listForbidden: 'Only staff can see the agent list.',
  updateForbidden: "You can't change this agent: your staff access may have changed.",
  notFound: 'That agent was not found.',
  failed: 'Something went wrong. Try again.',
} as const;

const ok = (body: unknown) =>
  Response.json(body, { status: 200, headers: { 'cache-control': 'no-store' } });
const validation = (message: string = MSG.validation) => apiError('validation', message, 400);

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

export function createStaffAgentHandlers(backend: StaffAgentBackend): {
  list: Handler;
  update: Handler;
} {
  const log = backend.log ?? ((line: string) => console.error(line));
  const failed = (op: string, error: unknown) => {
    log(`[staff] agents.${op} failed: ${describeError(error)}`);
    return apiError('provider_error', MSG.failed, 500);
  };

  return {
    list: async (_req, ctx) => {
      try {
        const rows = await backend.repos().regulatedSubjects.listForStaff(ctx.principal.userId);
        return ok({ agents: rows.map(toAgentItem) });
      } catch (error) {
        if (error instanceof RepositoryError) {
          // `invalid` / `not_found` here can only mean the session's own id is not a staff user.
          if (error.kind === 'scope' || error.kind === 'invalid' || error.kind === 'not_found') {
            return apiError('forbidden', MSG.listForbidden, 403);
          }
        }
        return failed('list', error);
      }
    },

    update: async (req, ctx) => {
      const raw = await readJson(req);
      if (raw === TOO_LARGE) return apiError('input_too_large', MSG.tooLarge, 413);
      const parsed = UpdateBody.safeParse(raw);
      if (!parsed.success) return validation();
      const body = parsed.data;
      const by = ctx.principal.userId;
      const note = body.note === undefined ? {} : { note: body.note };
      try {
        const repo = backend.repos().regulatedSubjects;
        const { changed } =
          body.action === 'subject'
            ? await repo.setSubject(by, { agentId: body.agentId, subject: body.subject, ...note })
            : await repo.setApproval(by, { agentId: body.agentId, approved: body.approved, ...note });
        return ok({ agentId: body.agentId, changed });
      } catch (error) {
        if (error instanceof RepositoryError) {
          switch (error.kind) {
            case 'scope':
              return apiError('forbidden', MSG.updateForbidden, 403);
            case 'not_found':
              return apiError('not_found', MSG.notFound, 404);
            case 'invalid':
              // The body already passed the same schema, so this is approving an unflagged agent.
              return validation(body.action === 'approval' ? MSG.needsSubject : MSG.validation);
            case 'integrity':
              return validation();
            case 'failed':
              break;
          }
        }
        return failed(body.action, error);
      }
    },
  };
}
