// Task 12.3d (B-63): a teacher with 3 upheld copyright takedowns in any rolling 12 months is
// flagged to staff as a repeat infringer; staff decide whether to suspend. The threshold and
// window are code constants (ROUTE_POLICY `/api/staff/**`, staff only, GET only -- suspension is
// the existing `/api/staff/verifications` POST, unchanged, see plan "Lead answers").
//
// No new table, column or write path: the flag is a read computed from 12.2b's
// `takedowns.listActiveForStaff` (active, newest first, any kind) grouped by teacher, "upheld" ==
// `active` + `category === 'copyright'` + inside the window (12.3b's `countUpheld` precedent, but
// windowed and per-teacher), joined to 9.3f's `findBySlugForStaff` for name/email/subject, and
// enriched with 9.3h's `enrichQueueRows` -- the exact same helper `/api/staff/verifications` and
// `/staff/page.tsx`'s first paint use, so a flagged row is shape-identical to a slug-lookup row
// and the page and API can never drift from each other.
import {
  RepositoryError,
  type Repositories,
  type StaffTakedownRow,
  type TeacherVerificationQueueRow,
} from '@edmate/db';
import type { NextRequest } from 'next/server';
import { describeError } from '../../../../src/auth/describe-error';
import { apiError } from '../../../../src/auth/errors';
import type { RoleContext } from '../../../../src/auth/guard';
import { enrichQueueRows, toLookupItem, type LookupItem } from '../verifications/handlers';

/** B-63's threshold: this many upheld copyright takedowns flags a teacher. */
export const REPEAT_INFRINGER_THRESHOLD = 3;
/** B-63's window: "any rolling 12 months", read as 365 days (day/ms-based, not calendar months). */
export const REPEAT_INFRINGER_WINDOW_DAYS = 365;
/** The flagged list shows at most this many teachers, sorted by slug. */
export const REPEAT_INFRINGERS_MAX_LIMIT = 50;

type RepeatInfringerRepos = Pick<Repositories, 'takedowns' | 'teacherProfiles' | 'audit'>;

/**
 * Every teacher currently flagged as a repeat infringer, for a user who is staff right now: reads
 * `listActiveForStaff` once, groups by teacher, keeps a teacher with at least
 * `REPEAT_INFRINGER_THRESHOLD` active `copyright` takedowns created within
 * `REPEAT_INFRINGER_WINDOW_DAYS` days of `now`, drops a teacher whose slug is unknown (can't be
 * looked up or acted on) or who `findBySlugForStaff` no longer finds or who is already `rejected`
 * (nothing left to prompt staff to do), then enriches survivors the same way the verification
 * queue does. Sorted by slug, capped at `REPEAT_INFRINGERS_MAX_LIMIT`. The page and the API both
 * call this one helper, so they can never show a different answer.
 */
export async function listRepeatInfringersForStaff(
  repos: RepeatInfringerRepos,
  by: string,
  now: number = Date.now(),
): Promise<LookupItem[]> {
  const active = await repos.takedowns.listActiveForStaff(by);
  const windowStart = now - REPEAT_INFRINGER_WINDOW_DAYS * 86_400_000;
  const byTeacher = new Map<string, StaffTakedownRow[]>();
  for (const row of active) {
    if (row.teacherId === null) continue;
    if (row.category !== 'copyright') continue;
    if (Date.parse(row.createdAt) < windowStart) continue;
    const list = byTeacher.get(row.teacherId) ?? [];
    list.push(row);
    byTeacher.set(row.teacherId, list);
  }
  const candidates = [...byTeacher.values()]
    .filter((rows) => rows.length >= REPEAT_INFRINGER_THRESHOLD)
    .map((rows) => rows[0]!.teacherSlug)
    .filter((slug): slug is string => slug !== null);

  const found = await Promise.all(
    candidates.map((slug) => repos.teacherProfiles.findBySlugForStaff(by, slug)),
  );
  const survivors = found.filter(
    (row): row is TeacherVerificationQueueRow =>
      row !== null && row.verificationStatus !== 'rejected',
  );

  const enriched = await enrichQueueRows(repos, by, survivors, active);
  const items = enriched
    .map((r) => toLookupItem(r, r.activeTakedowns, r.lastDecision, r.subjectHistory))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return items.slice(0, REPEAT_INFRINGERS_MAX_LIMIT);
}

export interface StaffRepeatInfringersBackend {
  repos(): RepeatInfringerRepos;
  /** One line per unexpected failure (name only); defaults to console.error. */
  log?(line: string): void;
}

const MSG = {
  listForbidden: 'Only staff can see the repeat-infringer list.',
  failed: 'Something went wrong. Try again.',
} as const;

const ok = (body: unknown) =>
  Response.json(body, { status: 200, headers: { 'cache-control': 'no-store' } });

type Handler = (req: NextRequest, ctx: RoleContext) => Promise<Response>;

export function createStaffRepeatInfringersHandlers(backend: StaffRepeatInfringersBackend): {
  list: Handler;
} {
  const log = backend.log ?? ((line: string) => console.error(line));

  return {
    list: async (_req, ctx) => {
      try {
        const teachers = await listRepeatInfringersForStaff(backend.repos(), ctx.principal.userId);
        return ok({ teachers });
      } catch (error) {
        if (error instanceof RepositoryError) {
          if (error.kind === 'scope' || error.kind === 'invalid') {
            return apiError('forbidden', MSG.listForbidden, 403);
          }
        }
        log(`[staff] repeat-infringers.list failed: ${describeError(error)}`);
        return apiError('provider_error', MSG.failed, 500);
      }
    },
  };
}
