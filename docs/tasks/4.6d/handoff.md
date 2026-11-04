# Handoff: 4.6d — lockedLeak: default-ignorable marks and invisible named entities

Status: DONE

## Summary
`lockedMatch.ts`'s `TOKEN` regex keeps `\p{M}` marks inside a token on purpose (so an accented
letter folds as one token), but two default-ignorable mark ranges — variation selectors
(U+FE00-FE0F) and U+034F (combining grapheme joiner) — rode along literally inside a word instead
of folding away, so a mark spliced into teacher material's text broke the token-for-token match a
locked-span check depends on. The same stray mark, sitting right next to a markdown emphasis run,
also stopped `padMarkdownEmphasis`'s `letterBefore`/`letterAfter` from seeing a letter on that side.

Fix: a new, local, length-preserving pass, `dropDefaultIgnorableMarks`, turns both ranges into the
same zero-width-space padding (`PAD`, `\p{Cf}`) that markup and HTML entities already leave behind.
Wired into `prepared()` and `preparedForms()` only (not the shared `textFold.ts`, not
`padMarkdownEmphasis`/`letterBefore`/`letterAfter` themselves, and not `labelKeys.ts`'s direct
calls), so every existing `\p{Cf}`-aware pass (emphasis padding, the token drop, the "space"
reading) handles it for free. `NAMED_ENTITIES` also gained the invisible named HTML entities the
board listed (`&shy;`, `&ZeroWidthSpace;`, `&NoBreak;`, `&zwnj;`, `&zwj;`, `&lrm;`, `&rlm;`);
MathML-only ones (`&ApplyFunction;` etc.) are a documented known miss, pinned by a regression test.

## Decisions

### 4 Nov 2026 · 4.6d scope the drop to exactly two named ranges, not the broader Default_Ignorable set · decided by builder · risk: low
- Decided: `dropDefaultIgnorableMarks` matches only `[︀-️͏]`, as the plan specified,
  not the full `\p{Default_Ignorable_Code_Point}` set `digitForms.ts` uses for its own, narrower
  (after-a-digit-only) purpose.
- Why: the board's two reproducers are exactly these two ranges; matching the full
  Default_Ignorable set would be a bigger, untested change to the locked-match path for no
  reproducer-backed gain, and would risk interacting with `digitForms.ts`'s own drop-after-digit
  logic in ways not covered by a test.
- Alternatives: match `\p{Default_Ignorable_Code_Point}` directly (rejected: broader than the
  board asked for, no reproducer).
- Reversible: yes — widening the character class later is a one-line change.

### 4 Nov 2026 · 4.6d keycap-sequence test splices the digit into an existing span, not into a word · decided by builder · risk: low
- Decided: the digit-path regression test (plan's case 8) builds a fresh 8-token locked span that
  already contains a plain digit, then swaps that digit for its keycap form — rather than splicing
  a keycap sequence into the middle of an unrelated word (e.g. "body").
- Why: a keycap sequence (digit + VS16 + combining enclosing keycap) renders as a visible digit
  glyph, not an invisible character; splicing it into a word's letters changes what the text visibly
  says (adds a digit), so it can never fold back to the original word — that is correct, not a bug.
  The plan's own wording ("still folds its digit correctly") matches the digit-already-present case.
- Alternatives: keep the splice-into-a-word shape and treat the resulting `index.hits` miss as a
  reproducer (rejected: that would be asserting a specific implementation detail should disappear
  when it is actually working as intended — editing the test to expect the correct, documented
  behaviour, not weakening the assertion).
- Reversible: yes — it is a test shape, not a design decision in the library code.

## Red -> green evidence
Before the fix, running `vitest run src/guardrails/lockedMatch.test.ts src/guardrails/lockedLeak.test.ts`
failed 7 new tests for the right reasons, e.g.:
```
FAIL lockedMatch.test.ts > ... > board example 2 ...
FAIL lockedMatch.test.ts > ... invisible characters between the letter and the run do not hide it
  AssertionError: l️**o**op: expected [ 'l️', 'oop' ] to deeply equal [ 'loop' ]
FAIL lockedMatch.test.ts > decodeHtmlEntities > 4.6d: decodes the invisible named entities ...
  AssertionError: &shy;: expected '&shy;' to be '­​​​​'
Tests  7 failed | 55 passed (62)
```
After implementing `dropDefaultIgnorableMarks` (wired into `prepared()`/`preparedForms()`) and the
`NAMED_ENTITIES` additions: `Test Files 2 passed | Tests 62 passed` (lockedMatch), then
`Tests 78 passed (78)` once `lockedLeak.test.ts`'s chain-level fixture test was added too.

## Gate
- `corepack pnpm install --frozen-lockfile`: clean.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness`: green.
  - `Test Files 131 passed (131)`, `Tests 6043 passed (6043)`.
  - Coverage: `src/guardrails` 100/100/100/100 (statements/branches/functions/lines); `lockedMatch.ts`
    and `lockedLeak.ts` both 100/100/100/100.
- `answerKey.labels.test.ts` (the `labelKeys.ts` shared-`NAMED_ENTITIES`-caller regression check):
  `Tests 71 passed (71)`, unchanged.
- `prettier --check` on the three touched files: clean (after one `--write` pass; re-ran the full
  gate afterwards, still green).
- `python3 .githooks/secret-scan.py --all`: clean (no output).
- `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness` (the full dependent
  graph) also ran: the one failure seen (`@edmate/cli#test`, a Postgres integration test:
  `terminating connection due to administrator command`) is an environmental Postgres/worktree issue
  unrelated to this change (no file this task touches is anywhere near it); the scoped
  `--filter=@edmate/harness` run above is the gate this plan asks for and is fully green.

## Budget
Budget: 85 tool calls (plan). Tool calls used: ~55.
