# 4.8 review — CHANGES (fix round 1 done, re-review pending)
Reviewers: safety-reviewer (opus), typescript-reviewer (sonnet), silent-failure-hunter (sonnet)

adviceGuard runs on every agent: English directive and identity rules, a small-model judge that fails closed, one rule-checked rewrite and a fixed fallback; a word-for-word disclaimer for regulated agents; regulated-agent and decision-request turns are held, not streamed; redirect replies are judged. TypeScript approves; silent-failure finds no fail-open path; safety requests changes (full text: safety-review.md).

## Findings
- [CRITICAL] [fixed] packages/harness/src/guardrails/adviceGuard.ts:344 — a directive with no modal, domain word or dose skips the judge, even on a regulated agent (safety-review.md issue 1). Fix round 1: a regulated agent sends every non-fixed reply to the judge; on all agents a sentence-start imperative, a number or a proper-noun product is a signal.
- [HIGH] [fixed] packages/harness/src/pipeline/steps/generate.ts:81-84 — redirect moves on non-regulated agents stream unless REQUEST_RX matches; many money and medicine asks miss it (safety-review.md issue 2). Fix round 1: every redirect move is held, and so is any turn whose student message names a regulated topic (money, health, law).
- [HIGH] [fixed] packages/harness/src/guardrails/adviceGuard.ts:162 — "sign it" and "file a case" can never match because the window starts after the verb (safety-review.md issue 3). Fix round 1: the verb is inside the window; "sign it/this/the contract" and "file a case" now match.
- [HIGH] [fixed] packages/harness/src/guardrails/adviceGuard.ts:272-275 — a rewrite is accepted on the hard rule alone and can add new advice (safety-review.md issue 4). Fix round 1: a rewrite with a dose, a promise or a named product is rejected and falls back.
- [HIGH] [fixed] packages/harness/src/pedagogy/disclaimer.ts:18-19 — a regulated agent whose locale pack lacks its subject's disclaimer silently gets the generic one; report a code-only locale-gap metric (silent-failure). Fix round 1: postGuard reports `DisclaimerLocaleGap` (subject code only, no text).
- [HIGH] [fixed] packages/evals/src/groundingFixtures.test.ts — the judge-always-grounded mutation no longer fails `grounding-fileio-hi-latin` on this branch (lead test run). Fix round 1: cause was markerJudge flagging bare "karo" as advice; narrowed it, the mutation fails 25 again.
- [MEDIUM] [fixed] packages/harness/src/guardrails/adviceGuard.ts:180 — identity, promise and Hinglish regexes too narrow (safety-review.md issue 5). Fix round 1: widened (up to 3 words, adverbs, "get ... back", more Hinglish imperatives).
- [MEDIUM] [fixed] packages/evals/src/adviceFixtures.test.ts:475 — "nothing streamed" only covered by messages matching REQUEST_RX; add the proposed cases (safety-review.md issue 6). Fix round 1: the 4 proposed cases added (pending), checked streamed and final.
- [MEDIUM] [deferred 4.8b] packages/harness/src/guardrails/adviceGuard.ts:347-356 — one catch collapses a scrub bug and a judge outage into judge_unavailable with no cause (silent-failure).
- [MEDIUM] [deferred 4.8b] packages/harness/src/guardrails/adviceGuard.ts:379-395 — the rewrite catch discards errors with no reason or metric (silent-failure).
- [LOW] [deferred 4.8b] the redirect text's "an adult you trust" reads oddly for 18+ students (safety).

### silent-failure-hunter (sonnet) — mergeable with fixes; no fail-open paths
- [HIGH] packages/harness/src/pedagogy/disclaimer.ts:18-19 — resolveDisclaimer falls back to the generic English disclaimer with no report when a regulated agent's locale pack has no entry for its subject (schema-valid partialRecord). Fix: report a code-only locale-gap metric when subject is set and the pack entry is missing.
- [MEDIUM] packages/harness/src/guardrails/adviceGuard.ts:347-356 — one catch around scrubPii and the judge collapses a local scrub bug and a judge outage into judge_unavailable with no cause. Fix: report errorName(error) or a distinct cause.
- [MEDIUM] packages/harness/src/guardrails/adviceGuard.ts:379-395 — the rewrite catch discards errors with no reason or metric. Fix: an advice_rewrite_failed reason/metric like judgeUnavailable.

### typescript-reviewer (sonnet) — APPROVE
No findings: import purity holds, judge and rewrite calls never throw and fail closed, time budgets match plan Q3, strict verdict schema, verification pass idempotent.
