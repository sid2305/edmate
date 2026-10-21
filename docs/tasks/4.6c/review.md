# 4.6c review — APPROVE
Reviewers: code-reviewer (opus), typescript-reviewer (sonnet), silent-failure-hunter (sonnet)

Risky paths: packages/harness/src/guardrails/** and evals/suites/locked/** (code-reviewer required). No safety-reviewer per PR until the pilot gate (MVP-first, 20 Oct 2026). typescript-reviewer and silent-failure-hunter approved with no findings: post-guard failure fails closed, HelpStateUnreadable carries no stored data, and the tests are load-bearing. code-reviewer raised one HIGH, which fix round 1 (0895fdb) closed, and the same reviewer re-verified it. It tried Cf characters on the left, the right and both sides, astral tag characters, entity forms, comments and tag+Cf. The scan stays linear: 200k-character inputs took 8–21 ms. Re-run on head: harness 5000 tests, evals 935, lockedMatch.ts 100% coverage.

## Findings
- [HIGH] [fixed] packages/harness/src/guardrails/lockedMatch.ts:230 — the in-word emphasis check looked only at the immediate neighbours, so one invisible \p{Cf} character (soft hyphen, ZWSP, &#8203;, or tag padding as in l<b></b>**o**op) skipped the padding while CommonMark still renders bold. It now looks past Cf characters on both sides; unit tests and two suite-wide fixture forms fail when the fix is reverted.
- [LOW] [fixed] packages/harness/src/guardrails/lockedMatch.ts:67 — a single `~` (GFM strikethrough) is not padded; now listed as a known miss with a pinning test.
- [MEDIUM] [deferred 4.6d] packages/harness/src/guardrails/lockedMatch.ts:393 — default-ignorable combining marks inside a word (U+FE0F, U+FE00, U+034F) pass the guard, with or without markdown; an older gap.
- [MEDIUM] [deferred 4.6d] packages/harness/src/guardrails/lockedMatch.ts:358 — invisible named entities missing from NAMED_ENTITIES (&shy;, &ZeroWidthSpace;) are not decoded, so l&shy;oop splits; an older gap.
