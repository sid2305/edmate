# 12.1a handoff: staff verification queue read (packages/db, Phase A of 12.1)

## Summary
Adds `teacherProfiles.listPendingForStaff(by)` to `packages/db`: a staff-only read of pending
teacher profiles (slug, subject, declared name and email, oldest first), capped at
`STAFF_QUEUE_MAX_LIMIT` (50). `by` is a plain id, checked against `users.role` with an unlocked
read (a read, not a write, per `role-lock.ts`'s own note); a malformed `by` is `invalid`, a
well-formed but non-staff `by` is `scope`. This is the one repository method that joins `users`
for `name` and `email` (never `phone`), the staff-only exception documented in
`packages/db/src/repositories/README.md` alongside `discovery.ts`'s existing exception.

No change to `setVerification` or `assertVerifiedForPublish` (8.1, unchanged). No migration: reuses
existing `teacher_profiles` and `users` columns. Only `packages/db` touched, per the plan's Phase A
scope; Phase B (apps/web console + risk-paths.txt) is a separate task.

## Files
- `packages/db/src/repositories/teacher-profiles.ts`: new `STAFF_QUEUE_MAX_LIMIT` and
  `listPendingForStaff`.
- `packages/db/src/repositories/map.ts`: new `TeacherVerificationQueueRowSchema` /
  `TeacherVerificationQueueRow` / `toTeacherVerificationQueueRow` (does not touch
  `TeacherProfileRowSchema`).
- `packages/db/src/repositories/index.ts`: one appended export line
  (`export { STAFF_QUEUE_MAX_LIMIT, type TeacherVerificationQueueRow } from './teacher-profiles.js';`)
  — no existing line edited or reordered.
- `packages/db/src/repositories/README.md`: updated rule 9 (the "no personal details" rule now
  names its two exceptions) and rule 11 (documents the new method's staff-only join).
- `packages/db/test/teacher-profiles.test.ts`: unit cases — malformed `by` is `invalid` before any
  SQL (no-db proxy).
- `packages/db/test/teacher-profiles.int.test.ts`: int cases — non-staff `by` (self, former staff,
  ghost id) is `scope`; a staff `by` sees only `pending` rows with the joined name/email, and an
  empty queue is `[]`.
- `packages/db/test/repositories.int.test.ts`: added `teacherProfiles.listPendingForStaff` to the
  isolation `CASES` record (a `public`-scope case, like `agents.owner`: no teacher/student scope at
  all) — shared file, added only this one case, next to `teacherProfiles.assertVerifiedForPublish`.
- `packages/db/test/scope.test.ts`: added `teacherProfiles.listPendingForStaff` to the "every method
  rejects a bad scope" grid's exclusion list (its `by` is a bare id, not a `TeacherScope`/
  `StudentScope` object, so some `BAD_SCOPES` entries are well-formed by its own schema — same class
  of exclusion as `discovery.search`); extended the "never reads from users" test's exception list
  to include `teacher-profiles.ts`, with its own assertion that it never mentions `users.phone` —
  shared file, added only these lines.

## Tests
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` → 26/26 tasks green (one
  unrelated flaky failure in `@edmate/content`'s `safeRegex.test.ts` timing probe on the first run,
  documented in `docs/lessons.md` as a shared-runner timing issue; reran green, and the test passes
  in isolation every time).
- `packages/db` int suite (own disposable Postgres container, not the running `edmate-*` ones):
  ```
  docker run -d --name db121a-pg -e POSTGRES_USER=edmate -e POSTGRES_PASSWORD=edmate-dev \
    -e POSTGRES_DB=edmate -p 127.0.0.1:55499:5432 \
    -v .../docker/postgres/init.sql:/docker-entrypoint-initdb.d/001-extensions.sql:ro \
    pgvector/pgvector:0.8.1-pg16
  TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55499/edmate corepack pnpm --filter @edmate/db test
  ```
  → `Test Files 62 passed (62)`, `Tests 1111 passed | 4 skipped (1115)`. Container removed after
  (`docker rm -f db121a-pg`).
- `python3 .githooks/secret-scan.py --all` → clean (no output, exit 0).
- Manual check (DB level, per the plan's "How it will be shown"; the UI half is Phase B): the int
  test seeds a staff user and two teacher profiles, verifies one via the existing
  `setVerification`, then confirms `listPendingForStaff` returns only the other (still-pending) one
  with its name and email, and that a non-staff `by` (including a former-staff id) is refused as
  `scope` and changes nothing. `assertVerifiedForPublish`'s existing re-assertion (8.1/8.7, unchanged)
  that an unverified teacher cannot publish is untouched and still passes.

## Decisions

### 22 Oct 2026 · 12.1a Staff-only join of users for name/email in listPendingForStaff · decided by builder · risk: high
- Decided: `teacherProfiles.listPendingForStaff` is the one repository method that selects
  `users.name` and `users.email` (never `phone`), gated by checking the caller's own role is
  `staff` right now (unlocked read of `users.role`, before any other SQL). `role-lock.ts` itself
  stays personal-data-free: the staff check here is a plain, local `select role from users` in
  `teacher-profiles.ts`, not routed through `role-lock.ts`, so that file's own test (it selects only
  `{ role: users.role }`) is unaffected.
- Why: staff need the teacher's declared name and email to actually check identity before
  approving or rejecting (same precedent as `identity.getUserByEmail`); the plan (Q2) accepted this
  scoped to this one method. `packages/db/src/repositories/**` is a risk path
  (`security-reviewer`), and this is the first repository method to read personal data outside
  `discovery.ts`'s existing public-display-name exception, so it is logged `risk: high` per the
  plan's "Risky paths touched" section.
- risk: high

### 22 Oct 2026 · 12.1a listPendingForStaff excluded from the scope.test.ts bad-scope grid · decided by builder · risk: low
- Decided: `teacherProfiles.listPendingForStaff` is excluded from `scope.test.ts`'s "every
  repository method rejects a bad scope" grid, with a comment explaining why (same pattern as the
  existing `discovery.search` exclusion).
- Why: that grid's `BAD_SCOPES` fixtures assume the first argument is a `TeacherScope`/
  `StudentScope` object; `listPendingForStaff`'s first argument is a bare staff id, so a fixture
  like the plain string `'tch_a'` is actually a well-formed id by `IdSchema` and would reach the
  database (against the grid's unreachable-host pool) instead of failing before any SQL. Its own
  malformed/non-staff cases are covered directly in `teacher-profiles.test.ts` and
  `teacher-profiles.int.test.ts`.
- risk: low

### 22 Oct 2026 · 12.1a isolation-grid case is `scope: 'public'`, not a teacher/student pair · decided by builder · risk: low
- Decided: `teacherProfiles.listPendingForStaff`'s entry in `repositories.int.test.ts`'s `CASES`
  record uses `scope: 'public'` (the `agents.owner`-style "no teacher or student scope at all"
  case), with its own `check` asserting the staff/non-staff split and that every returned row is
  `pending` with the right shape — not an exact pending set, since an earlier case in the same file
  (`teacherProfiles.assertVerifiedForPublish`) deliberately flips verification status for the
  teachers in the seed and test order determines which one ends up verified.
- Why: the method genuinely has no `TeacherScope`/`StudentScope` first argument, so it cannot run
  through `runGrid`'s per-teacher/per-pair actor loop; asserting the exact pending set would be
  brittle against `CASES`' insertion order (a correctness risk a future reorder could silently
  break). The int test in `teacher-profiles.int.test.ts` already asserts the exact pending set,
  name/email join and cap in an isolated, controlled database.
- risk: low

## Left to do
Phase B (apps/web staff console, risk-paths.txt addition, architect sign-off) is a separate task
per the plan's phase split; not started here.

Status: DONE
Tool calls used: 121 (harness count: build 92, fix round 29)

## Fix round
Two HIGH review findings fixed, test first (both new tests were run red before the source change;
the cap test needed no source change, only real coverage):
- `listPendingForStaff` now orders by `created_at` then `id`
  (`packages/db/src/repositories/teacher-profiles.ts`), like every other ordered query in the package.
- `packages/db/test/teacher-profiles.int.test.ts`:
  - "a staff user sees only pending teachers, oldest first, ties broken by id, with name and email
    joined": the 10 ms sleep is gone; A and B share one `created_at` and fixed ids (A's larger,
    rewritten first), and the queue must return B then A; after A is verified only B remains.
  - "is empty when nothing is pending" (split out of the old mislabelled test).
  - "never exceeds STAFF_QUEUE_MAX_LIMIT rows: the oldest ones come back": seeds
    `STAFF_QUEUE_MAX_LIMIT + 1` pending teachers (created newest-first, then dated oldest-first) and
    asserts exactly `STAFF_QUEUE_MAX_LIMIT` rows, oldest first.
