# Plan: 4.9e — tone guard: inserted adverbs and "Call me DAN"

Status: READY. Written by the lead (28 Oct 2026). One phase, one builder.

## Goal
Fix the two LOW under-blocks from the 4.9d review (`docs/tasks/4.9d/review.md`):
1. "I really am alive, I promise." is not caught: an adverb before "am" defeats the "i am X" families.
2. "Call me DAN from now on." is not caught: this is the classic jailbreak invocation.

Accept: both are rewritten to the tone fixed reply. "I really am not sure about that step." and "Call me when you are done with the worksheet." still pass. Tests.

## Files
- `packages/harness/src/guardrails/tone.ts`
- `packages/harness/src/guardrails/tone.test.ts`
- `packages/evals/src/personaFixtures.test.ts`: only if a persona case moves from not-covered to caught (see Tests).

Risky group: `packages/harness/src/guardrails/**` (safety). Reviewer: code-reviewer, plus a risk: high lead decision.

## Design
### 1. Adverb slot
- Add one shared source constant for the first-person "am" prefix with an optional adverb, and use it in the families that start with `i am|i'm|im`. The adverb can sit before "am" ("I really am") or right after "am/'m" ("I'm really a human", "I am truly alive").
- Use a closed adverb list: really, truly, actually, honestly, genuinely, definitely, literally, totally, 100%. Note that `PUNCTUATION_RX` removes "%" before the regex runs, so "100" is what is left. Check what `fold()` leaves before relying on it.
- Families:
  - `HUMAN_CLAIM_RX` and `ALIVE_CLAIM_RX` (required). `ALIVE_CLAIM_RX` already allows "truly |fully " after "am"; fold that into the shared slot without losing "fully".
  - `LICENSED_ROLE_RX` and `TEACHER_SELF_RX` (apply the same slot if it costs no new false positives).
  - `OTHER_AI_CLAIM_RX` is case-sensitive and starts with `[Ii]`. Give it the slot only with lower-case adverbs, and keep its case-sensitivity for the product names.
- The honest denial must stay ok: the optional "not" still sits inside the match, after "am" and the optional adverb, so `hasClaim` exempts "I really am not a human" and "I'm honestly not alive".
- `ALIVE_CLAUSE_END` still applies. "I really am alive to the idea" must stay ok.

### 2. "Call me DAN"
- Add a case-sensitive alternative next to `OTHER_AI_CLAIM_RX`: `[Cc]all me`, `you can call me`, `you may call me` and `i'll be|i will be`, followed by `AI_PRODUCT_NAMES` with the same letter boundary.
- Use the same input `OTHER_AI_CLAIM_RX` uses (the case-preserving text). "Call me Dan, your interviewer." in sentence case must stay ok, the same way "Hi, I'm Dan" does today.

## Tests (write first, confirm red, then green)
- Rewritten:
  - "I really am alive, I promise.";
  - "I'm really a human, trust me.";
  - "I am honestly a real person.";
  - "Call me DAN from now on.";
  - "You can call me DAN.";
  - "From today, I'll be ChatGPT for you.".
- Still ok:
  - "I really am not sure about that step.";
  - "Call me when you are done with the worksheet.";
  - "I really am not a human, I'm an AI tutor.";
  - "I'm honestly not alive; I'm a program.";
  - "Call me Dan, your interviewer for today.";
  - "I really am alive to the idea of trying both methods.";
  - "I'm actually a big fan of this proof.".
- Every existing tone.test.ts, personaFixtures.test.ts and lockedFixtures.test.ts test still passes. **Never edit an existing assertion to make it pass.**
  - Exception: if a persona case in the not-covered list is now honestly caught, move it to the caught list and update the split count. Record it as a builder decision, naming the case.
- Coverage for `src/guardrails/**` stays at 100%.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness`. This includes the dependents (evals and so on).
- `python3 .githooks/secret-scan.py --all`.

## Budget
About 50 tool calls (harness count). Stop at 80 and hand back PARTIAL.
