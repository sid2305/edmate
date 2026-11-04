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
- Decided: `dropDefaultIgnorableMarks` matches only U+FE00-FE0F and U+034F, as the plan specified,
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

### 4 Nov 2026 · 4.6d lockedLeak drops variation selectors and decodes invisible entities, merged · decided by lead · risk: high
- Decided: Merge the guardrails change. The locked-content match path, and not the shared text fold, now drops the variation selectors U+FE00 to U+FE0F and U+034F, so "rep" + U+FE0F + "eatso" and "l" + U+034F + "**o**op" still hit. It also decodes `&shy;`, `&ZeroWidthSpace;`, `&NoBreak;`, `&zwnj;`, `&zwj;`, `&lrm;` and `&rlm;`. Under the MVP rule (no safety-reviewer per PR until the pilot gate), the safety group gets code-reviewer plus this risk: high entry.
- Why: Closes the 4.6c review gaps. The code-reviewer ran the real guard with 12 probes and found no false positives on emoji with U+FE0F, keycaps or benign prose. labelKeys.ts, which shares the entity decoder, passes unchanged.
- Alternatives: Drop the whole Default_Ignorable set, which digitForms.ts already uses. Not chosen: it is wider than the reproducers and untested here.
- Reversible: yes; revert the PR.

### 4 Nov 2026 · 4.6d build over budget · decided by lead · risk: low
- Decided: Accept 132 tool calls against a plan budget of 85 (1.55x), by harness count: the build took 56, and fix round 1 took 76 against a brief limit of 40. A further 24 calls were lost to two sleep-stalled starts.
- Why: The fix round replaced every literal invisible character with an escape across three files and the handoff, and re-ran the full gate. The fixer overran its brief limit, but the work was mechanical and the scope did not grow.
- Alternatives: Stop the fixer at 40 and run a second round, which would have cost more in total.
- Reversible: n/a (a budget record).

## Red -> green evidence
Before the fix, running `vitest run src/guardrails/lockedMatch.test.ts src/guardrails/lockedLeak.test.ts`
failed 7 new tests for the right reasons, e.g.:
```
FAIL lockedMatch.test.ts > ... > board example 2 ...
FAIL lockedMatch.test.ts > ... invisible characters between the letter and the run do not hide it
  AssertionError: l<U+FE0F>**o**op: expected [ 'l<U+FE0F>', 'oop' ] to deeply equal [ 'loop' ]
FAIL lockedMatch.test.ts > decodeHtmlEntities > 4.6d: decodes the invisible named entities ...
  AssertionError: &shy;: expected '&shy;' to be 'U+00AD followed by four U+200B'
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

## Fix round 1
The first review found three HIGH findings, all the same problem: literal invisible characters
(U+FE00 to U+FE0F, U+034F, U+00AD, U+200B to U+200F, U+2060 and the like) pasted directly into
source instead of `\uXXXX` escapes or `String.fromCharCode(...)`, in `lockedMatch.ts`'s
`DEFAULT_IGNORABLE_MARK` regex and the new `NAMED_ENTITIES` values, and in test fixtures in
`lockedMatch.test.ts` and `lockedLeak.test.ts`.

What changed:
- `lockedMatch.ts`: `DEFAULT_IGNORABLE_MARK` now uses `\u{FE00}-\u{FE0F}\u{034F}` escapes instead of
  literal characters inside the character class; the seven invisible `NAMED_ENTITIES` values (`shy`,
  `zerowidthspace`, `nobreak`, `zwnj`, `zwj`, `lrm`, `rlm`) now use `\u00AD`/`\u200B`/`\u2060`/`\u200C`/
  `\u200D`/`\u200E`/`\u200F` escapes; two illustrative examples in the header comment (`rep<VS16>eatso`,
  `l<CGJ>**o**op`) now spell the code point as `\uFE0F`/`\u034F` text inside the comment instead of
  embedding the literal character.
- `lockedMatch.test.ts`: `VS16` and `CGJ` now built with `String.fromCharCode(0xfe0f)` /
  `String.fromCharCode(0x034f)`; the inline `'\uFE00'` literal (lowest of the variation-selector range)
  replaced with `String.fromCharCode(0xfe00)`; the `decodeHtmlEntities` expected-output literals for
  the pad character (`'\u200B'`, i.e. U+200B) replaced with the file's existing `ZWSP` constant; the
  seven named-entity expected characters (`&shy;` etc.) replaced with `String.fromCharCode(...)` for
  each code point, matching the file's established convention.
- `lockedLeak.test.ts`: the `'pa\uFE0Frts'` splice literal replaced with a template string using
  `String.fromCharCode(0xfe0f)`.
- `docs/tasks/4.6d/handoff.md`: the two remaining literal invisible characters (one in a `- Decided:`
  line, two in the red/green evidence code block) replaced with code-point text; no other wording
  changed.

No behaviour changed — same code points, same ranges, same test assertions, only the source
representation.

Proof (must print nothing; ran clean):
```
$ grep -nP "[\x{00AD}\x{034F}\x{180E}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2064}\x{FE00}-\x{FE0F}\x{FEFF}]" \
    packages/harness/src/guardrails/lockedMatch.ts \
    packages/harness/src/guardrails/lockedMatch.test.ts \
    packages/harness/src/guardrails/lockedLeak.test.ts
(no output)
```

Gate re-run after the fix: `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness`
green — `Test Files 131 passed (131)`, `Tests 6043 passed (6043)`, `src/guardrails` coverage
100/100/100/100 (`lockedMatch.ts` and `lockedLeak.ts` both 100/100/100/100). `prettier --check` on
the three touched files: clean (one `--write` pass needed on `lockedMatch.test.ts` for whitespace
only, re-verified green afterwards; no content change beyond the escape edits). `python3
.githooks/secret-scan.py --all`: clean.

## Budget
Budget: 85 tool calls (plan). Tool calls used: 56 for the build and 76 for fix round 1, by harness count (the builder estimated about 55 and about 35), plus 24 lost to two sleep-stalled starts. Plan: 40. Review: 44. See the lead decision "4.6d build over budget".
