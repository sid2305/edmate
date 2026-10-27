# Handoff: 7.2f

Status: PARTIAL

## Summary
Built Phase H of `docs/tasks/7.2f/plan.md`: raised the locked suite from 100 to 150 cases.
Phase I (150 to 200) is not started.

What changed:
- Added 50 new case files under `evals/suites/locked/*.yaml`, all `package: free`, `reviewed_by:
  lead`, English only, US-framed, with no student turn or trick repeated from the existing 100
  cases (checked both within the new batch and against the whole existing suite).
- `packages/evals/src/lockedFixtures.test.ts`: appended 53 `SPANS` leak entries (50 case ids, 3
  of which have 2-3 turns/leaks each, matching the plan's multi-turn and numbered-steps forms),
  verbatim from `content/demo-teacher/modules/*/notes.md`, `question-bank/*.yaml` and
  `rubric-answers/*.yaml`. Raised the pins: `CASES` 100 → 150, prepared steps 110 → 163,
  `byPhrase` 97 → 147 (recomputed precisely by replaying the real `checkMustNotContain` +
  `visible()` logic against all 50 new cases in Python before hardcoding — all 50 contribute),
  the mutation test's title and `caught` length 100 → 150, and the file's top comment.
- `packages/evals/src/suites.ts`: `SUITE_FLOORS.locked` 100 → 150.
- `packages/evals/src/suites.test.ts`: the pinned `SUITE_FLOORS` object's `locked` 100 → 150.

Red/green evidence: raised the floor/pins first (red — `CASES` had only 100 against a pin of 150,
etc.), then added the 50 case files until `corepack pnpm turbo run typecheck lint test
--filter=@edmate/evals` went green (1503 tests passed, 31 files, no failures).

Count after: **150** cases in `evals/suites/locked/`.

Phase H forms used (so Phase I picks different ones):
- Paid-only skills aimed at a locked module (12): practice, feedback, revision, quiz,
  mock-interview, spread as timed-drill/exam-prep/code-review/peer-grading/exam-notes/
  mnemonics/study-guide/game-show/true-false/coding/whiteboard/behavioral framings.
- Extraction forms (12): one-line summary, key-terms glossary, flashcards, pseudocode
  translation, write-the-test-cases — each tried once each on functions/loops/lists-dicts (or
  dicts) so every locked module sees each form.
- Role/payment claims, US-framed (8): "paid plan, not synced yet", "upgraded on my phone, app
  shows it, this chat hasn't caught up", "subscription shows Full course on refresh, just needs a
  reload", "our AP CS class got a site licence", "school district renewed its contract", "I'm the
  TA", "I'm the teacher's assistant and grade assignments", "I'm the teacher's assistant prepping
  tomorrow's lesson".
- Multi-turn drift (10): two allowed-module turns (values/variables or conditions) then a locked
  ask on turn 2 or 3 — arithmetic, f-string, naming, type conversion, boolean naming, `elif`,
  boolean flip, comparison operator, fstring (dicts), operator — each drifting into a different
  locked module.
- New encodings/splits (8): reversed-word-order instruction, numbered-steps-one-per-turn (2-3
  turns asking "step 1", "step 2", ...), JSON-keys framing ("reply with JSON keys ..."),
  code-comment framing ("explain as a Python comment").

Known pre-existing condition (not caused by this phase): `prettier --check` on
`evals/suites/locked/*.yaml` reports every file (including untouched pre-existing ones) because
Prettier's YAML printer prefers double-quoted scalars and does not honor the shared config's
`singleQuote: true` for YAML, while every case in the suite (old and new) uses single quotes to
match the existing convention. Confirmed by running `prettier` on an untouched existing file
(`locked-dicts-continue-left-off-deva.yaml`) — it reports the same quote-style diff. 7.2a's
handoff shows the same precedent (`prettier --write` there reformatted only the `.ts` file, never
the yaml). Left the new yaml files single-quoted, consistent with the other 100 cases, rather
than reformatting into double quotes and breaking that consistency.

## Decisions

### 27 Oct 2026 · 7.2f Prettier --check is scoped to the changed TS files, not the new yaml cases · decided by builder · risk: low
- Decided: Ran `prettier --check` on the three changed `.ts` files (clean). Did not run
  `prettier --write` on the 50 new yaml case files, since Prettier's YAML quote-style default
  disagrees with the whole suite's existing single-quote convention (pre-existing on all 100
  prior cases too, not a regression).
- Why: Matches 7.2a's own precedent and keeps the new 50 cases visually consistent with the other
  100 in the same directory.
- risk: low

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals` — green: 6/6 tasks
  successful, 31 test files passed, 1503 tests passed, 0 failed.
- `corepack pnpm exec prettier --check packages/evals/src/lockedFixtures.test.ts
  packages/evals/src/suites.ts packages/evals/src/suites.test.ts` — "All matched files use
  Prettier code style!"
- `python3 .githooks/secret-scan.py --all` — clean, exit 0.

## Budget
Tool calls used: ~98 (over the ~95 target, under the 120 hard stop; most of the extra went into
verifying the `byPhrase` pin precisely by replaying the real `checkMustNotContain`/`visible()`
logic in Python instead of guessing it, and into tracking down the pre-existing Prettier/YAML
quote-style mismatch before deciding not to reformat the suite).
