# Review: 4.4f — APPROVE

Reviewers: code-reviewer

## Findings
- [HIGH] [fixed] packages/harness/src/guardrails/moderationPatterns.ts — "I'm going to shoot him" scored nothing, because HARM_VERB has no "shoot". Fix round 1 adds `shoot` to the 4.4f threat row only, with a message/photo exemption.
- [HIGH] [fixed] packages/harness/src/guardrails/moderationPatterns.ts — found by the lead's verification probe after fix round 1. Both new rows tested their game and message/photo exemptions against the whole message, so the school words in `GAME` (class, level and others) exempted "I will stab him after class" and "how do I get a gun to bring to class". Fix round 2 adds the narrow `GAME_TITLE` list and turns the message/photo exemption into a lookahead on the person word.

## Notes
- The code-reviewer checked these, and all hold: no false positives on the brief's list (chess, debate, exam, fortnite, kitchen knife, minecraft, story, rifle diagram); no "without a licence", "no license" or "skip the permit" loophole; no ReDoS; the moderationIn.ts reorder is safe; jailbreak.ts's return type; 100% guardrails coverage; harness purity.
- After fix round 2, the lead re-ran an 18-sentence probe against the branch: 9 hits and 9 no-hits, all correct.
- `packages/harness/src/guardrails/**` is a risky path. It gets code-reviewer plus the lead's risk: high decision; there is no safety-reviewer per PR until the pilot gate.
