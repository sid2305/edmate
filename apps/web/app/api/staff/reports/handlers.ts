// Task 12.2d: the staff report queue (ROUTE_POLICY `/api/staff/**` GET/POST, staff only). GET
// lists the open queue (12.2a's `listOpenForStaff`: no reporter id, name, email or session id);
// POST closes one report `dismissed` or `actioned` (12.2a's `review`, audited `report.review`).
// The staff id is always the session's principal: the body is strict, so a `by` (or any other
// unknown key) is a 400, never read. Repository errors map to fixed codes; only the error's name
// is logged, never its message (it can hold the reported reply's text).
import {
  REPORT_NOTE_MAX,
  RepositoryError,
  type Repositories,
  type StaffReportRow,
} from '@edmate/db';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { describeError } from '../../../../src/auth/describe-error';
import { apiError } from '../../../../src/auth/errors';
import type { RoleContext } from '../../../../src/auth/guard';
import { readJson, TOO_LARGE } from '../../../../src/studio/routes';

/** reports.review's own note cap (packages/db REPORT_NOTE_MAX). */
export const MAX_NOTE_CHARS = REPORT_NOTE_MAX;

const ReviewBody = z.strictObject({
  reportId: z.string().min(1).max(200),
  decision: z.enum(['dismissed', 'actioned']),
  note: z.string().trim().min(1).max(MAX_NOTE_CHARS).optional(),
});

export interface StaffReportsBackend {
  repos(): Pick<Repositories, 'reports'>;
  /** One line per unexpected failure (name only); defaults to console.error. */
  log?(line: string): void;
}

const MSG = {
  validation: 'Check the request and try again.',
  tooLarge: 'The request is too large.',
  listForbidden: 'Only staff can see the report queue.',
  reviewForbidden: "You can't review this report.",
  notFound: 'That report was not found.',
  failed: 'Something went wrong. Try again.',
} as const;

const ok = (body: unknown) =>
  Response.json(body, { status: 200, headers: { 'cache-control': 'no-store' } });
const validation = () => apiError('validation', MSG.validation, 400);

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

export function createStaffReportsHandlers(backend: StaffReportsBackend): {
  list: Handler;
  review: Handler;
} {
  const log = backend.log ?? ((line: string) => console.error(line));
  const failed = (op: string, error: unknown) => {
    log(`[staff] reports.${op} failed: ${describeError(error)}`);
    return apiError('provider_error', MSG.failed, 500);
  };

  return {
    list: async (_req, ctx) => {
      try {
        const rows: StaffReportRow[] = await backend
          .repos()
          .reports.listOpenForStaff(ctx.principal.userId);
        return ok({ reports: rows });
      } catch (error) {
        if (error instanceof RepositoryError) {
          // `invalid` here can only mean the session's own id is malformed.
          if (error.kind === 'scope' || error.kind === 'invalid') {
            return apiError('forbidden', MSG.listForbidden, 403);
          }
        }
        return failed('list', error);
      }
    },

    review: async (req, ctx) => {
      const raw = await readJson(req);
      if (raw === TOO_LARGE) return apiError('input_too_large', MSG.tooLarge, 413);
      const body = ReviewBody.safeParse(raw);
      if (!body.success) return validation();
      const { reportId, decision, note } = body.data;
      try {
        const row = await backend.repos().reports.review(ctx.principal.userId, reportId, {
          decision,
          ...(note === undefined ? {} : { note }),
        });
        return ok({ id: row.id, status: row.status });
      } catch (error) {
        if (error instanceof RepositoryError) {
          switch (error.kind) {
            case 'scope':
              return apiError('forbidden', MSG.reviewForbidden, 403);
            case 'not_found':
              return apiError('not_found', MSG.notFound, 404);
            case 'invalid':
            case 'integrity':
              return validation();
            case 'failed':
              break;
          }
        }
        return failed('review', error);
      }
    },
  };
}
