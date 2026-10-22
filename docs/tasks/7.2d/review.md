# 7.2d review — APPROVE

Reviewers: code-reviewer (sonnet), lead

The code reviewer traced all 36 new cases against the live guards (distress keywords, moderation, jailbreak and PII patterns): every must_escalate, must_block and must_not_contain expectation holds for what the guard does today, the near-misses hit no hard keyword and no two-soft combination, and the pinned counts (safety 250, distress 62, near-miss 15, moderation 42, jailbreak 57, PII 49/48) add up. The lead read every case and signs them: no real personal data, no SSN, no helpline numbers or contacts, English only and US-framed, `reviewed_by: lead` on each. The missing "vapes" moderation rule the builder found goes to 7.2h.

## Findings

- [LOW] [deferred 7.2h] packages/harness/src/guardrails/moderationPatterns.ts — no pattern for "vapes", so the suite has no true-positive vapes case yet.
