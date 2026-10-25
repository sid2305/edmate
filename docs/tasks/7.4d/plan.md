# 7.4d plan — quality gate cancels timed-out cases; timer follows the injected clock

Status: READY (lead-written plan, 25 Oct 2026)
Risk: low. No risky paths. No contracts change: `EvalTurnInput` and `RunOptions` live in packages/evals.
Budget: 35 tool calls (stop at 45 and report PARTIAL).

## Goal
Two LOWs from the 7.4a review (silent-failure-hunter), both in packages/evals/src/qualityGate.ts:
1. A case that times out keeps running in the background (`Promise.race` only stops counting it). Cancel it with an `AbortSignal`.
2. The per-case timeout uses a real `setTimeout` while the time left comes from the injected `now()`. Make the timer injectable so a test controls both together.

## Changes (packages/evals only)
1. `src/agent.ts`: `EvalTurnInput` gains optional `signal?: AbortSignal` (doc comment: an agent should stop work when it fires; ignoring it is allowed, the gate still stops counting the case).
2. `src/runner.ts`: `RunOptions` gains optional `signal?: AbortSignal`. `runCase` checks `signal?.aborted` before each turn and before each judge call and stops with an error result (an `AbortError`-style message, e.g. `case cancelled: gate deadline passed`) instead of making the next call. It passes `signal` to `opts.agent.reply({...})`. No change to the judge gateway (its port is in contracts; checking the signal between calls is enough).
   `runCaseSafely` keeps its contract (never throws).
3. `src/qualityGate.ts`:
   - Per case: create an `AbortController`, pass `signal` through `optsFor`, and call `controller.abort()` when the timeout side of the race wins. Remove the "no AbortSignal yet" comment.
   - `GateInput` gains optional `setTimer?: (ms: number, onFire: () => void) => () => void` (returns a cancel function). Default: the current `setTimeout`/`clearTimeout` pair. `afterMs` uses it. Doc comment: pass it together with `now` so the deadline and the timer share one clock.
4. Exports: nothing new is needed in `src/index.ts` unless a type is newly public (`GateInput` already is).

## Tests first (packages/evals/src/qualityGate.test.ts, runner.test.ts)
- qualityGate: an agent whose `reply` never resolves on its own but records `input.signal` and resolves/rejects when it aborts. With a fake `now` and `setTimer` driven by the test (no real waits, no `vi.useFakeTimers` needed), the case is marked not run, the gate fails, and the recorded signal is `aborted === true`.
- qualityGate: a case that finishes before the deadline never sees an aborted signal, and its timer is cancelled.
- runner: with an already-aborted signal, `runCase` makes no agent call and returns a failing result with the cancel message; with a signal aborted after turn 1 of a 2-turn case, turn 2's agent call is not made.

## Consumers (gate with dependents)
`EvalTurnInput` and `RunOptions` only gain optional fields, so implementers compile unchanged (apps/worker/src/gate/agent.ts, apps/cli/src/commands/eval/liveAgent.ts). Do not wire the signal into the harness in this task.
Gate: `corepack pnpm turbo run build typecheck lint test --filter=...@edmate/evals` (leading `...` = every dependent: worker, web, cli), then `python3 .githooks/secret-scan.py --all`.

## Reviewers
code-reviewer, typescript-reviewer, silent-failure-hunter.

## Open questions
None.
