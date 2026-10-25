# Plan: 7.4a — Quality gate hardening (7.4 / 7.4b / 7.4c / 7.8 review follow-ups)

## Acceptance (verbatim)
"A hung case fails the gate within the deadline, an agentFor throw stops all workers, and the
7.4 tests still pass."

How shown: new tests in `packages/evals/src/qualityGate.test.ts` for (1) a case whose agent reply
never resolves still fails the gate once the deadline passes (via `vi.useFakeTimers()` +
`vi.advanceTimersByTimeAsync`, no real wall-clock wait), and (2) an `agentFor` that throws for one
package rejects `runQualityGate` before any worker starts (assert no other agent call happened).
Every existing test file touched (`qualityGate.test.ts`, `gateScope.test.ts`, `scorecard.test.ts`,
`qualityGateDemo.test.ts`, `perAgentSuiteDemo.test.ts`, `apps/cli/src/commands/gate.test.ts`)
stays green. `turbo run typecheck lint test --filter=@edmate/evals --filter=<cli package>`.

## Scope decided by the title (must be in, per lead's MVP-first note)
1. Race each case against the time left on the deadline, not just check it before starting
   (qualityGate.ts). Threading a real `AbortSignal` into the agent/judge adapters is explicitly
   deferred further ("thread an AbortSignal through later" — the title defers it past 7.4a too);
   7.4a only stops *counting* a hung case, it cannot cancel the in-flight call.
2. Resolve `agentFor` per package before the worker pool starts, so a throw happens once,
   synchronously, before any worker runs (qualityGate.ts).
3. Count not-run cases with a structural flag, not by comparing `error` text (qualityGate.ts).
4. `GateGroupResult` → discriminated union on `pass` (qualityGate.ts).
5. Drop the `as ScopedCase` cast; use a guard (qualityGate.ts).
6. De-duplicate `changes` in `GateResult` (qualityGate.ts).
7. Export a non-throwing group classifier from `gateScope.ts`; `apps/cli` `gate.ts`'s
   `fullScopeGaps` uses it instead of its own distress-prefix constants and `as GateGroup` cast.
8. One shared demo-content adapter for `apps/cli/src/commands/gate/demoInput.ts` and the evals
   testkit (`demoSuiteInput.testkit.ts`), instead of a near-verbatim copy.
9. Drop the unused `GateCommandDeps.now` (confirmed dead: no test or caller sets it).
10. `scorecard.ts`: `Object.keys(SCORECARD_GROUPS) as ScorecardCategoryKey[]` → a typed key list.
11. `gateScope.ts`: add a test that `defaultGateDeadlineMs`'s non-full-scope default equals
    `qualityGate.ts`'s `GATE_DEADLINE_MS` (test-only; no new shared constant needed — importing
    `GATE_DEADLINE_MS` into `gateScope.test.ts` doesn't create the import cycle the two modules
    avoid between each other).
12. `selectGateCases` reuses one `Set`, not a second one inside `validateAndCheckFull`.

Nothing here needs a `packages/contracts` change or an ADR; no real model calls; scripted
gateway / `manualClock()` / `ScriptedGateway` / `vi.useFakeTimers()` only.

## Phase A — packages/evals core gate logic (items 1–6, 11, 12)
Files to create/modify:
- `packages/evals/src/qualityGate.ts` — deadline race, pre-resolved `agentFor`, structural
  not-run flag, discriminated `GateGroupResult`, drop the cast, de-dupe `changes`.
- `packages/evals/src/qualityGate.test.ts` — hung-case test, `agentFor`-throws-before-any-worker
  test; update any assertion that relied on the old union shape (should be none — the runtime
  shape doesn't change, only the type).
- `packages/evals/src/gateScope.ts` — `selectGateCases` passes its `Set` into
  `validateAndCheckFull` instead of rebuilding one.
- `packages/evals/src/gateScope.test.ts` — add the `GATE_DEADLINE_MS` equality test (import from
  `./qualityGate.js`).
- `packages/evals/src/scorecard.ts` — typed key list instead of the `as ScorecardCategoryKey[]`
  cast.

Files out of bounds this phase: everything else, especially `evals/suites/**`,
`packages/db/**`, `packages/harness/src/guardrails/**`, `apps/cli/**`, `packages/contracts/**`.

Tests first: write the hung-case and agentFor-throws tests before touching `qualityGate.ts`'s
logic; run `vitest run` red, then implement.

Risky paths touched: none (checked against `.claude/skills/merge-gate/risk-paths.txt`) — nothing
under `packages/evals` or its tests is listed.

Exit for this phase: `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals` green;
commit on `m13/7.4a-gate-hardening-a` (or the branch the lead names); handoff notes which items
(1–6, 11, 12) landed and the exact new/changed test names for Phase B's builder to build on.

## Phase B — shared classifier and shared demo adapter (items 7, 8, 9)
Starts after Phase A merges; its builder reads Phase A's handoff and the merged `gateScope.ts`.

Files to create/modify:
- `packages/evals/src/gateScope.ts` — export a non-throwing classifier, e.g.
  `tryGroupOf(evalCase: EvalCase): GateGroup | undefined`, built from the same
  `DISTRESS_PREFIX` / `DISTRESS_NEARMISS_PREFIX` logic as `groupOf`; have `groupOf` call it and
  throw when it returns `undefined` (one implementation, not two).
- `packages/evals/src/gateScope.test.ts` — cover `tryGroupOf` directly (distress, near-miss,
  known suite, unknown suite → `undefined`).
- New file `packages/evals/src/demoContentAdapter.ts` — the shared adapter
  (`adaptDemoTeacherContent(content: DemoTeacherContent): PerAgentSuiteInput`, plus the
  `PACKAGE_IDS` constant and `toPackage` helper it needs), moved out of
  `apps/cli/src/commands/gate/demoInput.ts` and `demoSuiteInput.testkit.ts` verbatim (no behaviour
  change — minus the two synthetic `teacher-answer` rows, which stay only in the testkit).
- `packages/evals/src/index.ts` — export the new adapter (and its types, if not already exported).
- `packages/evals/package.json` — promote `@edmate/content` from `devDependencies` to
  `dependencies` (it's now imported by src, not just tests); note this as a `## Decisions` entry
  in the handoff (an internal workspace-dependency change, not a tech-stack or contracts change,
  so no ADR; `apps/cli` already depends on `@edmate/content` directly, so this doesn't add a new
  package to the dependency graph, only a new edge within it).
- `packages/evals/src/demoSuiteInput.testkit.ts` — call the shared adapter, then append the two
  `APPROVED_DRAFT_ROWS` to `answerable`.
- `apps/cli/src/commands/gate/demoInput.ts` — call the shared adapter; keep only
  `GATE_DEMO_CONTENT_DIR` and `loadDemoPerAgentInput`.
- `apps/cli/src/commands/gate.ts` — `fullScopeGaps` uses `tryGroupOf` from `@edmate/evals`
  instead of its own `DISTRESS_PREFIX` / `DISTRESS_NEARMISS_PREFIX` constants and `as GateGroup`
  cast; drop the unused `now` from `GateCommandDeps`.
- `apps/cli/src/commands/gate.test.ts` — no behaviour change expected; re-run as a regression
  check, add a case only if `tryGroupOf`'s wiring changes an error message.

Files out of bounds this phase: `evals/suites/**`, `packages/db/**`,
`packages/harness/src/guardrails/**`, `packages/contracts/**`, anything under `content/**` other
than reading the existing demo-teacher fixtures (read-only, unchanged).

Tests first: add the `tryGroupOf` unit tests before wiring `gate.ts` to it; keep
`demoSuiteInput.testkit.ts`'s and `demoInput.ts`'s existing tests (`qualityGateDemo.test.ts`,
`perAgentSuiteDemo.test.ts`, `gate.test.ts`) green throughout — they're the regression net for
"no behaviour change" on this refactor.

Risky paths touched: none (checked against `.claude/skills/merge-gate/risk-paths.txt`) —
`packages/evals/**` and `apps/cli/src/commands/gate*` are not listed; `.claude/**` is not touched.

Exit for this phase: `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals
--filter=<cli package name>` green; commit on `m13/7.4a-gate-hardening-b` (or as the lead names
it); PR covers both phases' diffs together if the lead prefers one PR, or Phase B opens its own
PR against Phase A's merged `main` — the lead decides at merge time, not this plan.

## Open questions
None blocking. One decision worth logging at merge (not `risk: high` — no risky path, no
contracts change): promoting `@edmate/content` to a real dependency of `packages/evals`
(Phase B item). The lead or Phase B's builder should add a one-line `## Decisions` entry for it.

## Risky paths touched
None (checked against `.claude/skills/merge-gate/risk-paths.txt`) for both phases.

## Budget
Budget: 90 tool calls (2 phases, packages/evals + apps/cli)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (pnpm typecheck/lint/test only, and the secret scan)

## Exit conditions
Status: DONE when its phase's `turbo run typecheck lint test` is green, the acceptance's three
behaviours are covered by a new or updated test, and every pre-existing 7.4-family test still
passes. Status: PARTIAL past ~45 tool calls in a phase, or if a file outside this plan's list
turns out to need changes (e.g. a contracts change is discovered) — stop and hand back rather
than expanding scope without the lead.
