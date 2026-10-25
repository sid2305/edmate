# 9.3d plan — subscriptions.start against a concurrent verification change

Status: READY (lead-written plan, 25 Oct 2026)

Source: `docs/tasks/9.3c/review.md` lines 7–8 (deferred 9.3d). Tests only; no production change
unless a test finds a bug (then STOP and return PARTIAL with the failing test, don't fix
production code without the lead).

## Tests (packages/db/test/repositories.int.test.ts, next to the 9.3c tests around line 4769–4858)
1. **Concurrent rejection (database-reviewer MEDIUM).** Use a second, separate `pg` client/pool
   connection on TEST_DATABASE_URL. In it: `BEGIN`, take the same row lock setVerification takes on
   the teacher's `teacher_profiles` row (`SELECT ... FOR UPDATE`, or check
   `packages/db/src/repositories/teacher-profiles.ts` setVerification and reproduce its lock), and
   `UPDATE` verification_status to `'rejected'` — do not commit yet. Then start
   `subscriptions.start(...)` for a student on that teacher's package on the main connection
   **without awaiting it**. Prove it is blocked on the lock (poll `pg_stat_activity` / `pg_locks`
   for a waiting backend with a short bounded loop, e.g. up to 2 s, rather than a fixed sleep). Then
   `COMMIT` the second client. Assert start rejects with the same error kind as the existing
   rejected-teacher test (line 4815) and that no subscriptions row (and no ledger/other side-effect
   row that start writes) exists for that student. Always release the second client in `finally`
   (ROLLBACK if still open) so a failure can't hang the suite. Give the test a bounded timeout.
   - Add the mirror case only if cheap: a concurrent verify (pending → verified) committed while
     start waits → start succeeds. Optional.
2. **Pending teacher (security-reviewer LOW).** `subscriptions.start` on a never-verified
   (`pending`) teacher's package refuses with the same error kind and writes nothing. Reuse the 9.3c
   fixture helpers; restore any shared state the test changes (the suite shares one database).

## Rules
- Use fixtures and ids the suite already uses; no real personal data.
- Touch only `packages/db/test/repositories.int.test.ts` (and a test helper file in packages/db/test
  if one exists for this). `packages/db/src/repositories/**` is a risky path; this task should not
  touch it.
- Reviewers: database-reviewer, code-reviewer (typescript-reviewer optional for a test-only diff).

## Gate
`TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run
typecheck lint test --filter=@edmate/db...`; run the new tests 5 times in a row to show they are
not flaky (`corepack pnpm --filter @edmate/db exec vitest run test/repositories.int.test.ts -t "<name>"`).

## Budget
About 40 tool calls.
