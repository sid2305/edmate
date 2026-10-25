# 7.4d handoff — quality gate cancels timed-out cases; timer follows the injected clock

Status: DONE

## What changed
- `packages/evals/src/agent.ts`: `EvalTurnInput` gains optional `signal?: AbortSignal`, documented
  as firing when the gate stops counting a case; an agent may ignore it.
- `packages/evals/src/runner.ts`: `RunOptions` gains optional `signal?: AbortSignal`. `runTurns`
  (shared by `runCase` and `runCaseSafely`) checks the signal before each turn's agent call and
  before each judge call via a new `checkCancelled` helper, throwing the exported
  `CASE_CANCELLED = 'case cancelled: gate deadline passed'` message instead of making the next
  call. The signal is also passed through to `opts.agent.reply({ ... signal })`. `runCaseSafely`'s
  contract (never throws) is unchanged: the thrown cancel error is caught there like any other
  run error.
- `packages/evals/src/qualityGate.ts`:
  - `GateInput` gains optional `setTimer?: (ms: number, onFire: () => void) => () => void`,
    documented to be passed together with `now` so the deadline and the timer share one clock.
    Default: `defaultSetTimer` (a plain `setTimeout`/`clearTimeout` pair).
  - `afterMs` takes a `setTimer` parameter instead of calling `setTimeout` directly.
  - Per case, `runQualityGate` creates an `AbortController`, passes `controller.signal` through
    `optsFor` (which now takes a required `signal` parameter) into `RunOptions`, and calls
    `controller.abort()` when the timeout side of the `Promise.race` wins. Removed the stale
    "no AbortSignal yet" comment.
- Tests (test-first):
  - `packages/evals/src/runner.test.ts`: new `describe('cancellation via AbortSignal (task 7.4d)')`
    — already-aborted signal makes no agent call and rejects with the cancel message; a signal
    aborted after turn 1 of a 2-turn case stops before turn 2's agent call; the signal object seen
    by the agent reflects `aborted` live once the caller aborts it.
  - `packages/evals/src/qualityGate.test.ts`: two new tests under `describe('runQualityGate')` —
    a hung case's signal is aborted once a test-controlled `setTimer`'s fire callback is invoked
    (no real or fake timers: the test flushes microtasks with a bounded `await Promise.resolve()`
    loop), and a case that finishes first never sees an aborted signal while its timer is cancelled.

No contracts change. `EvalTurnInput` and `RunOptions` only gained optional fields, so
`apps/worker/src/gate/agent.ts` and `apps/cli/src/commands/eval/liveAgent.ts` compile unchanged
(verified by the dependents gate below); the signal is not wired into the harness in this task.

## Decisions
### 25 Oct 2026 · 7.4d cancel message wording · decided by builder · risk: low
- Decided: the cancelled-case error message is the literal string
  `case cancelled: gate deadline passed`, exported as `CASE_CANCELLED` from
  `packages/evals/src/runner.ts`, and reused by both new tests.
- Why: the plan gave this exact wording as an example; exporting it keeps the test and any future
  caller from re-typing (and risking drifting from) the literal string.

### 25 Oct 2026 · 7.4d optsFor now takes a required signal · decided by builder · risk: low
- Decided: `optsFor(packageId, signal)` in `packages/evals/src/qualityGate.ts` takes `signal` as a
  required second parameter (not optional), since `runQualityGate` always creates a fresh
  `AbortController` per case before calling it.
- Why: keeps the one caller and the one callee in lock-step without an unreachable `undefined`
  branch to test or reason about.

## Left to do
None.

## Evidence
- `export PATH=$HOME/.nvm/versions/node/v22.22.3/bin:$PATH; corepack pnpm turbo run build --filter=@edmate/evals^...`
  → `Tasks: 3 successful, 3 total` (contracts, harness, content; cache hit).
- `corepack pnpm vitest run src/runner.test.ts` (packages/evals) → `Test Files 1 passed (1)`,
  `Tests 33 passed (33)`.
- `corepack pnpm vitest run src/qualityGate.test.ts` (packages/evals) → `Test Files 1 passed (1)`,
  `Tests 24 passed (24)`.
- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run build typecheck lint test --filter=...@edmate/evals`
  (dependents: worker, web, cli included) → `Tasks: 19 successful, 19 total`. No flakes on this
  run, so no re-run was needed.
- `python3 .githooks/secret-scan.py --all` → no output, exit 0 (clean).

## Budget
Tool calls used: 30
