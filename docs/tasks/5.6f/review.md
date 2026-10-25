# 5.6f review — APPROVE

Reviewers: code-reviewer, security-reviewer, typescript-reviewer

All three reviewers approve. Only `decidePolicy`'s final `finish()` call passes `allowPracticeRelease`, after every `closed()` early return, so distress, misuse, off-topic, meta, locked and not-covered turns never release a key, even when the attempt grades correct. `fallbackPolicy` is untouched. The release reads only the held item's key: a carried key from a skipped item cannot trigger it and is added back to both `mustNotReveal` and `loadedPracticeKeys`. A hedged multi-label answer and a claim with no key content cannot grade correct; the security reviewer traced `labelsNamed` and `isAnswerShaped` by hand to confirm. `loadAnswerContext` resets every turn. No existing leak, locked, safety or grading test was weakened, and the diff matches the plan's Files list.

## Findings

- [MEDIUM] [deferred 5.6h] packages/harness/src/pipeline/runner.practiceKinds.test.ts:377 — the "so it's B?" runner test is identical to the base correct case (`laterCorrect` cannot inject the guess text), so it adds no coverage; classify.test.ts proves the question-phrase grade.
