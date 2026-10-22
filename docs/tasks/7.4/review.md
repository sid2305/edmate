# 7.4 review — APPROVE

Reviewers: security-reviewer (sonnet), code-reviewer (sonnet), typescript-reviewer (opus)

Phase C (apps/cli `edmate gate demo`) reviewed by code-reviewer (sonnet) and typescript-reviewer (sonnet); both approved.

Phases A (packages/evals gate library) and B (packages/db `teacherEvalCases.listForTeacher`) reviewed on 21 Oct 2026. 

## Findings
- [MEDIUM] [deferred 7.4a] packages/evals/src/qualityGate.ts — the deadline is checked only before a case starts; a single agent or judge call that never settles hangs `runQualityGate`, and a case that starts just before the deadline and finishes long after it still passes. Publish stays blocked, but the 8.7 publish flow would hang. Race each case against the time left and thread an AbortSignal through later.
- [MEDIUM] [deferred 7.4a] packages/evals/src/qualityGate.ts — `agentFor` is called outside `runCaseSafely`'s try/catch; a throw rejects the gate while other workers keep calling in the background. Fails closed (nothing publishes). Resolve agents per package before the pool starts.
- [LOW] [deferred 7.4a] packages/evals/src/qualityGate.ts — not-run cases are counted by comparing the error message; use a structural flag.
- [LOW] [deferred 7.4a] packages/evals/src/qualityGate.ts — `GateGroupResult` should be a discriminated union on `pass`.
- [LOW] [deferred 7.4a] packages/evals/src/qualityGate.ts — `as ScopedCase` cast; use a guard or `entries()`.
- [LOW] [deferred 7.4a] packages/evals/src/qualityGate.ts — `changes` echoed without de-duplication.
- [LOW] [deferred 7.4b] packages/evals/src/gateScope.ts — a full scope can't pass on today's suites (feedback and revision have no threshold, no platform accuracy cases); waiting on the human's answer (blocker B-40) before Phase C.
- [MEDIUM] [deferred 7.4a] apps/cli/src/commands/gate.ts — `fullScopeGaps` re-implements gateScope.ts's distress grouping (its own prefix and `as GateGroup` cast) instead of a shared exported classifier; it can drift silently.
- [LOW] [deferred 7.4a] apps/cli/src/commands/gate/demoInput.ts — near-verbatim copy of the evals testkit's `adapt()`; extract one shared adapter.
- [LOW] [deferred 7.4a] apps/cli/src/commands/gate.ts — `GateCommandDeps.now` is unused and typed `() => Date` where the gate takes `() => number`.
