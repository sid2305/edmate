// Task 12.1b: the staff verification API (ROUTE_POLICY `/api/staff/**`, staff only). GET lists the
// pending queue (12.1a's `listPendingForStaff`); POST approves or rejects one teacher through the
// existing `setVerification` (8.1), which checks staff + not-self and writes the `teacher.verify`
// audit row in the same transaction. The staff id is always the session's principal: the body is
// a strict object, so a `by` (or any other unknown key) is a 400, never read. Repository errors map
// to fixed codes; only the error's name is logged, never its message (it can hold personal data).
// Task 9.3e: a rejection may carry `safety: true` (B-46 (c)): setVerification then takes down the
// teacher's live agents in the same transaction, so existing subscribers lose access at once. The
// flag is refused on an approval (400) and passed on only when `true`.
import { RepositoryError, type Repositories, type TeacherVerificationQueueRow } from '@edmate/db';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { describeError } from '../../../../src/auth/describe-error';
import { apiError } from '../../../../src/auth/errors';
import type { RoleContext } from '../../../../src/auth/guard';
import { readJson, TOO_LARGE } from '../../../../src/studio/routes';

/** setVerification's own reason cap (packages/db VerificationInput). */
export const MAX_REASON_CHARS = 500;

/**
 * The one decision a staff user sends. Strict: unknown keys (a `by`, a `userId`) are refused.
 * `safety: true` is only valid on a rejection (the repository's own refine, checked here first).
 */
const DecisionBody = z
  .strictObject({
    teacherId: z.string().min(1).max(200),
    status: z.enum(['verified', 'rejected']),
    reason: z.string().trim().min(1).max(MAX_REASON_CHARS).optional(),
    safety: z.boolean().optional(),
  })
  .refine((b) => b.safety !== true || b.status === 'rejected');

/** What the console shows for one pending teacher (no row id, no status: they're all pending). */
export interface QueueItem {
  teacherId: string;
  slug: string;
  subject: string;
  name: string;
  email: string | null;
}

export function toQueueItem(row: TeacherVerificationQueueRow): QueueItem {
  return {
    teacherId: row.teacherId,
    slug: row.slug,
    subject: row.subject,
    name: row.name,
    email: row.email,
  };
}

export interface StaffVerificationBackend {
  repos(): Pick<Repositories, 'teacherProfiles'>;
  /** One line per unexpected failure (name only); defaults to console.error. */
  log?(line: string): void;
}

const MSG = {
  validation: 'Check the request and try again.',
  tooLarge: 'The request is too large.',
  listForbidden: 'Only staff can see the verification queue.',
  decideForbidden:
    "You can't verify this teacher: it may be your own profile, or your staff access changed.",
  notFound: 'That teacher was not found.',
  failed: 'Something went wrong. Try again.',
} as const;

const ok = (body: unknown) =>
  Response.json(body, { status: 200, headers: { 'cache-control': 'no-store' } });
const validation = () => apiError('validation', MSG.validation, 400);

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

export function createStaffVerificationHandlers(backend: StaffVerificationBackend): {
  list: Handler;
  decide: Handler;
} {
  const log = backend.log ?? ((line: string) => console.error(line));
  const failed = (op: string, error: unknown) => {
    log(`[staff] verifications.${op} failed: ${describeError(error)}`);
    return apiError('provider_error', MSG.failed, 500);
  };

  return {
    list: async (_req, ctx) => {
      try {
        const rows = await backend.repos().teacherProfiles.listPendingForStaff(ctx.principal.userId);
        return ok({ teachers: rows.map(toQueueItem) });
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

    decide: async (req, ctx) => {
      const raw = await readJson(req);
      if (raw === TOO_LARGE) return apiError('input_too_large', MSG.tooLarge, 413);
      const body = DecisionBody.safeParse(raw);
      if (!body.success) return validation();
      const { teacherId, status, reason, safety } = body.data;
      try {
        const row = await backend.repos().teacherProfiles.setVerification(
          { teacherId },
          {
            status,
            by: ctx.principal.userId,
            ...(reason === undefined ? {} : { reason }),
            ...(safety === true ? { safety: true } : {}),
          },
        );
        return ok({ teacherId: row.teacherId, verificationStatus: row.verificationStatus });
      } catch (error) {
        if (error instanceof RepositoryError) {
          switch (error.kind) {
            case 'scope':
              return apiError('forbidden', MSG.decideForbidden, 403);
            case 'not_found':
              return apiError('not_found', MSG.notFound, 404);
            case 'invalid':
            case 'integrity':
              return validation();
            case 'failed':
              break;
          }
        }
        return failed('decide', error);
      }
    },
  };
}
