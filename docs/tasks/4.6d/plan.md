# Plan: 4.6d — lockedLeak: default-ignorable marks and invisible named entities

Status: READY. Written by `planner` (30 Oct 2026). One phase, one builder.

## Acceptance (verbatim, from the board)
"each form has a unit test and a suite-wide fixture form that fails when the fix is reverted; no new false trips on prose or code; the scan stays linear"

How it's shown: every new case is a unit test in `lockedMatch.test.ts` (token/fold level) plus one chain-level fixture test in `lockedLeak.test.ts` (using `memoryRetrieval`/`retrievalWorld`, so a revert of the fix flips a real `guard.run(...)` result from a rewrite back to "ok"). A linear-time test (reusing the existing pattern at `lockedMatch.test.ts` "long runs of invisible characters around emphasis stay linear") covers the new characters. `corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness` is green with `src/guardrails/**` coverage at 100%.

## What's actually wrong (read, not guessed)
`lockedLeak.ts` makes no model call and holds no fold logic itself; the fold lives in `lockedMatch.ts` (`lockedCandidates` → `prepared()`/`preparedForms()` → `tokensOf()` → `foldText` from the **shared** `textFold.ts`).

- `TOKEN = /[\p{L}\p{M}\p{N}_]+/gu` already keeps `\p{M}` marks (variation selectors and U+034F are category Mn) *inside* a token instead of dropping them, so `rep️eatso` tokenizes as one run but with the literal invisible mark still inside the string — it never equals teacher material's `repeatso`, so it can't match any locked shingle.
- `padMarkdownEmphasis`'s `letterBefore`/`letterAfter` skip only `\p{Cf}` (`isFormat`). A stray `\p{M}` mark between a letter and a `**`/`` ` ``/`__`/`~~` run (e.g. `l͏**o**op`) is not skipped, so `touchesLetters` is false, the run is never padded, and the word never rejoins.
- `decodeHtmlEntities`'s `NAMED_ENTITIES` table only has `amp, lt, gt, quot, apos, nbsp`; invisible named refs like `&shy;`, `&ZeroWidthSpace;`, `&NoBreak;` fall through "leaves an entity that does not decode as is".

## Design (keeps the fix local to lockedMatch.ts; does not touch the shared fold)
`foldText`/`textFold.ts` is shared by `answerKey.ts`, `numbers.ts`, `tone.ts`, `personaBoundary.ts`, `adviceGuard.ts` (via `foldText`) and `digitForms.ts` (digit-specific mark drop, already after-a-digit only). Changing it would require re-verifying all of those suites for a fix the board scoped to lockedLeak. Instead:

1. Add one new local, length-preserving pass in `lockedMatch.ts`: `dropDefaultIgnorableMarks(text)` — a global regex `/[︀-️͏]/gu` (exactly the two named ranges, not the broader `\p{Default_Ignorable_Code_Point}` set `digitForms.ts` uses) replaced with the existing `PAD` (`​`, already `\p{Cf}`).
2. Wire it in at **one point**, right after `decodeHtmlEntities` and before `foldMarkup`, in both `prepared()` and `preparedForms()`:
   `foldConfusables(foldMarkup(dropDefaultIgnorableMarks(decodeHtmlEntities(text)), markup))`.
   Because it runs before `foldMarkup`, the mark is already `​` by the time `padMarkdownEmphasis`'s existing `isFormat` (`\p{Cf}`) skip runs — so `letterBefore`/`letterAfter` see straight through it with **no change to `padMarkdownEmphasis`, `isLetter`, `letterBefore` or `letterAfter` themselves**. This satisfies the board's "counts `\p{M}` as part of the letter" behaviourally without editing the emphasis-check functions that `labelKeys.ts` also calls directly (see below).
   Because `PAD` is `\p{Cf}`, the final `tokensOf()` → shared `foldText` drop (unchanged) removes it for free, and the existing `spaced()`/`INVISIBLE` (`\p{Cf}`) "space" reading already treats it as a separator — both invisible-character readings (`drop`, `space`) fall out with zero other code change.
3. Extend `NAMED_ENTITIES` with the invisible refs named on the board plus the small set of other single-character invisible named refs in the same HTML5 family: `shy` (U+00AD), `ZeroWidthSpace` (U+200B), `NoBreak` (U+2060), `zwnj` (U+200C), `zwj` (U+200D), `lrm` (U+200E), `rlm` (U+200F). Matching stays case-insensitive (existing `body.toLowerCase()`), unchanged.
   **Known miss, documented in the header comment, not implemented**: MathML-only invisible named refs (`ApplyFunction` U+2061, `InvisibleTimes` U+2062, `InvisibleComma` U+2063, `InvisibleSeparator` U+2064) are left undecoded — reason: no plausible route into student-facing text or teacher material in this product, and adding them without a reproducer would be untested surface area.
4. Update the `lockedMatch.ts` header comment with a short "4.6d" paragraph describing 1–3 (the file already documents each fix round this way).

### Why not change `foldMarkup`/`letterBefore`/`letterAfter` directly
`packages/harness/src/pipeline/generate/labelKeys.ts` imports `decodeHtmlEntities` and `foldMarkup` **directly** from `lockedMatch.ts` (not through `prepared()`) for its own label-key leak/exemption check (task 5.6b). Editing `padMarkdownEmphasis`'s letter-touching logic would change labelKeys' emphasis-exemption behaviour too, with no reproducer or review scoped to that file. The design above only touches `prepared()`/`preparedForms()` (internal, not exported, not used by `labelKeys.ts`), so `foldMarkup` and `letterBefore`/`letterAfter` keep their current behaviour for every direct caller.

The `NAMED_ENTITIES` table *is* shared with `labelKeys.ts` (both its `decodeHtmlEntities(foldMarkup(text, 'rendered'))` and its `decodeHtmlEntities(text)` call sites). This is a small, additive, backwards-compatible table (no existing key is touched), but it is a real shared caller: the gate below reruns `labelKeys.ts`'s suite to confirm no regression.

## Files
- `packages/harness/src/guardrails/lockedMatch.ts`: new `dropDefaultIgnorableMarks`, wired into `prepared()` and `preparedForms()`; `NAMED_ENTITIES` additions; header comment update.
- `packages/harness/src/guardrails/lockedMatch.test.ts`: new/extended unit tests (see below).
- `packages/harness/src/guardrails/lockedLeak.test.ts`: one chain-level fixture test.
- No edits planned to `packages/harness/src/pipeline/generate/labelKeys.ts` or `answerKey.labels.test.ts` — read and rerun only, as the shared-`NAMED_ENTITIES`-caller regression check. If that suite shows a real regression, the builder stops and reports it (a new open question for the lead), rather than silently expanding scope to fix labelKeys.ts behaviour.

### Out of bounds (explicitly not touched by this task)
- `packages/harness/src/guardrails/textFold.ts`, `digitForms.ts` (shared `foldText`; callers: `answerKey.ts`, `numbers.ts`, `tone.ts`, `personaBoundary.ts`, `adviceGuard.ts`, `piiPatterns.ts` indirectly via its own `foldDigitForms` chain) — not touched; same digit-form behaviour is preserved end to end (checked by regression test, see below).
- `packages/harness/src/guardrails/{moderationIn,jailbreak,preGuardCtx}.ts`, `pipeline/runner.ts`, `pipeline/steps/preGuard.ts`, `packages/content/**` — other builders' files; not touched.
- No contracts change.

## Tests (write first, confirm red, then green)
Numbered, reproducers first; all in `lockedMatch.test.ts` unless marked otherwise. Builds every invisible character with an escape (`️`, `͏`), never a literal.

1. **Board example 1 (reproducer)**: `lockedTokens('rep️eatso')` → `['repeatso']`; extend to the board's actual shape — splice `️` into the middle of one word of `SPAN8` (the existing 8-token locked span fixture) and assert `index.hits([...])` is `true`.
2. **Board example 2 (reproducer)**: splice `͏` right before a `**x**` emphasis run inside one word of `SPAN8` (`l͏**o**op`-shaped) and assert `index.hits([...])` is `true`. Add both `️` and `͏` variants to the existing "4.6c fix round 1: invisible characters between the letter and the run do not hide it" `forms` array (same pattern as the existing soft-hyphen/ZWSP/word-joiner/astral-Cf cases) so they're pinned the same way.
3. Standalone drop (no markdown involved), each of the two ranges: `a︀b`, `a️b`, `a͏b` each tokenize as `['ab']` (mirrors the existing `con${ZWSP}dition` → `['condition']` test).
4. 'space' reading: the same standalone cases read as a separator — `lockedTokens('a️b', 'space')` → `['a', 'b']` (mirrors the existing ZWSP 'space'-reading test).
5. `decodeHtmlEntities`: `&shy;`, `&ZeroWidthSpace;`, `&NoBreak;`, `&zwnj;`, `&zwj;`, `&lrm;`, `&rlm;` each decode to their character, padded to the entity's own length (same assertion shape as the existing `&amp;`/`&#108;` tests); case-insensitive match confirmed for at least one (`&SHY;`).
6. Known-miss regression: `&ApplyFunction;` (and one more from the undecoded set) still "leaves an entity that does not decode as is" — pins the documented known miss.
7. **Benign / no-false-positive**: ordinary prose and code (reuse `PROSE`/`CLEAN`/a short code snippet with `_`, `~`, `` ` `` used as real syntax, e.g. `a * b`, `snake_case_name`) fold identically before and after the change — assert the existing unrelated `lockedMatch.test.ts` assertions for these are still exactly as before (no new splits, no new merges). Add one new case: a benign emoji sentence unrelated to any locked span (e.g. heart emoji + VS16) does not trigger `index.hits(...)`.
8. Digit-path regression: a keycap sequence inside locked-span text (`9️⃣` within an 8-token span) still folds its digit correctly through `lockedTokens`/`index.hits` — confirms the new local drop and `digitForms.ts`'s existing after-a-digit mark drop don't conflict (see Design §2 reasoning).
9. Linear time: extend the existing "4.6c fix round 1: long runs of invisible characters around emphasis stay linear" `units` array with `'️'` and `'͏'` repeats; same bound.
10. **Chain-level fixture (lockedLeak.test.ts)**: splice `️` or `͏` into the existing `LOCKED` fixture text the same way as case 1/2, run it through `createLockedLeakGuard()` with `memoryRetrieval({ chunks: retrievalWorld() })`, and assert the guard rewrites to `lockedReplyText(...)` — this is the "fails when the fix is reverted" fixture the accept line asks for at guard level, not just token level.
11. Shared-caller regression (no edit): `corepack pnpm turbo run test --filter=...@edmate/harness -- labelKeys` equivalent (run `answerKey.labels.test.ts`, the only suite exercising `labelKeys.ts`) stays green unchanged.
12. Full regression: every existing `lockedMatch.test.ts` and `lockedLeak.test.ts` assertion still passes unedited. **Never edit an existing assertion to make it pass.**

## Risky paths touched
`packages/harness/src/guardrails/**` (lockedMatch.ts, lockedMatch.test.ts, lockedLeak.test.ts) — per `risk-paths.txt`, this group needs `code-reviewer` (MVP-first rule; `safety-reviewer` runs once at the pilot gate, not per PR) plus a lead `risk: high` decision at merge. No other risky-path group is touched (`labelKeys.ts` is read/rerun only, not edited; `packages/harness/src/pedagogy/**` not touched).

## Gate
- `source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness`
- Coverage for `src/guardrails/**` at 100%.
- `python3 .githooks/secret-scan.py --all`.

## Open questions
None. The board task gives the two concrete examples and the entity list is explicitly "or list them as known misses with the reason" (Design §3 does both: decodes the named ones, lists the MathML-only ones as a documented miss).

## Budget
Budget: 85 tool calls (1 phase, packages/harness only).

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash (test/typecheck/lint/coverage and secret-scan only).

## Exit conditions
Status: DONE when the gate (typecheck, lint, test, 100% coverage on `src/guardrails/**`) is green with all 12 numbered cases present and passing, `labelKeys.ts`'s suite unchanged and green, and no existing assertion edited. Status: PARTIAL past ~85 tool calls, or if the `labelKeys.ts` regression check (case 11) fails and fixing it would mean editing a file outside this plan's scope — in that case stop and report the open question rather than expanding scope.

## Lead review (30 Oct 2026)
READY, approved. Notes for the builder:
- `decodeHtmlEntities` is also called by `pipeline/generate/labelKeys.ts`. After you add entities, run `answerKey.labels.test.ts` and say in the handoff that it passes unchanged.
- Drop the default-ignorable marks only on the locked-match path, never in the shared `textFold.ts`. Add a benign-text test that shows emoji with U+FE0F, such as a heart, still read normally and raise no hit.
