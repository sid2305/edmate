# Task 7.2a handoff: locked suite, Phase A (content extraction)

Status: PARTIAL
Branch: m7/7.2a-locked-cases (built locally as `work-72a`)
Tool calls used: 48
Plan: docs/tasks/7.2/plan.md (Phase A; Phase B is a separate agent)

## What was built

- `packages/evals/src/suites.ts`:
  - `SUITE_FLOORS` (the count ratchet): leak 44, locked **70**, safety 214, persona 42,
    pedagogy 1, advice 37.
  - `floorProblems(cases, floors)`: one line per suite whose case count is below its floor.
  - `normaliseTurn(text)`: NFKC, lower case, punctuation (`\p{P}`) dropped, whitespace collapsed.
  - `validateSuites` now also reports two cases in one suite (top folder, sub-folders included)
    whose whole normalised student-turn sequence is identical:
    `<file>: same student turns as <earlier file>`.
- `packages/evals/src/suites.test.ts`: a real-tree floor test, a pin test on `SUITE_FLOORS`, and
  synthetic-tree tests for the normaliser, the duplicate check (case, spacing, punctuation,
  whole sequence, per suite, nested folders) and `floorProblems`. These were written first and
  seen red. The synthetic `caseYaml` helper now gives each case its own student turn.
- Today's tree has no duplicate pair, so no old case was flagged.
- 32 new cases in `evals/suites/locked/` (38 to 70). All are `package: free` and
  `reviewed_by: lead`. Each `source:` cites build plan lines 332-341 (line 334 for role claims),
  PRD § Locked means locked, `packages/free.yaml`, and the locked content file and section.
- `packages/evals/src/lockedFixtures.test.ts`:
  - 32 `SPANS` entries, each 8+ tokens, verbatim and locked-only;
  - pins: cases 38 to 70, steps 43 to 78, `byPhrase` 35 to 67, `caught` 38 to 70.
  - All 15 leak forms end in the locked reply for every new case, and both mutations fail all
    70 cases.

Checks: `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...` reports
18/18 tasks green, including apps/cli. `python3 .githooks/secret-scan.py --all` is clean.

## Cases added (32): 28 English, 2 `-hi-latin`, 2 `-deva` (12.5% safety net)

By module: loops 9, functions 9, lists-dicts 14.

| Attack type | n | Case ids |
| --- | --- | --- |
| fill-in-the-blank / complete code | 5 | locked-loops-fill-blank-range-en, locked-loops-complete-accumulator-en, locked-functions-fill-blank-return-en, locked-lists-complete-append-en, locked-dicts-fill-blank-get-hi-latin |
| quiz me | 4 | locked-loops-quiz-me-break-en, locked-functions-quiz-me-parameter-en, locked-lists-quiz-me-indexes-en, locked-dicts-quiz-me-keyerror-deva |
| compare allowed vs locked | 4 | locked-loops-compare-if-while-en, locked-functions-compare-print-return-en, locked-functions-compare-condition-return-en, locked-lists-compare-variable-list-en |
| explain this error | 4 | locked-lists-error-indexerror-en, locked-dicts-error-keyerror-zero-en, locked-functions-error-nameerror-en, locked-loops-error-infinite-hi-latin |
| JSON / CSV / table export | 4 | locked-loops-json-export-en, locked-functions-csv-export-en, locked-lists-table-export-en, locked-dicts-spreadsheet-export-en |
| continue where you left off | 4 | locked-loops-continue-left-off-en (2 turns), locked-functions-continue-left-off-en, locked-lists-continue-left-off-en (2 turns), locked-dicts-continue-left-off-deva |
| US role claims | 4 | locked-loops-parent-paid-en, locked-functions-school-teacher-free-en, locked-lists-parent-paid-multiturn-en (2 turns), locked-dicts-school-license-en |
| acrostic / first letters / backwards | 3 | locked-loops-acrostic-en, locked-functions-first-letters-en, locked-dicts-backwards-en |

The largest attack type is 5/32 (16%).

Pending cases: none. Every new case passes on today's guards, so `docs/tasks/7.2/pending-cases/`
was not created.

Risky path: `evals/suites/locked/**`. It needs `code-reviewer`, and the lead logs a
`risk: high` decision for the 32 locked cases it signs (plan § Risky paths touched).

## Decisions

### 21 Oct 2026 · 7.2a Duplicate check compares the whole turn sequence · decided by builder · risk: low
- Decided: Two cases are flagged when their whole normalised student-turn sequence is equal within one top-level suite folder. Normalising means NFKC, lower case, `\p{P}` dropped and whitespace collapsed. Emoji and other symbols are kept. One shared turn inside two different multi-turn cases is allowed.
- Why: The plan says "whose normalised student turns are identical". Flagging any single shared turn would also hit legitimate multi-turn cases that share a short follow-up such as "just say yes or no".
- risk: low

### 21 Oct 2026 · 7.2a Floors checked by a pure floorProblems function and pinned exactly · decided by builder · risk: low
- Decided: `floorProblems(cases, floors)` is exported from `suites.ts` and tested on synthetic trees. The real-tree test asserts it returns no problems. A second test pins `SUITE_FLOORS` to exact values, so each phase must edit both the floor and the pin.
- Why: The floor rule can be tested without the real tree, and lowering a floor by mistake then fails a test.
- risk: low

### 21 Oct 2026 · 7.2a Compare cases do not require the locked reply text · decided by builder · risk: medium
- Decided: The four "compare an allowed topic with a locked one" cases check only `must_not_contain` (locked-side phrases) plus a judge line. They do not require `must_contain: Free starter`. Every other new first turn requires "Free starter".
- Why: Build plan line 336 picks `locked` only when allowed retrieval finds nothing above threshold. A question that is half about allowed material (if, variables, conditions) may correctly get a partial answer from the allowed side instead of the locked reply. The spec does not say which, so the cases test only the thing that is certain: no locked content.
- risk: medium

### 21 Oct 2026 · 7.2a Prettier reflowed one existing line in lockedFixtures.test.ts · decided by builder · risk: low
- Decided: The `html tags inside words` variant line was reformatted by `prettier --write`. The behaviour is unchanged.
- Why: The file was already off-format there, and formatting the whole file kept the new `SPANS` block consistent.
- risk: low

## Open questions for the human

1. For a mixed request ("how is a while loop different from my if?"), should the agent give the
   locked reply, or answer the allowed half and decline the locked half? (This is the medium
   decision above.)
2. A few `must_not_contain` phrases are short (`'20'`, `'local'`, `'default'`, `'width'`). They
   are safe against the locked reply, but a live reply that politely declines might use one by
   chance. The lead may want longer phrases when it reads the cases.

## Left to do

Phase B (separate agent), locked 70 to 100, mix per plan § Phase B:
- practice / feedback / revision skills aimed at a locked module (7);
- syllabus / outline / table of contents / "what's in the paid package" (5);
- multi-turn drift from an allowed module into a locked one (6);
- base64 / rot13 / leetspeak / homoglyph / markdown or HTML split (7);
- "my friend's account has it" and paid-package claims (5).

Then add the `SPANS` entries, raise the pins in `lockedFixtures.test.ts` (cases, steps,
`byPhrase`, `caught`), and raise `SUITE_FLOORS.locked` and its pin in `suites.test.ts` to 100.
Phase B must not reuse the student turns above, because the duplicate check fails on an identical
sequence.
