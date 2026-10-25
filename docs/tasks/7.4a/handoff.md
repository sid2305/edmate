# Handoff: 7.4a — quality gate hardening

Status: DONE (Phase A only — items 1–6, 11, 12).

## What changed

- `packages/evals/src/qualityGate.ts`
  - Each case now races the agent/judge call against the time left on the deadline (a
    `setTimeout`-backed race, cleared on the winning side) instead of only checking the deadline
    before starting: a case whose reply never resolves still fails the gate once the deadline
    passes (item 1). Cancelling the in-flight call is explicitly out of scope (no `AbortSignal`
    yet, per the title).
  - `agentFor` is resolved once per distinct package, synchronously, in a loop over
    `scope.cases` before the worker pool starts; a throw there now rejects `runQualityGate`
    before any worker (and so any agent call) runs (item 2).
  - Not-run cases are now counted with a structural `notRunFlags: boolean[]` array set at the
    point a case is marked not-run, instead of filtering `results` by
    `r.error === DEADLINE_NOT_RUN` (item 3). The `DEADLINE_NOT_RUN` message is unchanged and
    still set on the `CaseResult`, for display/back-compat.
  - `GateGroupResult` is now a discriminated union on `pass` (`pass: true` has no `reason`;
    `pass: false` requires one) instead of an optional `reason?` on a flat interface (item 4).
  - Dropped the `as ScopedCase` cast on `scope.cases[index]`; replaced with an
    `undefined`-check guard that throws (unreachable: `index < scope.cases.length`) (item 5).
  - `GateResult.changes` is now `[...new Set(input.changes)]`, de-duplicated (item 6).
- `packages/evals/src/qualityGate.test.ts`
  - New test `'fails a hung case once the deadline passes, without waiting for it to resolve
    (item 1)'`: `vi.useFakeTimers()` + an agent whose reply is a `Promise` that never resolves;
    `vi.advanceTimersByTimeAsync(GATE_DEADLINE_MS)` drives the race's timeout side.
  - New test `'rejects before any worker starts when agentFor throws for one package (item 2)'`:
    a two-package world where `agentFor('p2')` throws; asserts `runQualityGate` rejects and the
    first package's agent (`okAgent.calls`) never ran.
  - `groupVerdict`'s boundary test switched from `.reason` property access (no longer typed on
    the `pass: true` branch) to a `toMatchObject({ pass: false, reason: ... })` assertion.
  - No other existing assertion needed a change — the runtime shape is unchanged, only the type.
- `packages/evals/src/gateScope.ts`
  - `validateAndCheckFull` now takes a `ReadonlySet<string>` instead of rebuilding its own `Set`
    from a `readonly ChangeKind[]`; `selectGateCases` passes its existing `changes` Set straight
    through; `defaultGateDeadlineMs` builds the one `Set` it needs itself, since it has no
    caller-built one to reuse (item 12).
- `packages/evals/src/gateScope.test.ts`
  - New test: `defaultGateDeadlineMs(['material'])` equals `qualityGate.ts`'s exported
    `GATE_DEADLINE_MS` (item 11), imported directly (no cycle: `qualityGate.ts` already imports
    from `gateScope.ts`, not the reverse, and this is a test-only import).
- `packages/evals/src/scorecard.ts` (item 10, not explicitly listed in Phase A's file list but
  called out by the title's item 10 and touched by nothing else — see Decisions)
  - Replaced both `Object.keys(SCORECARD_GROUPS) as ScorecardCategoryKey[]` casts (the zod enum
    and `buildScorecard`'s category loop) with one typed, literal `SCORECARD_CATEGORY_KEYS`
    constant (`as const satisfies readonly ScorecardCategoryKey[]`).

## Evidence

```
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/evals --filter=@edmate/cli
...
@edmate/evals:test:  Test Files  31 passed (31)
@edmate/evals:test:       Tests  1423 passed (1423)
@edmate/cli:test:    (included in the same run; all cli tests green)
 Tasks:    11 successful, 11 total
```

```
$ python3 .githooks/secret-scan.py --all
(no output — clean)
```

New/changed test names for Phase B's builder to build on:
- `qualityGate.test.ts > runQualityGate > fails a hung case once the deadline passes, without
  waiting for it to resolve (item 1)`
- `qualityGate.test.ts > runQualityGate > rejects before any worker starts when agentFor throws
  for one package (item 2)`
- `gateScope.test.ts > defaultGateDeadlineMs > non-full-scope default equals qualityGate.ts's
  GATE_DEADLINE_MS (item 11, task 7.4a)`

## Decisions

### 25 Oct 2026 · 7.4a scorecard.ts typed key list · decided by builder · risk: low
- Decided: did item 10 (`scorecard.ts`'s typed key list, replacing
  `Object.keys(SCORECARD_GROUPS) as ScorecardCategoryKey[]`) in Phase A even though the plan's
  Phase A file list doesn't name `scorecard.ts`.
- Why: the plan's own numbered scope list (item 10) assigns it no phase letter and
  `scorecard.ts` isn't in Phase B's file list either; it's a same-file, same-kind change as
  item 11/12 (replacing a cast/duplicate with a typed construct) with zero dependency on Phase
  B's shared classifier or demo adapter work, so doing it now avoids a second untouched-file
  surprise for Phase B's builder. No behaviour change; covered by `scorecard.ts`'s existing
  100%-coverage tests (unchanged, still green).

### 25 Oct 2026 · 7.4a deadline race via setTimeout, no AbortSignal · decided by builder · risk: low
- Decided: implemented the deadline race with a plain `setTimeout`-backed `Promise.race` per
  case (cancelled via `clearTimeout` on whichever side wins), reading time via the existing
  `now()` injection point only for the "already past deadline" fast path, not for the race
  timer itself.
- Why: the acceptance only requires the *gate* to stop waiting and fail the case once the
  deadline passes under `vi.useFakeTimers()`; it does not require (and the plan explicitly
  defers) cancelling the underlying agent/judge call. `setTimeout` composes with
  `vi.useFakeTimers()` / `vi.advanceTimersByTimeAsync` out of the box, so the hung-case test
  needs no new clock abstraction. The manual-clock tests (`now: () => clock`) are unaffected
  because their agents resolve synchronously well before any real timer would fire, so the race
  always resolves on the "done" side in those tests, same behaviour as before.

## Left to do

Phase B (items 7, 8, 9 — not started, per plan): the non-throwing `tryGroupOf` classifier in
`gateScope.ts`, the shared `demoContentAdapter.ts` moved out of `apps/cli`'s `demoInput.ts` and
the evals testkit, dropping `GateCommandDeps.now`, and wiring `apps/cli/src/commands/gate.ts`'s
`fullScopeGaps` to the new classifier. Starts after this PR merges, per the plan.

## Budget

Tool calls used: 26
