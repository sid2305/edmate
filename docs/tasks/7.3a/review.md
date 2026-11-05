# Review: 7.3a — Hindi/Hinglish locked-template variants

Verdict: APPROVE

Reviewers: code-reviewer, typescript-reviewer

## Scope
Branch `m13/7.3a-locked-template-languages` (b7d211d8). Touches `packages/evals/src/perAgentSuite.ts`,
`perAgentSuite.test.ts`, `perAgentSuiteDemo.test.ts`, `index.ts`, plus four sibling test files
(`qualityGate.test.ts`, `qualityGateDemo.test.ts`, `scorecard.test.ts`, `gateAdapters.test.ts`) whose
hardcoded locked-case counts/id lists were a mechanical consequence of this task's own approved
49→76 recalculation — authorized by the lead mid-build (handoff Decision 6) rather than a new design
decision. No risky path touched (`packages/evals/**` is not in `risk-paths.txt`).

## code-reviewer
Final verdict: APPROVE for b7d211d8. No CRITICAL/HIGH/MEDIUM/LOW findings.

## typescript-reviewer
Verdict: APPROVE. Independently re-ran the gate (18/18 tasks, 2008 tests, 100% coverage on
`perAgentSuite.ts`). Verified the `Record<Exclude<LockedTemplate,'direct'>, Record<LockedLanguage, fn>>`
structure is exhaustive empirically (a scratch copy with `hinglish` omitted fails `tsc --noEmit
--strict` with TS2741), confirmed the id-suffix logic can't produce a malformed id against
`EvalCaseSchema`'s regex, confirmed `direct` stays unlooped, and found zero `any`/unsafe casts in
the diff.

One pre-existing-pattern note, not a new finding: `perAgentSuite.test.ts:227,241,258` use a
non-null assertion on `turns[0]` identical to the style already used at lines 99/109/121/142 before
this task; `byId` throws if the id isn't found, so it's safe in practice. No fix needed.

## Findings
None.
