# Plan: 7.2l — 7.2k/7.2n guardrail LOWs

## Acceptance (verbatim)
"near-miss tests for factual past/habitual sentences pass or a logged decision keeps them
blocking; harness and evals green."

## Decision: Devanagari past/habitual forms stay blocking (fail-closed)
Board task 13.3 (status: done) was a security-reviewer pass (DB scope, OWASP, dependency audit,
`review.md`/`findings-A..D.md`); it never touched moderation precision or restored
`safety-reviewer` to `risk-paths.txt`. 13.3 does not own this decision, so 7.2l decides it directly
instead of deferring again.
**Recommendation: leave बिकता/बेचा/छिपाया/ले गया... blocking, no behaviour change.** Reasons:
(1) Devanagari is a safety-net table during the English-only, US-first pilot (7.2j/7.2k
precedent: "not a pilot-served case"); (2) telling a real admission ("बाज़ार में हथियार बेचा था")
from a factual/news report needs subject/person detection the phrase-table design doesn't do, and
building it now is disproportionate before real Devanagari traffic exists; (3) guardrails fail
closed by design elsewhere in this file (bare-stem precedent, 7.2j); an intent-marker or near-miss
carve-out risks under-blocking a genuine past-tense disclosure to save a rare over-block. This is
logged as a `risk: high` decision on merge, not escalated to the human: it extends an already-
accepted precedent rather than opening a new policy question.

## Files to create/modify
1. `packages/harness/src/guardrails/moderationPatterns.ts`
   - Add one code comment above the weapons conceal rule (~line 203) and the vapes sell rule
     (~line 307) citing this decision (fail-closed, see decision log 7.2l) so a future reader
     doesn't silently "fix" the over-block.
   - Reorder prefix-overlapping Devanagari alternatives longest-first in those two rules' verb
     groups (`छुपा|छिपा|ले जा|छुपाया|छुपाई|छिपाया|छिपाई|ले गया|ले गई` → छुपाया/छुपाई/छिपाया/छिपाई/
     ले गया/ले गई before छुपा/छिपा/ले जा; `बेच|बिक|खरीद|बेचा|बेची|खरीदा|खरीदी|बिकता|बिकती` → the
     4-letter+ forms before the 2-letter stems). `phrase()`'s outer boundary already backtracks
     correctly (verified: no correctness bug), so this is a defensive-coding reorder only, not a
     behaviour fix — must not change any existing test's pass/fail outcome.
2. `packages/harness/src/guardrails/moderationPatterns.test.ts`
   - Add one `SEEDED_MODERATION` case (33 → 34) with a factual/news-style Devanagari sentence
     (e.g. "अखबार में लिखा था कि बाज़ार में हथियार बेचा गया था") asserting it still blocks
     `weapons`, comment citing the 7.2l decision — pins the accepted fail-closed behaviour so a
     later change must touch this test deliberately. Update the `toHaveLength` assertion.
3. `packages/harness/src/guardrails/moderationIn.ts`
   - `Object.freeze(['harm_to_others', 'threat', 'weapons'] as const)` for the exported
     `MISUSE_CODES` (7.2n LOW), keeping the `readonly ModerationCode[]` type.
4. `docs/tasks/7.2l/handoff.md` — written by the builder at the end.

## Files out of bounds
`packages/db/**` (other builders: publish.ts, messages.ts, sessions.ts, notes.ts,
subscriptions.ts), `evals/suites/**` and `packages/evals/**` pinned counts (no new eval YAML —
the new case is a harness unit test, not an eval suite case, so `SUITE_FLOORS` stays untouched),
`content/**`, `.claude/**`, contracts, any other guard file.

## Tests first
Write the new `SEEDED_MODERATION` factual/news case first against the *current* code (red: it
should already block — confirms today's behaviour before any edit), then do the comment +
reorder, then re-run to confirm it's still green (no change in outcome). Add the
`Object.freeze` line last and run the existing `moderationIn` tests to confirm the frozen array
still satisfies `MISUSE_CODES.includes(code)` call sites.

## Risky paths touched
- `packages/harness/src/guardrails/**` — student-safety group. Per `risk-paths.txt`'s MVP-first
  line (13.3 hasn't restored `safety-reviewer` there): reviewers `code-reviewer` (required) and
  `typescript-reviewer` (7.2j/7.2k precedent, since `.ts` types and `as const` change). Handoff
  logs a `risk: high` decision (this fail-closed call) per the merge gate.

## Open questions
None — 13.3 doesn't own this decision (confirmed above) and the fail-closed call follows direct
7.2j/7.2k precedent, so no new human decision is needed. If the human later wants near-miss
precision for Devanagari, that's a fresh board task after real Devanagari traffic exists.

## Budget
Budget: 25 tool calls (1 phase, packages/harness only)

## Allowed tools
Read, Grep, Glob, Edit, Bash (typecheck/lint/test for @edmate/harness, secret scan, git)

## Exit conditions
DONE when `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness` is green, the
new regression case passes, `Object.freeze` is in place and typed, and the secret scan is clean.
PARTIAL past ~30 calls, with a "Left to do" list.
