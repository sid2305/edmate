# Plan: 4.8e — advice guard: cue right after the verb

Status: READY. Written by the lead (28 Oct 2026). One phase, one builder.

## Goal
Fix the 4.8c review MEDIUM (`docs/tasks/4.8c/review.md`). After a weak break (", " or a dash), a `SELF_REGULATED` verb counts as a hard-rule hit when `CUE_RX` (it, them, you, your, now, a digit and so on) matches **anywhere** in the rest of the clause (`windowAfter`). So a later "you" turns maxim prose into a hit:
- "As the old saying goes — invest early and let compounding do the work for you."

## Files
- `packages/harness/src/guardrails/adviceGuard.ts`: the weak-break branch of `personalDirective()`, around lines 199–268, and the doc comments there.
- `packages/harness/src/guardrails/adviceGuard.test.ts`

Risky group: `packages/harness/src/guardrails/**` (safety). Reviewer: code-reviewer, plus a risk: high lead decision.

## Design
- Anchor the cue to the start of the window. It has to come in the first word or two after the verb (`^ ?(?:\S+ )?` + cue), not anywhere in the clause. The builder picks the narrowest anchor that keeps every 4.8c must-block sentence blocking, and records it as a builder decision:
  - "buy it now" (cue right after the verb);
  - "sell everything today" (right after);
  - "sue them" (right after);
  - "sue your landlord" (right after).
- The regulated-object check (`REGULATED_RX` on the window) is **unchanged**. "Yes, invest in index funds." still blocks through it.
- Strong-break behaviour is unchanged.

## Tests (write first, confirm red, then green)
- Must pass (no hard-rule hit):
  - "As the old saying goes — invest early and let compounding do the work for you.";
  - "Grandpa's rule was simple, sell slowly and the market will reward you.";
  - "The lesson from 1987 — buy cautiously, since nobody can time it for you.".
- Must still block: every 4.8c must-block sentence already in adviceGuard.test.ts, plus "Okay — buy them before Friday." and "Honestly, sell it all."
- Every existing adviceGuard.test.ts, postGuard.advice.test.ts and packages/evals/src/adviceFixtures.test.ts test still passes unchanged. **Never edit an existing assertion to make it pass.**
- Coverage for `src/guardrails/**` stays at 100%.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness`.
- `python3 .githooks/secret-scan.py --all`.

## Budget
About 35 tool calls (harness count). Stop at 60 and hand back PARTIAL.
