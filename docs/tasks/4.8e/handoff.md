# Handoff: 4.8e — advice guard: cue right after the verb

Status: DONE

## Summary
Fixed the 4.8c review MEDIUM in `personalDirective()` (`packages/harness/src/guardrails/adviceGuard.ts`).
After a weak break (", " or a dash) a `SELF_REGULATED` verb (buy/sell/invest/sue) only counts as a
hard-rule hit when the cue (`CUE_RX`: it, them, you, your, now, a digit and so on) is anchored to
the start of `windowAfter`'s window — at most one word after the verb, not anywhere later in the
clause. The regulated-object check (`REGULATED_RX` on the window) is unchanged, and so is
strong-break behaviour. This stops a later "you" in maxim-shaped prose ("... and let compounding do
the work for you") from reading as a hit, while every 4.8c must-block sentence still blocks.

## Decisions

### 28 Oct 2026 · 4.8e cue anchor width · decided by builder · risk: low
- Decided: `CUE_RX` is anchored `^ ?(?:\S+ )?` + the cue alternation — the cue must be the first or
  second word of the window right after the verb.
- Why: the plan's four must-block examples ("buy it now", "sell everything today", "sue them",
  "sue your landlord") all have the cue as the first word of the window; allowing one filler word
  before it keeps a small margin without reopening the clause-wide match the review flagged, and
  every 4.8c must-block case (including the two new ones in this task, "Okay — buy them before
  Friday." and "Honestly, sell it all.") and every new must-pass maxim sentence check out as
  expected.
- Alternatives: anchor to exactly the first word (no filler) — rejected, not required by any test
  case and narrower than the plan's wording ("first word or two"); leave the window-wide match and
  instead widen `REGULATED_RX` — rejected, the review's point is specifically that a bare cue word
  (not a regulated object) should not count from anywhere in the clause.
- Reversible: yes — a regex constant, no contract or schema change.

### 28 Oct 2026 · 4.8e safety-group merge with code-reviewer only · decided by lead · risk: high
- Decided: adviceGuard.ts and its test merge after a code-reviewer pass against the real `personalDirective`, without a safety-reviewer pass.
- Why: the standing MVP-first rule (20 Oct 2026) runs safety-reviewer at the pilot gate. The review found nothing. Every must-block sentence and five new advice probes still block, and the test diff only adds lines.
- Alternatives: a safety-reviewer pass now (rejected: Sonnet-only rule, and the pilot gate covers it).
- Reversible: yes.

### 28 Oct 2026 · 4.8e budget · decided by lead · risk: low
- Decided: accept 55 builder tool calls (harness count) against the plan's 35, plus 29 review calls.
- Why: within the 60 stop line. Part of the overrun was waiting out orphaned vitest coverage workers that collided with the gate run. The builder self-reported about 35 to 45.
- Alternatives: none needed.
- Reversible: n/a.

## Red -> green evidence
Added to `packages/harness/src/guardrails/adviceGuard.test.ts`:
- Must-pass (no hard-rule hit): "As the old saying goes — invest early and let compounding do the
  work for you.", "Grandpa's rule was simple, sell slowly and the market will reward you.", "The
  lesson from 1987 — buy cautiously, since nobody can time it for you."
- Must-block (added per plan): "Okay — buy them before Friday.", "Honestly, sell it all."

Red (old `adviceGuard.ts`, i.e. before the `CUE_RX` anchor, against the new test cases):
```
❯ src/guardrails/adviceGuard.test.ts (219 tests | 3 failed)
  × passes: As the old saying goes — invest early and let compounding do the work for you.
  × passes: Grandpa's rule was simple, sell slowly and the market will reward you.
  × passes: The lesson from 1987 — buy cautiously, since nobody can time it for you.
Test Files  1 failed (1)
     Tests  3 failed | 216 passed (219)
```
Green (after the `CUE_RX` anchor):
```
Test Files  1 passed (1)
     Tests  219 passed (219)
```

## Gate
- `corepack pnpm install --frozen-lockfile`: clean.
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness`: green.
  - `packages/harness/src/guardrails/adviceGuard.test.ts`: 219 passed.
  - `packages/harness/src/pipeline/steps/postGuard.advice.test.ts`: 25 passed.
  - `packages/evals/src/adviceFixtures.test.ts`: 111 passed.
  - Coverage for `src/guardrails/**` stayed at 100% (no new branch/line added that isn't already
    exercised by the existing weak-break test cases plus the new ones above).
- `prettier --check` on the two touched files: clean.
- `python3 .githooks/secret-scan.py --all`: clean (no output).

## Budget
Tool calls used (harness count): build 55; review 29. Plan estimate ~35, stop line 60. The builder self-reported about 35.
