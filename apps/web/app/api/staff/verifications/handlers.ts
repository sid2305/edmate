// Task 12.1b: the staff verification API (ROUTE_POLICY `/api/staff/**`, staff only). GET lists the
// pending queue (12.1a's `listPendingForStaff`); POST approves or rejects one teacher through the
// existing `setVerification` (8.1), which checks staff + not-self and writes the `teacher.verify`
// audit row in the same transaction. The staff id is always the session's principal: the body is
// a strict object, so a `by` (or any other unknown key) is a 400, never read. Repository errors map
// to fixed codes; only the error's name is logged, never its message (it can hold personal data).
// Task 9.3e: a rejection may carry `safety: true` (B-46 (c)): setVerification then takes down the
// teacher's live agents in the same transaction, so existing subscribers lose access at once. The
// flag is refused on an approval (400) and passed on only when `true`.
// Task 9.3f: a new `lookup` handler reaches a teacher by slug regardless of status (9.3e's
// `setVerification({safety:true})` already worked from any starting status; staff just had no way
// to name a verified or already-rejected teacher). It is a read, same role check as `list`; the
// existing `decide` is unchanged.
// Task 9.3h: `list` and `lookup` both enrich their rows with the teacher's active takedowns and
// last verify/reject decision (9.3f's own left-to-do, Q4): staff reading a row that reappeared in
// the queue after a safety rejection now see that history instead of a blank row. `enrichQueueRows`
// is the one helper both callers (and `page.tsx`'s server-rendered first paint) share, so they can
// never drift from each other; `decide` is byte-for-byte unchanged.
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

/** Task 9.3h: one of this teacher's active takedowns, as the console shows it. */
export interface TakedownSummary {
  kind: 'document' | 'agent';
  category: string;
  createdAt: string;
}

/** Task 9.3h: the most recent verify/reject decision on record for this teacher, if any. */
export interface LastDecision {
  status: 'verified' | 'rejected';
  reason: string | null;
  ts: string;
}

/** What the console shows for one pending teacher (no row id, no status: they're all pending). */
export interface QueueItem {
  teacherId: string;
  slug: string;
  subject: string;
  name: string;
  email: string | null;
  /** Task 9.3h: this teacher's active takedowns, newest first (empty when none). */
  activeTakedowns: TakedownSummary[];
  /** Task 9.3h: the teacher's last verify/reject decision, or null before any decision. */
  lastDecision: LastDecision | null;
}

export function toQueueItem(
  row: TeacherVerificationQueueRow,
  activeTakedowns: TakedownSummary[] = [],
  lastDecision: LastDecision | null = null,
): QueueItem {
  return {
    teacherId: row.teacherId,
    slug: row.slug,
    subject: row.subject,
    name: row.name,
    email: row.email,
    activeTakedowns,
    lastDecision,
  };
}

/** Task 9.3f: a lookup result also names the teacher's current status (no status filter). */
export interface LookupItem extends QueueItem {
  verificationStatus: 'pending' | 'verified' | 'rejected';
}

export function toLookupItem(
  row: TeacherVerificationQueueRow,
  activeTakedowns: TakedownSummary[] = [],
  lastDecision: LastDecision | null = null,
): LookupItem {
  return { ...toQueueItem(row, activeTakedowns, lastDecision), verificationStatus: row.verificationStatus };
}

/**
 * Task 9.3h: calls `takedowns.listActiveForStaff` once (not per row), groups by `teacherId`, then
 * for each row looks up its group and calls `audit.findLastVerifyForStaff` (one call per row, run
 * in parallel -- the queue is capped at 50, the lookup is always one row; no batched audit read
 * exists or is needed at this scale). `list`, `lookup` and `page.tsx`'s server-rendered first paint
 * all share this helper, so they can never drift from each other.
 */
export async function enrichQueueRows(
  repos: Pick<Repositories, 'takedowns' | 'audit'>,
  by: string,
  rows: TeacherVerificationQueueRow[],
): Promise<(TeacherVerificationQueueRow & { activeTakedowns: TakedownSummary[]; lastDecision: LastDecision | null })[]> {
  const active = await repos.takedowns.listActiveForStaff(by);
  const byTeacher = new Map<string, TakedownSummary[]>();
  for (const t of active) {
    if (t.teacherId === null) continue;
    const list = byTeacher.get(t.teacherId) ?? [];
    list.push({ kind: t.kind, category: t.category, createdAt: t.createdAt });
    byTeacher.set(t.teacherId, list);
  }
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      activeTakedowns: byTeacher.get(row.teacherId) ?? [],
      lastDecision: await repos.audit.findLastVerifyForStaff(by, row.teacherId),
    })),
  );
}

export interface StaffVerificationBackend {
  repos(): Pick<Repositories, 'teacherProfiles' | 'takedowns' | 'audit'>;
  /** One line per unexpected failure (name only); defaults to console.error. */
  log?(line: string): void;
}

const MSG = {
  validation: 'Check the request and try again.',
  tooLarge: 'The request is too large.',
  listForbidden: 'Only staff can see the verification queue.',
  lookupForbidden: 'Only staff can look up a teacher.',
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
  lookup: Handler;
} {
  const log = backend.log ?? ((line: string) => console.error(line));
  const failed = (op: string, error: unknown) => {
    log(`[staff] verifications.${op} failed: ${describeError(error)}`);
    return apiError('provider_error', MSG.failed, 500);
  };

  return {
    list: async (_req, ctx) => {
      try {
        const repos = backend.repos();
        const rows = await repos.teacherProfiles.listPendingForStaff(ctx.principal.userId);
        const enriched = await enrichQueueRows(repos, ctx.principal.userId, rows);
        return ok({
          teachers: enriched.map((r) => toQueueItem(r, r.activeTakedowns, r.lastDecision)),
        });
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

    lookup: async (req, ctx) => {
      const slug = req.nextUrl.searchParams.get('slug')?.trim() ?? '';
      if (slug === '') return validation();
      try {
        const repos = backend.repos();
        const row = await repos.teacherProfiles.findBySlugForStaff(ctx.principal.userId, slug);
        if (row === null) return ok({ teacher: null });
        const [enriched] = await enrichQueueRows(repos, ctx.principal.userId, [row]);
        /* v8 ignore next -- enrichQueueRows always returns one row per input row */
        if (!enriched) return ok({ teacher: null });
        return ok({ teacher: toLookupItem(row, enriched.activeTakedowns, enriched.lastDecision) });
      } catch (error) {
        if (error instanceof RepositoryError) {
          switch (error.kind) {
            case 'scope':
            case 'not_found':
              return apiError('forbidden', MSG.lookupForbidden, 403);
            case 'invalid':
              return validation();
            case 'integrity':
            case 'failed':
              break;
          }
        }
        return failed('lookup', error);
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
