# 9.3d handoff — subscriptions.start against a concurrent verification change

Status: DONE

Branch: `m13/9.3d-start-concurrent-verification`
Worktree: builder's own auto worktree
sha: `15134721039e342076717b956854ee701cfc7ec3`

## Summary

Test-only change, no production bug found, in
`packages/db/test/repositories.int.test.ts` (next to the 9.3c fixtures, lines ~4856-5020):

1. **Concurrent rejection test.** A second `pg.Client` on `TEST_URL` opens its own transaction,
   takes `select ... for update` on the same `teacher_profiles` row `setVerification` locks, and
   updates `verification_status = 'rejected'` without committing. `subscriptions.start` is started
   without awaiting; a bounded poll (up to 2s, `pg_stat_activity.wait_event_type = 'Lock'`) proves
   it is really blocked, not racing ahead on a stale read, since `start`'s insert-select takes
   `for share of teacherProfiles` — a lock mode that conflicts with `for update`. The second
   client then commits; `start` rejects with `kind: 'not_found'` (same as the existing 9.3c
   rejected-teacher test) and a `snapshot()` plus row counts on `subscriptions`/`audit_log` for the
   student confirm nothing was written. The second client is released in `finally`
   (`rollback` then `end`, swallowing errors) so a failure can't hang the suite. Test timeout
   bumped to 10s. The optional mirror case (pending → verified committed while start waits) was
   skipped to stay in budget; the required direction (reject while start waits) is covered.
2. **Pending teacher test.** A fresh, never-verified (`pending`) teacher/package/student fixture
   (`tch_93d2`/`pkg_93d2`/`pv_93d2`/`stu_93d2`) reusing `packageConfig` from the 9.3c helpers;
   `subscriptions.start` rejects `not_found` and writes nothing. Self-contained ids, so no shared
   state needed restoring.

Prettier also reformatted several pre-existing long lines elsewhere in the same file (no
behavior change) to make `prettier --check` pass on the whole file.

No change to `packages/db/src/repositories/**` — no bug was found.

## Decisions

### 25 Oct 2026 · 9.3d skip the optional pending→verified mirror case · decided by builder · risk: low
- Decided: implemented only the required concurrent-reject case and the pending-teacher case;
  skipped the plan's optional "mirror case" (a concurrent verify committed while start waits →
  start succeeds).
- Why: the plan marked it explicitly optional ("Add ... only if cheap"), the required coverage
  (reviewer's MEDIUM and LOW) is fully addressed by the two tests added, and skipping kept the
  build inside its ~40 tool-call budget.

## Gate

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`
  → `Tasks: 26 successful, 26 total`; `@edmate/db:test` coverage `All files 99.66% stmts /
  97.85% branch / 99.65% funcs / 99.71% lines`, `subscriptions.ts` at 100/100/100/100.
- New tests run alone and together (`vitest run test/repositories.int.test.ts`, unfiltered):
  `Tests 186 passed (186)`.
- The two new tests run 5x in a row via `-t "subscriptions.start blocks on a concurrent
  verification write"`: 5/5 passed, no flakes (durations 3.0–4.0s each).
  (Note: running a narrow `-t "subscriptions.start"` filter that also matches the grid's
  generic `subscriptions.start` case skips intervening setup tests and makes the unrelated,
  pre-existing 9.3c test fail on its own — a quirk of partial `-t` filtering that skips fixture
  setup, not a bug; the full, unfiltered suite passes 186/186.)
- `corepack pnpm exec prettier --check packages/db/test/repositories.int.test.ts` → all matched
  files use Prettier code style (after one `--write` to fix pre-existing drift).
- `python3 .githooks/secret-scan.py --all` → clean, no output.

## Fix round

Fixed a HIGH raised by typescript-reviewer: in the concurrent-rejection test, if the bounded
poll's `expect(waiting, ...).toBe(true)` (~line 4953) throws, control used to jump to `finally`
while the unawaited `repos.subscriptions.start(...)` promise (`started`) was still in flight.
`finally` rolled back `locker` before `started` had a chance to resolve, so an abandoned `start()`
could insert a real `subscriptions` row for `stu_93d` that nothing cleaned up.

Fix: `started` and a `startedSettled` flag are now declared outside the `try` block so `finally`
can see them. `started.finally(() => { startedSettled = true; })` tracks completion without
blocking. In `finally`, after releasing `locker` (`rollback` then `end`), if `started` never
settled on its own we `await started.catch(() => {})` so it can't outlive the test, then delete
any `subscriptions`/`audit_log` rows for `stu_93d` (a fixture id unique to this test) as a
belt-and-suspenders cleanup for the abandoned-insert case. The happy path is unchanged: when the
test reaches its own `await started`, `startedSettled` is already true by the time `finally`
runs, so the extra `await` and deletes are no-ops.

Also removed the dead `pg_stat_clear_snapshot()` call inside the poll loop (LOW, same reviewer).

## Gate (fix round)

- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run typecheck lint test --filter=@edmate/db...`
  → `Tasks: 26 successful, 26 total`; int tests ran (not skipped) — coverage confirms
  `subscriptions.ts` at 100/100/100/100 and `src/repositories` overall 100/98.45/100/100.
- `corepack pnpm exec prettier --check packages/db/test/repositories.int.test.ts` → all matched
  files use Prettier code style.
- `python3 .githooks/secret-scan.py --all` → clean, no output.

Tool calls used: 14

## Budget

Tool calls used: 32 (original build) + 14 (fix round)
