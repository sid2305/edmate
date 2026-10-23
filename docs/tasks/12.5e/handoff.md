# 12.5e handoff: alert.raise logs a store.record failure before awaiting notify

**Status:** DONE
**Branch:** m13/12.5e-alert-store-log (built on local branch `work-125e` in the builder's auto worktree `.claude/worktrees/agent-a3754e71bdb778d55`)

## What changed

- `apps/worker/src/alerts/processors.ts`: in `alert.raise`, the `safety_alert.store_failed` log line
  (alert id and error name only, never the message or excerpt) is now written inside the `catch`
  of `store.record`, before `notify` is awaited. Before, it was written after `notify`, so a joint
  DB and notifier outage lost the store-failure log. Retry behaviour is unchanged: notify still runs
  when the store fails, the store error is still rethrown after a successful notify, and a notify
  error still propagates so BullMQ retries. Header comment updated to say so.
- `apps/worker/src/alerts/processors.test.ts` (tests first, RED then GREEN):
  - the existing record-failure test now expects `store_failed` before `notified` (same two lines,
    new order);
  - new test: `store.record` and `notify` both throw → the job rejects with the notify error (so it
    retries), nothing was notified, exactly one `store_failed` line is logged, and the log carries
    neither the excerpt canary nor the DB error message.

## Evidence

- `corepack pnpm turbo run test --filter=@edmate/worker` before the fix → 2 failed (the reordered
  test and the new joint-outage test), 351 passed (RED).
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker` after the fix → exit 0,
  `Tasks: 11 successful, 11 total`, `Test Files 31 passed | 6 skipped (37)`,
  `Tests 353 passed | 31 skipped (384)` (the 6 skipped files are the DB integration tests that
  skip without Postgres).
- `python3 .githooks/secret-scan.py --all` → exit 0.

## Deviations

None. Only the two named source files and this handoff changed.

## Decisions

### 22 Oct 2026 · 12.5e: store failure logged before notify in apps/worker/src/alerts · decided by builder · risk: high
- Decided: `alert.raise` logs `safety_alert.store_failed` in the `catch` of `store.record`, before
  it awaits the trust-team notify; the throw that makes BullMQ retry stays where it was (after a
  successful notify), and a notify error still propagates on its own.
- Why: the 12.5b review found that a joint DB and notifier outage never logged the store failure
  because the log sat after an unguarded `await notify`. Logging in the catch costs nothing and
  keeps the retry and notify-anyway behaviour identical; the log carries ids and the error name
  only.
- risk: high (apps/worker/src/alerts is a risky path; behaviour change is log ordering only).

Tool calls used: 24 (harness count: builder 24; the agent reported 19)
