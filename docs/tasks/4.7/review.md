# 4.7 review — APPROVE
Reviewers: safety-reviewer (opus), security-reviewer (sonnet), typescript-reviewer (sonnet), silent-failure-hunter (sonnet)

A safety plan review came before the build. Build reviews:
- security and typescript approved first time;
- safety and silent-failure requested changes (one HIGH each);
- fix round 1 fixed both HIGHs and the in-scope MEDIUMs;
- both reviewers re-verified it and approved.

Offline gate after the fix round:
- 37/37 grounding cases pass (32 seeded, 5 pending);
- grounding switched off fails 37/37;
- an always-"grounded" judge fails exactly the 25 judge-only cases;
- 0 TeacherQuestions on the 24 good replies;
- p95 450 ms against the 2,000 ms step.

Harness 3,266 and evals 345 tests pass (plus the 5 pending sign-offs); the secret scan is clean. No contracts or ADR change.

## Findings
- [HIGH] [fixed] packages/harness/src/guardrails/grounding.ts:182 — Rule C counted operands and unrelated numbers as the correction, then swapped one number in an affirmation ("Yes, 6 - 3 is 3. Well done!"). Operands no longer count; any wrong claim, a repeated expression or opening agreement after a wrong student claim gives the correction prompt. (safety-reviewer)
- [HIGH] [fixed] packages/harness/src/pipeline/runner.ts:530, steps/commit.ts:40 — the per-session cap was spent on failed opens, so a store outage silently ended teacher escalation. Only a successful open counts; both opens failing reports GroundingEscalationLost. (silent-failure-hunter)
- [MEDIUM] [fixed] grounding.ts:204 — a judge outage said "not covered" and opened TeacherQuestions. Now `judge_unavailable`: safe reply, no escalation, reported.
- [MEDIUM] [fixed] grounding.ts:79, testing/groundingJudge.ts:83 — a claim planted in the student's message counted as grounded. Rubric and fake judge fixed.
- [MEDIUM] [fixed] steps/generate.ts:67 — turns with nothing retrieved or from decide.fallback streamed unchecked. Now held.
- [MEDIUM] [partly fixed] steps/generate.ts:49 — on well-covered turns an ungrounded sentence can be on screen for seconds before the replace. Decision wording corrected and a `replaced_streamed` trace entry added; lead accepts the residual for the 13+ Python pilot. Client provisional marking deferred to 9.4; hold-all for regulated-subject agents deferred to 4.8.
- [MEDIUM] [deferred 4.8] grounding.ts:129 — redirect replies are not judged; adviceGuard covers redirects.
- [MEDIUM] [deferred 4.7b] runner.ts:530 — two concurrent turns in one session can exceed the cap by one; no per-session turn serialisation exists. (typescript-reviewer, security-reviewer)
- [MEDIUM] [deferred 4.7b] grounding.ts:157 — praise next to a correct number, or an agreement phrase outside AGREES plus an unrelated number, still passes Rule C to the judge. (safety re-review)
- [LOW] [fixed] runner.ts:501 — groundingAsks reset to 0 on non-reply paths.
- [LOW] [deferred 4.7b] grounding.ts:104 — look-alike delimiters; add a per-request nonce.
- [LOW] [deferred 4.7b] generate/citations.ts — "[ 3 ]", "[３]", "source 3" not flagged.
- [LOW] [deferred 4.7b] grounding.ts — reversed or worded premise forms are left to the judge.
- [LOW] [deferred 4.7b] grounding.ts:182 — canonicalNumber cast for values over 1e15.
- [LOW] [deferred 4.7b] steps/postGuard.ts:242 — a cast-free read of the reason was available.
- [LOW] [deferred 4.7b] grounding.ts:193 — the outage falls back to the answer-leak hint text when the locale has no safe reply.
