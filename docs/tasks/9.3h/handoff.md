# 9.3h handoff

**Status:** DONE

## What changed

Finished the work left by two stalled runs (committed as lead WIP commits `44c2a5b5`,
`bb49cef8`). The pending queue and the slug lookup in the staff console now show, per teacher: how
many active takedowns they currently have (or "None") and the most recent verify/reject decision
on record (status + date, or "No previous decision").

- `packages/db/src/repositories/audit.ts`: new `findLastVerifyForStaff(by, teacherId)`, staff-only
  (role check via `role-lock.ts`, no lock), reads the newest `teacher.verify` audit row for a
  teacher. Malformed input is `invalid`; a well-formed non-staff `by` is `scope`; a stored `after`
  that fails its shape is `integrity`.
- `apps/web/app/api/staff/verifications/handlers.ts`: new `enrichQueueRows(repos, by, rows)`
  helper, calling `takedowns.listActiveForStaff` once and `audit.findLastVerifyForStaff` per row
  (in parallel via `Promise.all`, per the lead's Q3 answer). `list`, `lookup` and `page.tsx`'s SSR
  first paint all share it.
- `apps/web/app/staff/client.ts`, `verification-row.tsx`, `page.tsx`, `messages/en.json`: the new
  `activeTakedowns`/`lastDecision` fields flow through the zod schemas, the row UI (two more
  `dt`/`dd` pairs, always shown) and the SSR first paint.
- Tests: `packages/db/test/audit.test.ts` (new), `repositories.int.test.ts` (new grid entry),
  `scope.test.ts` (new exclusion); `apps/web/app/api/staff/verifications/route.test.ts`,
  `route.int.test.ts`, `apps/web/app/staff/{client,view,page}.test.tsx`.

## This session's work (finishing the two stalled runs)

The two prior runs had already written essentially all of the files above. This session:
- Verified each file against the plan's "Files to create/modify" list (all present and complete).
- Added the one missing piece: a new case in `apps/web/app/api/staff/verifications/route.int.test.ts`
  — a safety-rejected teacher (teacher A, rejected earlier in the same file) shows their own
  `lastDecision.status === 'rejected'` on lookup; a fresh, still-pending teacher C shows
  `activeTakedowns: []` and `lastDecision: null` on the list (own-rows-only). Added `teacherC` to
  the file's cleanup `afterAll` loop so nothing pending is left behind.
- Fixed a real bug the stalled runs left: `packages/db/test/repositories.int.test.ts`'s new
  `audit.findLastVerifyForStaff` grid entry inserted a corrupt `audit_log` row with no `id` column,
  which failed on the real not-null constraint (`id` has no default) before the test could even
  reach the `integrity` assertion it was checking. Added an explicit `id` ('al_93h_bad'), matching
  the file's own precedent (`al_corrupt`, same file, line ~6156).
- Fixed a stale test fixture: `apps/web/app/api/staff/verifications/route.test.ts`'s
  "the default logger writes to console.error" test built a `repos` object with only
  `teacherProfiles`, which no longer satisfied the widened `StaffVerificationBackend.repos()`
  return type (`Pick<Repositories, 'teacherProfiles' | 'takedowns' | 'audit'>`); added stub
  `takedowns`/`audit` entries.
- Ran the full gate to green (see Evidence) and the secret scan.

## Deviation from the plan (named, not silent)

`route.int.test.ts`'s new case proves `lastDecision` fully end-to-end over real Postgres (the
safety-rejected teacher A's real `teacher.verify` audit row) and proves `activeTakedowns`'s
own-rows-only isolation (an empty array for an unrelated, still-pending teacher). It does **not**
create a real, non-empty `activeTakedowns` row in this file: doing so needs a live agent, which
needs a course and a style card (`agents.ensureDraft`'s own requirements) — disproportionate setup
for one int-test case. The non-empty case is already proven at the repository layer, over real
Postgres, two ways that already exist: `packages/db/test/teacher-profiles.int.test.ts`
("`setVerification` with `safety: true` takes the teacher's live agents down" — an active
`takedowns` row from a real safety rejection) and this task's own `audit.findLastVerifyForStaff`
entry in `repositories.int.test.ts`. The route handler's composition of a non-empty
`activeTakedowns` array is proven at the unit level with a faithful mock in
`route.test.ts` ("shows an active takedown and a prior decision (9.3h)"). This matches the file's
own existing precedent (its comment on the 9.3e safety-rejection test: "the agent takedown proof
lives in packages/db / entitlement-store int tests").

## Evidence

- "a staff view test shows active takedowns and the last decision on a queue row and a lookup
  row": `apps/web/app/staff/view.test.tsx` — `shows "None" and "No previous decision" when a
  teacher has neither (9.3h)`, `shows the active takedown count and the last decision line
  (9.3h)`, `pluralizes 2+ active takedowns (9.3h)`, `has no axe violations with active takedowns
  and a last decision shown (9.3h)`.
- `apps/web/app/api/staff/verifications/route.test.ts` — `shows an active takedown and a prior
  decision (9.3h)` (list); the lookup `toEqual` bodies above it include the new fields with
  default empty values.
- `apps/web/app/api/staff/verifications/route.int.test.ts` — `9.3h: a safety-rejected teacher
  shows their own last decision; a different, still-pending teacher stays clean` (11 tests in this
  file ran, not skipped: `TEST_DATABASE_URL` was set).
- `packages/db/test/repositories.int.test.ts` — the `audit.findLastVerifyForStaff` grid entry:
  non-staff `scope`, `null` before any decision, `status` after reject then re-verify, `integrity`
  on a corrupt stored row.
- `packages/db/test/audit.test.ts` — every malformed `by`/`teacherId` case is `invalid` before any
  SQL.
- Gate: `corepack pnpm turbo run typecheck lint test --filter=@edmate/db --filter=@edmate/web
  --force --concurrency=1` → `EXIT:0`; `@edmate/db` Test Files 77 passed (77), Tests 1624 passed |
  4 skipped (1628); `@edmate/web` Test Files 157 passed (157), Tests 2493 passed (2493).
  `python3 .githooks/secret-scan.py --all` → clean (no output).

## Decisions

### 25 Oct 2026 · 9.3h staff console shows active takedowns and the last decision · decided by builder · risk: high
- Decided: a new staff-only, read-only `audit.findLastVerifyForStaff` (own role check, no lock)
  and the existing `takedowns.listActiveForStaff` feed a new `enrichQueueRows` helper in
  `apps/web`'s staff verification handlers, so the pending queue and the slug lookup both show a
  teacher's active takedowns and last verify/reject decision — closing 9.3f's Q4 gap (a
  safety-rejected teacher who edits their subject back to `pending` no longer reappears in the
  queue with no history). `teacher-profiles.ts`, `cli.ts` and `redact-json.ts` (8.1b, in review in
  parallel) and `subscriptions.ts`/`agents.ts`/`apps/web/app/{home,learn}/**` (9.3i, planned in
  parallel) are untouched.
- Why: the acceptance line needs this history surfaced without a new write or a change to the
  existing queue/lookup row shape; reusing the two existing/new reads keeps the change inside
  `apps/web` and one new `packages/db` read, with no migration.

### 25 Oct 2026 · 9.3k opened for subject-edit history · decided by lead · risk: low
- Decided: the board title's "subject-edit history" is not part of this acceptance line; it moves
  to new board task 9.3k.
- Why: the acceptance line (verbatim, from the board) only asks for active takedowns and the last
  verify/reject decision, not a full subject-edit history.

### 25 Oct 2026 · route.int.test.ts's new case proves lastDecision end-to-end and activeTakedowns's own-rows-only isolation, not a non-empty real takedown row · decided by builder · risk: low
- Decided: see "Deviation from the plan" above.
- Why: a non-empty `activeTakedowns` row needs a live agent (course + style card), disproportionate
  for one int-test case; the non-empty path is already proven over real Postgres in
  `packages/db` and at the unit level in `route.test.ts`.

### 25 Oct 2026 · 9.3h budget overrun (303 calls against 60) · decided by lead · risk: low
- Decided: accept 9.3h at 303 tool calls (harness count over three runs: 130, 50 and 123) against the plan's 60; no rework.
- Why: two runs stalled when the Mac slept on battery (B-57) and each restart re-read the plan and re-ran setup; all four reviewers approved the result, so the overrun is setup and recovery cost, not scope creep.

### 25 Oct 2026 · 9.3h merge: staff takedowns and last decision (audit.ts, staff API) · decided by lead · risk: high
- Decided: merge 9.3h, which touches the risky paths packages/db/src/repositories/audit.ts (new findLastVerifyForStaff) and apps/web/app/api/staff/verifications/handlers.ts, after security-reviewer, database-reviewer, code-reviewer and typescript-reviewer (all Sonnet) approved with no CRITICAL or HIGH findings.
- Why: the new read is staff-only twice over (withRole on the route, lockRole in the repository), parameterised, bounded to one row, validates the stored shape, and route.int.test.ts proves own-rows-only isolation; the MEDIUM (no lookup-row view test) and LOW (reason returned but never rendered) are deferred to 9.3k.

## Budget

Tool calls used: 303 (harness count: 130 + 50 + 123 over three runs; two runs stalled when the Mac slept on battery)
