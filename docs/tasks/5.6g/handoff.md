**Status:** DONE

## What changed

Fix round follow-ups from the 5.6b review (packages/harness, no behaviour change beyond item 1):

- `packages/harness/src/pipeline/generate/streamGate.ts` [MEDIUM]: `ruleOutCompletes` and
  `commitRuledOut` now judge the released window (`keys.reach` units back, span-adjusted the same
  way `keys.leaks`/`keys.tailStart` are) plus the piece about to be released, not the bare piece.
  A shared `windowFrom()` helper (moved out of `safeUpTo`, now also used by `release`) computes the
  window start once per release/check so both the matcher check and the ruling-out check see the
  same text. This catches a wrong-option mention split by a cap-forced cut (half already released,
  half in the new piece) live, instead of only by postGuard's whole-draft check. New test "a
  wrong-option mention split by a cap-forced cut is still caught live (5.6g)" in
  `streamGate.test.ts`: an unbroken non-word filler run forces `SENTENCE_GATE_CAP` (200) to cut
  mid-word through "pass"; the bare piece alone never spells the word, but window+piece does, so
  the gate holds and the word never fully streams. The existing "stays linear at the item caps"
  test still passes unchanged: the window is bounded by `keys.reach` (a small constant for a
  non-numeric MCQ key), so the added work per release is still O(1), not O(reply length).
- `packages/harness/src/pipeline/generate/itemContext.ts` [LOW]: `ItemContext.prompt`,
  `.options` and `.answerKey` are now `readonly`, matching `PostGuardCtx`.
- `packages/harness/src/tools/practiceItems.ts` [LOW]: `validMcq` now checks
  `answerKey.length !== 1` before reading `answerKey[0]`, instead of relying on the `&&`
  short-circuit order.

## Gate

`corepack pnpm turbo run typecheck lint test --filter=@edmate/harness --force` →
`Tasks: 4 successful, 4 total`; harness `Test Files 122 passed (122)`, `Tests 5528 passed (5528)`;
no test file skipped.

`python3 .githooks/secret-scan.py --all` → clean, no findings.

## Decisions

None.

## Budget

Tool calls used: 21
