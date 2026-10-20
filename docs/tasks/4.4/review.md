# 4.4 review — APPROVE

Reviewers: architect (opus), security-reviewer (sonnet), safety-reviewer (opus), code-reviewer (sonnet), typescript-reviewer (opus)

Rounds. Before the sync, architect and security-reviewer approved the plan and ADR-0006 with its contracts change, and safety-reviewer ran twice on PR #47. Fix rounds 1 and 2 in `handoff.md` record and fix its HIGHs and MEDIUMs. After main was merged in at a374a5a, code-reviewer and typescript-reviewer reviewed the whole branch on 20 Oct 2026. Neither found a CRITICAL or HIGH. Under MVP first (20 Oct 2026), the lead signed the 47 pending safety cases (`reviewed_by: lead`). The safety-reviewer pass on the final head is waived until 13.3.

## Findings

- [LOW] [deferred 4.4f] packages/harness/src/pipeline/runner.block.test.ts:46 — inconsistent indentation, left over from resolving the merge (code-reviewer)
- [LOW] [deferred 4.4f] packages/harness/src/pipeline/runner.ts:748 — `code: string | undefined` and `types.ts:385` `withheldCode?: string` widen `Exclude<SafetyEventCode,'self_harm'>`; give both the narrow type (typescript-reviewer)
- [LOW] [deferred 4.4f] packages/queue/src/queues.ts:239 — the guard and source enums in queues.ts and db `safety-events.ts:21` are copied from the port's inline union with no compile-time link; add `expectTypeOf` equality tests (typescript-reviewer)
- [LOW] [deferred 4.4f] packages/harness/src/guardrails/moderationIn.ts:74 — the safety event is recorded before `preGuardAlert` parses the alert, so a parse throw leaves a row and the generic reply; build the alert first (typescript-reviewer)
- [LOW] [deferred 4.4f] packages/harness/src/guardrails/safetyClassifier.ts:165 — the `cancel.onCancel` listener is never removed; the token only lives for one turn (typescript-reviewer)
- [LOW] [deferred 4.4f] packages/harness/src/guardrails/jailbreak.ts:28 — `block()` has no explicit return type; annotate it `Promise<GuardRun>` (typescript-reviewer)
