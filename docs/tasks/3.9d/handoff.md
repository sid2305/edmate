# 3.9d handoff: apps/worker real-clock turn test CI flake

Status: DONE
Branch: m3/3.9d-worker-clock-flake (built locally as work-3.9d)
Worktree: .claude/worktrees/agent-ac71ee3e088dfffbb

## Summary
The worker's integration tests ran full harness turns on the plain real clock. On a loaded CI runner
the cold first turn's preGuard overran its 400 ms step budget (300 ms guard slice) and failed closed
with `{ type: 'error', code: 'guard_blocked', retryable: true }` (PR #90, safetyEvent.int.test.ts).
apps/worker has no turn-deps builder: each int test built its own inline real clock. They now all use
a local `slackClock()` (the same approach as 3.9b's apps/cli fix): real time, with `sleep` and
`now()` both slowed 10x, so every step budget gets 10x slack and real Redis/Postgres I/O still isn't
read as a deadlock. Production budgets and clocks are unchanged; no `src/` or `packages/` file changed.
Failing turn assertions now print the error events and the trace's step outcomes.

## Files
- `apps/worker/test/clock.ts` (new): `STEP_BUDGET_SLACK = 10`, `slackClock(factor)`. A local copy of
  apps/cli's helper; there is no shared test-helper package, and apps/worker must not depend on apps/cli.
- `apps/worker/test/clock.test.ts` (new): sleep and now() slow together; cancel ends a sleep early;
  an already-cancelled token returns at once.
- `apps/worker/test/safetyEvent.int.test.ts`: `turn()` defaults to `slackClock()` and takes
  `{ clock?, slowRecordMs? }`; `expectFirstEvent` prints errors + trace steps; new test "a 10x-slow
  runner" delays the jailbreak guard's safety-event record by 1 s of real time (past the real 300 ms
  slice, inside the slacked one) and stays green; warm-up comment updated.
- `apps/worker/test/alert.int.test.ts`, `apps/worker/test/commit.int.test.ts`: `slackClock()` instead
  of an inline real clock; diagnostic messages on the turn assertions.

## Tests (acceptance evidence)
- RED, slow-runner test with `slackClock(1)` (= the real clock), reproduces the CI failure:
  `AssertionError: {"errors":[{"type":"error","code":"guard_blocked","retryable":true}],"steps":[...,{"name":"preGuard","ms":304,"outcome":"failed"},...]}`
- GREEN: `vitest run test/safetyEvent.int.test.ts` → `Tests 4 passed (4)`;
  `vitest run test/commit.int.test.ts test/alert.int.test.ts` → `Tests 10 passed (10)`.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker... --force` twice in a row →
  `Tasks: 34 successful, 34 total` both times; worker `Test Files 21 passed (21)`; int tests ran
  against local compose Postgres (55432) and Redis (56379), none skipped.
- `python3 .githooks/secret-scan.py --all` → exit 0.

Acceptance: worker tests run full turns on a slack clock (all three int files); a forced slow runner
(1 s real delay inside a 300 ms guard slice) stays green; production budgets unchanged.

## Deviations
- No turn-deps builder exists in apps/worker, so there was no optional `clock` parameter to thread
  through `src/`; the slack clock is applied where each test builds its deps.
- Prettier collapsed one multi-line import in alert.int.test.ts (formatting only).
- Risky paths touched: none.

## Decisions
- A slack test clock (10x), not a longer production budget, same as 3.9b · risk: low.
- A local copy of `slackClock` in `apps/worker/test/clock.ts` rather than moving apps/cli's into a
  shared package (no shared test-helper place exists; plan step 2) · risk: low.
- The slow-runner test slows the safety-event port (real I/O inside the guard slice) rather than the
  model, because the jailbreak block is rule-based and makes no model call · risk: low.
