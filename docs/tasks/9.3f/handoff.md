**Status:** PARTIAL (Phase A done; Phases B and C left to do)

## Phase A

Built `packages/db` only, tests first.

- `packages/db/src/repositories/teacher-profiles.ts`: added `findBySlugForStaff(by, slug)` —
  staff-only, status-independent lookup by slug (no `verificationStatus` filter, unlike
  `listPendingForStaff`). Parses both `by` (`IdSchema`) and `slug` (`Slug`) before any SQL, then
  a read-only role check (`scope` if `by` is not staff), then selects + joins `users`, returning
  `TeacherVerificationQueueRow | null`. No change to `setVerification`, `takeDownAgentInTx` or any
  lock order.
- `packages/db/src/repositories/subscriptions.ts`: added `listUnavailableForStudent(studentId)`
  right after `listLiveForStudent` — same bare-id scope exception and `IdSchema.safeParse` guard,
  same four-table join, but the `agents` join uses `ne(agents.status, 'live')` instead of
  `eq(..., 'live')`; `where` keeps `ne(subscriptions.status, 'ended')`. Deliberately a separate
  method, not a flag on `listLiveForStudent` (which also feeds the live-classes question route,
  out of bounds here, unchanged).
- Tests (written first): `packages/db/test/teacher-profiles.test.ts` (malformed `by`/`slug` is
  `invalid` before any SQL, no DB touch — `noDb` proxy); `packages/db/test/teacher-profiles.int.test.ts`
  (new `describe('findBySlugForStaff ...')`: finds pending/verified/rejected teachers by slug,
  unknown slug is `null`, non-staff `by` is `scope`, malformed `by` is `invalid`, and the
  **acceptance case** — a verified teacher with a live agent found by slug, then safety-rejected
  exactly as 9.3e's existing pending-fixture case: agent `suspended`, one takedown row written);
  `packages/db/test/scope.test.ts` (exclusion comments for both new bare-id methods in the generic
  grid, plus each method's own "rejects a malformed id before any SQL" test, mirroring
  `listLiveForStudent`'s precedent); `packages/db/test/repositories.int.test.ts` (one grid case
  each: `teacherProfiles.findBySlugForStaff` — staff/non-staff split, finds each teacher by slug,
  unknown slug is `null`; `subscriptions.listUnavailableForStudent` — suspends teacher A's agent
  for the check's duration (restored in `finally`), own-rows-only across students, malformed-id
  grid).

### Gate

`corepack pnpm turbo run typecheck lint test --filter=@edmate/db --force`:
- typecheck: pass. lint: pass.
- test: **75 test files passed, 1600 tests passed, 4 skipped** (pre-existing, unrelated — HNSW and
  video-ingest suites that skip without extra services). No test file skipped for this change; no
  test was skipped that exercises the new methods.
- Coverage: `src/repositories/**` 100% statements/functions/lines, 98.42% branches (threshold
  90%, met); global 99.85% statements / 98.16% branches / 99.87% functions / 99.86% lines
  (thresholds 80%, met).

`python3 .githooks/secret-scan.py --all`: clean (no output).

## Decisions

1. "`setVerification({safety:true})` already worked from any starting `verificationStatus`
   (9.3e); the security review's MEDIUM was a console gap, not a repository one. Fixed with a new
   staff-only `findBySlugForStaff` (status-independent) and a `lookup` route (Phase B, not yet
   built), both read-only, so a verified teacher can now be found and safety-rejected through the
   existing, unchanged `decide` call."
   Decided: Phase A builds and proves only the repository half of this (over Postgres, in
   `teacher-profiles.int.test.ts`'s acceptance case); the route/console half is Phase B.
2. "B-49: a subscription whose agent stopped being `live` no longer silently disappears from
   `/home` with zero trace. A new read-only `listUnavailableForStudent` (deliberately separate
   from `listLiveForStudent`, which also feeds the live-classes question route unchanged) surfaces
   it as one blame-free line, no teacher name, no link — pause/cancel while suspended and the
   chat/plan pages' 404 are unchanged (Q5, deferred: no payment is live yet, so nobody is billed
   for an agent they can't reach)."
   Decided: Phase A builds and proves only the read itself; wiring it into `/home` is Phase C.

(Both carry `risk: high` per the plan — `packages/db/src/repositories/**` is a required-reviewer
group.)

## Left to do

- **Phase B** (`apps/web/app/api/staff/**`, risky): `lookup` handler + route, `LookupItem` /
  `toLookupItem`, `apps/web/app/staff/client.ts` (`findTeacherBySlug`), `apps/web/app/staff/view.tsx`
  search box wired to the existing `VerificationRow`/`decide`, `en.json` copy, and
  `route.test.ts` / `route.int.test.ts` / `client.test.ts` / `view.test.tsx` cases (plan § Phase B,
  items 4-9).
- **Phase C** (`apps/web/src/chat/liveChats.ts`, `/home`, not risky by path): thread
  `listUnavailableForStudent` into `homeLinks`'s new `unavailable` field, `HomeView`'s new
  paragraph, `en.json`'s `unavailableLine` ICU plural, and the `liveChats.test.ts` /
  `view.test.tsx` / `page.test.tsx` cases (plan § Phase C, items 10-14).
- Board follow-ups the lead already opened per the plan's lead answers: 9.3h (queue/lookup row
  shows active takedowns and last decision; subject-edit history) and 9.3i (pause/cancel for a
  subscription whose agent is suspended) — both deferred, not part of this task.
