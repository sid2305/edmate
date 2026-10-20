# 3.3 review — APPROVE

Reviewers: code-reviewer (sonnet), typescript-reviewer (sonnet)

Both reviewers approve with no CRITICAL or HIGH findings, at head 4c47b89. code-reviewer also made a silent-failure pass:
- A hard distress phrase takes precedence over every other rule, for every turn kind, and misuse beats answer-seeking.
- With no readable key an answer is never credited.
- The model fallback throws typed timeout, cancel and invalid-answer errors, which reach the runner's existing route fallback.
- `route.onFailure` runs the distress check.
- route.accuracy.test.ts drives the real `route.run`.

typescript-reviewer re-ran the harness suite green (4444 tests, accuracy gate included). It confirmed:
- zod re-validates the fallback's answer.
- The 300 ms model deadline nests inside route's 400 ms step budget and shares the runner's cancel token.
- Every routing regex uses the `u` flag, and text is NFKC-normalised.
- Imports stay within the purity rules.

The lead read the labelled set and signs it (`reviewed_by: lead`, MVP rule of 20 Oct 2026). Its distress, misuse and Hindi/Hinglish safety-net rows are labelled by the correct routing. The six misses are reported honestly, not relabelled: 97.0% overall and 96.8% in English.

## Findings
- [MEDIUM] [deferred 3.3a] packages/harness/src/routing/classify.ts:249 — duplicate answer-key parts (`['3','3']`) can both match one number the student wrote once, giving `correct` instead of `partial`. Count each student number at most once.
- [LOW] [deferred 3.3a] packages/harness/src/routing/modelFallback.ts:65 — `askIntentModel` repeats `safetyClassifier.ts`'s cancel, timeout and validate idiom. Extract a shared helper so the two can't drift.
- [LOW] [deferred 3.3a] packages/harness/src/routing/index.ts:33 — `|| text === undefined` is redundant, because the rules already return confident on empty text.
