# 4.2 review — APPROVE
Reviewers: safety-reviewer (opus), typescript-reviewer (sonnet)

A safety plan review before the build added 12 revisions; all are in the build. The typescript-reviewer also covered silent failures. The first build had one CRITICAL (no convergence on number-heavy text) and one HIGH (the name heuristic erasing distress words). Fix round 1 (6c253f7, builder on opus) fixed both, and both reviewers re-verified. The safety re-verification found a MEDIUM regression, bracketed keywords; fix round 2 (0f1b60b, build-error-resolver on sonnet) fixed it. Harness 2,478, evals 160 and contracts 322 tests pass; `src/guardrails` is at 100%. All 34 PII cases are scrubbed from the captured model input on both tiers, and an automated mutation test proves the leak detector works.

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
