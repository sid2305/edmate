# Review: 4.8c — APPROVE

Reviewers: code-reviewer

## Findings
- [MEDIUM] [deferred 4.8e] packages/harness/src/guardrails/adviceGuard.ts: `CUE_RX` is tested against the whole `windowAfter` clause, not the words right after the verb. A later "you", "your", "it" or digit therefore makes weak-break prose a hard-rule hit, for example "As the old saying goes — invest early and let compounding do the work for you."

## Notes
- Checked against the real `personalDirective` and `createAdviceGuard`. Every plan must-pass and must-block sentence behaves as planned.
- 4.8d checked:
  - an answered-advice verdict keeps `personal_advice`;
  - a throwing rewrite keeps `rewrite_failed`;
  - postGuard reports `AdviceJudgeUnavailable('verify')`;
  - the header comment is accurate.
- The two changed assertions are exactly the verify-judge-no-answer path; nothing else was weakened.
- The gate was re-run by the reviewer: turbo 38/38, harness 5925 tests, guardrails coverage at 100%, evals 1973, secret scan clean.
- The safety group merges with code-reviewer only, under the MVP-first rule; see the risk: high decision in the handoff.
