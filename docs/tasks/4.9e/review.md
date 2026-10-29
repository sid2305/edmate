# Review: 4.9e — APPROVE

Reviewers: code-reviewer

## Findings
- [LOW] [wontfix] packages/harness/src/guardrails/tone.ts: `CALL_ME_PRODUCT_RX`'s "you can call me" and "you may call me" alternatives can't match on their own, because "[Cc]all me" already matches inside them. No functional effect (lead decision).

## Notes
- Checked against the real guard (`createToneGuard().run`):
  - every under-block variant is rewritten: an adverb before or after "am", "Call me <product>" and the curly apostrophe;
  - every over-block variant stays ok: tutoring replies with adverbs, honest denials with adverbs, "Call me old-fashioned".
- `amPrefixSrc` is a strict superset of each family's earlier pattern. The `ALIVE_CLAUSE_END` lookahead and the "not" exemption in `hasClaim` are unchanged.
- The gate: harness 5996 tests, guardrails coverage at 100%, persona and locked fixtures 289/289, persona split unchanged at 72/28.
- The safety group merges with code-reviewer only, under the MVP-first rule; see the risk: high decision in the handoff.
