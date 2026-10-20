# 4.2 review — APPROVE
Reviewers: safety-reviewer (opus), typescript-reviewer (sonnet)

A safety plan review before the build added 12 revisions; all are in the build. The typescript-reviewer also covered silent failures. The first build had one CRITICAL (no convergence on number-heavy text) and one HIGH (the name heuristic erasing distress words). Fix round 1 (6c253f7, builder on opus) fixed both, and both reviewers re-verified. The safety re-verification found a MEDIUM regression, bracketed keywords; fix round 2 (0f1b60b, build-error-resolver on sonnet) fixed it. Harness 2,478, evals 160 and contracts 322 tests pass; `src/guardrails` is at 100%. All 34 PII cases are scrubbed from the captured model input on both tiers, and an automated mutation test proves the leak detector works.


After the reviews, merging main brought 4.0d's spelled-out email case. The builder added a small spelled-out email pattern ("x dot y at example dot com"), tested against "good at maths", "meet at 5" and "x dot y", and included in the speed test. The lead reviewed it: it can over-redact ("google dot com"), which is the safe direction for a privacy guard, and the decision is logged risk: medium. The merge gate ran 34/34 tasks with Postgres and Redis, nothing skipped.

## Findings
- [CRITICAL] [fixed] packages/harness/src/guardrails/piiPatterns.ts:50 — scrubbing didn't converge on 10+ keyword-adjacent numbers, so the turn failed closed. Placeholders no longer act as keywords; numbers in keyword windows are decided in one pass; tested to the 8,000-character cap.
- [HIGH] [fixed] packages/harness/src/guardrails/piiPatterns.ts:196 — the name heuristic deleted distress words ("I'm Feeling Suicidal"). The raw-text distress boolean is ORed into escalation, and the stop list has about 150 more words.
- [HIGH] [fixed] packages/harness/src/pipeline/steps/scrub.test.ts — the perf test used 4,000 characters and wall-clock timing. Now 8,000 and 4,000 caps, ≥ 400 redactions, a generous bound.
- [MEDIUM] [fixed] packages/harness/src/guardrails/piiPatterns.ts:147 — a regression from fix round 1: "[OTP] 482913" wasn't scrubbed. Only the scrub's own lowercase placeholders are skipped now.
- [MEDIUM] [fixed] packages/harness/src/pipeline/steps/scrub.ts:109 — an unchecked cast; now throws payloadShape().
- [MEDIUM] [fixed] packages/harness/src/pipeline/steps/scrub.ts:96 — payload values under PII-named keys are now redacted.
- [LOW] [fixed] packages/evals/src/piiScrubPipeline.test.ts — the mutation check is automated.
- [LOW] [fixed] packages/harness/src/pipeline/types.ts:93 — the `distressCheck` doc now says it receives raw text and must never log, store or send it.
- [MEDIUM] [deferred 4.2c] packages/harness/src/guardrails/piiPatterns.ts:74 — keycap, superscript and circled digits and invisible marks; more phone, card, OTP and name shapes; spelled-out numbers; Aadhaar Verhoeff; constant-digit over-scrub.
- [MEDIUM] [deferred 4.2c] packages/harness/src/pipeline/steps/scrub.ts:96 — PII-named keys over-scrub teaching content (flashcards, file names); redact only scalars directly under compound key names.
- [LOW] [deferred 4.2c] packages/harness/src/guardrails/piiPatterns.ts:196 — stop-list words khatam, barbaad, bekaar and nothing.


## 4.2c (PR #42) — APPROVE
Reviewer: safety-reviewer (sonnet): the build (1 CRITICAL), fix round 1 (CRITICAL fixed, a new HIGH), fix round 2 (HIGH fixed) — APPROVE. Harness 2,757 tests pass; `src/guardrails` is at 100% coverage. 6 new eval cases await the human's sign-off.

- [CRITICAL] [fixed] packages/harness/src/pipeline/steps/scrub.ts:144 — bare name/pin keys stopped redacting their own scalar values. Fixed and re-verified.
- [HIGH] [fixed] packages/harness/src/pipeline/steps/scrub.ts:153 — the file-like-parent exemption keyed only on the parent key. Now the value must also look like a file or identifier; re-verified.
- [MEDIUM] [fixed] packages/harness/src/guardrails/piiPatterns.ts:248 — filler words between an OTP and "code".
- [MEDIUM] [fixed] packages/harness/src/guardrails/piiPatterns.ts:196 — reversed Hinglish and Devanagari name order, and sign-offs with a comma.
- [MEDIUM] [wontfix] packages/harness/src/pipeline/steps/scrub.ts:153 — a lowercase single-token name under a file-shaped key ({"module":{"name":"riya"}}) still passes. It can't be told apart from an identifier by shape; accepted and logged in the 4.2c decision.
- Merge with main (4.5): textFold.foldText now runs 4.2c's digit-form pre-pass first, so answerLeak also folds keycap, superscript and circled digits (3 tests). The lead reviewed this small, protective addition; leakFixtures 38/38 and the mutation run still pass.
- [LOW] [deferred 3.10] packages/harness/src/testing/piiLocaleFixtures.ts:12 — Aadhaar Verhoeff, with the real IN pack.
