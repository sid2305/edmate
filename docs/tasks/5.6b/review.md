# 5.6b review — APPROVE

Reviewers: code-reviewer, security-reviewer, architect, typescript-reviewer

All four reviewers read the full diff across packages/harness: the label matcher, item spans and derived keys, the stream gate's re-show hold-back, the runner/generate/postGuard wiring, and the practice item rules. The architect, code and TypeScript reviewers approved with no CRITICAL or HIGH. Security found one CRITICAL: the live stream judged the "every wrong option ruled out" check within only about 150 characters, so a long reply could show the answer before postGuard fixed the stored text. One fix round added a per-reply record of ruled-out wrong options, committed only on release, tested with the repro through the real pipeline. The security re-check approved it and raised one MEDIUM, deferred with the two TypeScript LOWs to 5.6g.

## Findings
- [CRITICAL] [fixed] packages/harness/src/pipeline/generate/streamGate.ts:89 — ruling out wrong options was judged only within `keys.reach` of prior text (answerKey.ts:344 rulesOut); now a per-reply ruled-out set holds the piece that would complete it, tested in streamGate.test.ts and runner.practiceKinds.test.ts.
- [MEDIUM] [deferred 5.6g] packages/harness/src/pipeline/generate/streamGate.ts:301 — ruleOutCompletes/commitRuledOut judge the bare piece, so a wrong-option mention split by a cap-forced cut is missed live (postGuard still fixes the stored reply).
- [LOW] [deferred 5.6g] packages/harness/src/pipeline/generate/itemContext.ts:8 — ItemContext prompt/options are not readonly, unlike PostGuardCtx.
- [LOW] [deferred 5.6g] packages/harness/src/tools/practiceItems.ts:419 — validMcq reads answerKey[0] before the length guard, safe only by short-circuit order.
