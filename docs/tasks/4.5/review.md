# 4.5 review — APPROVE (the human signs the 6 new leak cases before merge)
Reviewers: safety-reviewer (opus), security-reviewer (sonnet; also covered typescript and silent failures)

A safety plan review added 14 revisions before the build. The first build review found 1 CRITICAL (security) and 4 HIGH (safety). One fix round (2f4ad66) fixed all of them plus 5 MEDIUMs, and both reviewers re-verified it: APPROVE. 38/38 leak cases and 473 scripted leak replies give 0 leaks streamed and 0 in the final reply; a mutation run fails all 38. Harness 2,914 tests pass with guardrails at 100%; the secret scan is clean; contracts are untouched.

## Findings
- [CRITICAL] [fixed] packages/harness/src/pipeline/generate/streamGate.ts:91 — quadratic rescans with an unbounded chunk (3.1 s at 400k characters). Now a linear scan, plus an 8,000-character trip; re-verified.
- [HIGH] [fixed] packages/harness/src/pipeline/generate/answerKey.ts:31 — the own-code exemption could be beaten by offering options. Narrowed to clearly-code lines, never in a confirmation context; re-verified.
- [HIGH] [fixed] packages/harness/src/pipeline/generate/numberWords.ts:45 — Hindi-Latin 21–99 was missing. Added with spelling folding; re-verified.
- [HIGH] [fixed] packages/harness/src/pipeline/generate/numbers.ts:71 — one-digit keys in words got through. Count and confirmation markers added; re-verified.
- [HIGH] [fixed] packages/harness/src/pipeline/generate/streamGate.ts:78 — the window wasn't equivalent. Now measured in visible characters, with number-word tails held; re-verified.
- [MEDIUM] [fixed] packages/harness/src/pipeline/steps/postGuard.ts:131 — withheld leaks now run the whole chain on the full model text, with one rewrite before the hint.
- [MEDIUM] [fixed] packages/harness/src/pipeline/runner.ts:852 — postGuard step failures are reported.
- [MEDIUM] [fixed] packages/harness/src/pipeline/generate/base64Leak.ts:15 — short base64 forms.
- [MEDIUM] [fixed] packages/harness/src/pipeline/generate/numbers.ts:40 — decimals and fractions at the key's precision.
- [MEDIUM] [deferred 4.5c] packages/harness/src/pipeline/generate/answerKey.ts:157 — picking between two code lines the student wrote ("Keep s.lower()") gets through.
- [MEDIUM] [deferred 4.5c] packages/harness/src/pipeline/generate/numbers.ts:112 — "ek baar try karo" and "do baar socho" trip one-digit keys.
- [LOW] [deferred 4.5c] packages/harness/src/pipeline/generate/streamGate.ts:91 — up to ~0.6 s of CPU for maximally sentence-dense text at the 8,000-character cap; batch short sentences.
- [LOW] [deferred 4.5c] packages/harness/src/pipeline/generate/numberWords.ts:45 — spelling variants and fraction words ("five sixths", "83%").
- [LOW] [deferred 4.5b] packages/harness/src/pipeline/generate/answerKey.ts:1 — paraphrase, and confirming a guess without quoting it, need a judge.
- [LOW] [deferred 9.4] packages/contracts/src/turn.ts:247 — the client clears text, skill events and sources on `replace ''` (9.4's accept line).

## 4.5c (PR #53) — APPROVE
Reviewer: safety-reviewer (sonnet): the build (2 HIGH, 1 MEDIUM), then re-verification of 3715e17 (APPROVE)

- [HIGH] [fixed] packages/harness/src/pipeline/generate/numbers.ts:266 — "three times it runs" missed (weak marker checked only the adjacent token). There is now a sentence-bounded scan for a run verb; re-verified in both word orders.
- [HIGH] [fixed] packages/harness/src/pipeline/generate/answerKey.ts:109 — a trailing comment defeated the offered-options rule. Comments are stripped before comparing; re-verified.
- [MEDIUM] [fixed] packages/harness/src/pipeline/generate/numbers.ts:88 — "83% of students passed" tripped a 0.83 key. Fraction, percent and spoken-decimal forms need an answer context; re-verified.

leakFixtures 38/38, the mutation run still fails all 38, and harness 3,034 tests pass.
