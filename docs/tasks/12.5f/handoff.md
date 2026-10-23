# 12.5f handoff — alert store-failure flag

**Status:** DONE
**Branch:** m13/12.5f-alert-sentinel (local: work-125f)
**Worktree:** `.claude/worktrees/agent-afde6c78da9b8344d` (under the repo root)
**Builder:** tdd-guide (Fable 5.1)

## What changed

- `apps/worker/src/alerts/processors.ts`: `alert.raise` tracks a failed `store.record` with a boolean (`storeFailed`), not with `storeError !== undefined`. After notify, a failed store always fails the job: an `Error` is rethrown as is; a non-Error value (`undefined`, a string, ...) is wrapped by the new `asStoreError` in `new Error('safety_alert.store_failed: <errorName>', { cause })` so BullMQ always gets a real failure reason and retries. Everything else is unchanged: the store failure is logged before notify, notify still runs, a notify error still propagates.
- `apps/worker/src/alerts/processors.test.ts`: new `recordRejectsWith` option on the fake world; two tests written first (red on the branch before the fix): a store rejecting with `undefined` fails the job after notify and logs `UnknownError`; a store rejecting with a string fails with an Error whose `cause` is the value and whose message does not carry it.

## Evidence

- `corepack pnpm exec vitest run src/alerts/processors.test.ts` before the fix → `2 failed | 15 passed (17)` (the undefined case: "expected 'not thrown' to be an instance of Error").
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker --force` → exit 0, `Tasks: 11 successful, 11 total`, `Test Files 37 passed (37)`, `Tests 386 passed (386)`, none skipped (Postgres and Redis up).
- `python3 .githooks/secret-scan.py --all` → exit 0, no findings.

## Deviations

None. Only the two named files and this handoff changed.

## Decisions

### 22 Oct 2026 · 12.5f: store-failure flag in apps/worker/src/alerts · decided by builder · risk: high
- Decided: a failed `store.record` is tracked with a boolean; an Error rethrows as is, any non-Error rejection (including `undefined`) is wrapped in an Error whose message is `safety_alert.store_failed: <error name>` and whose `cause` is the original value.
- Why: BullMQ records the thrown value as the job's failed reason; throwing `undefined` would fail the job with no reason, and the message must not carry driver detail (error name only, matching the log line).
- risk: high (safety-alert path in apps/worker/src/alerts).

Tool calls used: 20 (harness count: builder 20; the agent reported 20)
