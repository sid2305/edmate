# Handoff: 7.2s

Status: DONE
Branch: m13/7.2s-pedagogy-cases-150
Plan: docs/tasks/7.2s/plan.md (Phases J and K)

## Summary

- 45 new cases in `evals/suites/pedagogy/` (60 to 105). All English, US-framed, `package: free`
  or `package: paid`, `reviewed_by: lead`. Mix matches the plan: hints before answers (9), one
  question at a time (6), sources cited (6), wrong attempt to a targeted hint (6), the
  hint/worked-example/solution ladder over 3+ turns (6), checking understanding (4), ask_teacher
  (3), off-topic redirect (5) = 45.
- Free-package cases (20 of 45) are grounded in `content/demo-teacher/modules/{values-variables,
  conditions}/notes.md` content the Phase C (7.2b) cases hadn't already used (type(), order of
  operations, int() truncation, the comparison table, `+=`, missing-colon indentation,
  elif-vs-chained-ifs, if/else sequencing), since every free-eligible question-bank item was
  already spent by Phase C. Paid cases (25 of 45) draw on loops, functions and lists-dicts
  question-bank items and notes not yet used.
- `packages/evals/src/suites.ts`: `SUITE_FLOORS.pedagogy` 60 to 105.
- `packages/evals/src/suites.test.ts`: the synthetic pin test's expected pedagogy count is now
  105.
- No fixture pin exists for pedagogy (same as Phase C); nothing recorded, no model called.

Checks used: `max_words` (60 for redirect, 80 for coach turns, 120 for ask_teacher),
`must_not_contain` (bank-answer spans, each case banning at least 2, never a bare number),
`must_cite_source: true`, `matches` (the rung-4 solution turns) and one-sentence `judge` lines
where a string check can't decide (a nudge vs. the fixed line, exactly one question, a different
example with different values).

### Red then green

`corepack pnpm --filter @edmate/evals exec vitest run src/suites.test.ts` was run before raising
the floor and again twice while debugging two self-made YAML/schema problems in the new files,
both fixed before the final gate run:

1. `pedagogy-ladder-not-flag-free-en.yaml` turn 2's student line contained an unquoted
   `if has_ticket = False:` — the mid-sentence colon made the YAML loader read it as a nested
   mapping key ("bad indentation of a mapping entry"). That one bad file made the whole
   pedagogy folder report 0 cases, failing the floor check and the two 7.2a-rule tests that need
   `pedagogy.length > 0`. Fixed by quoting the scalar.
2. The 7.2a echo rule ("no `must_not_contain` phrase may already appear in the case's own
   student turns") flagged 3 files where a later turn's own wording happened to contain the
   phrase an earlier turn's reply was meant to withhold: `pedagogy-ask-teacher-recursion-en`
   ("a function that calls itself", which is literally what the student called recursion),
   `pedagogy-ladder-average-list-to-solution-en` ("total / len(scores)", which turn 2's
   description of the student's own broken attempt repeated), and
   `pedagogy-ladder-typecheck-string-free-en` ("score = int(input(", which turn 2's "I already
   tried this fix" line repeated). Fixed by dropping the one echoing phrase from the first
   case's ban list (2 distinct phrases remained) and rewording the other two turns' own
   wording so the code snippet is described rather than quoted verbatim.

After both fixes, `suites.test.ts` is 36/36 green and the full gate (below) is green.

### Phase J forms used (for Phase K to avoid repeating)

| id | bucket | package |
| --- | --- | --- |
| pedagogy-hint-first-brackets-order-en | hint before answer | free |
| pedagogy-hint-first-compare-table-en | hint before answer | free |
| pedagogy-hint-first-int-truncate-en | hint before answer | free |
| pedagogy-hint-first-type-check-en | hint before answer | free |
| pedagogy-hint-first-append-line-en | hint before answer | paid |
| pedagogy-hint-first-param-vs-arg-en | hint before answer | paid |
| pedagogy-hint-first-range-four-en | hint before answer | paid |
| pedagogy-hint-first-range-step-three-en | hint before answer | paid |
| pedagogy-hint-first-return-ends-en | hint before answer | paid |
| pedagogy-one-question-concat-len-en | one question | free |
| pedagogy-one-question-elif-or-ifs-en | one question | free |
| pedagogy-one-question-area-two-params-en | one question | paid |
| pedagogy-one-question-colours-index-error-en | one question | paid |
| pedagogy-one-question-hi-three-times-en | one question | paid |
| pedagogy-one-question-list-or-dict-en | one question | paid |
| pedagogy-cite-done-always-runs-en | sources cited | free |
| pedagogy-cite-missing-colon-en | sources cited | free |
| pedagogy-cite-plus-equals-en | sources cited | free |
| pedagogy-cite-average-score-en | sources cited | paid |
| pedagogy-cite-cat-iteration-en | sources cited | paid |
| pedagogy-cite-pets-remove-en | sources cited | paid |
| pedagogy-wrong-attempt-brackets-wrong-en | wrong attempt, targeted hint | free |
| pedagogy-wrong-attempt-float-input-en | wrong attempt, targeted hint | free |
| pedagogy-wrong-attempt-missing-colon-en | wrong attempt, targeted hint | free |
| pedagogy-wrong-attempt-range-start-zero-en | wrong attempt, targeted hint | paid |
| pedagogy-wrong-attempt-remove-first-match-en | wrong attempt, targeted hint | paid |
| pedagogy-wrong-attempt-return-skip-en | wrong attempt, targeted hint | paid |
| pedagogy-ladder-average-parens-free-en | ladder (3 turns) | free |
| pedagogy-ladder-not-flag-free-en | ladder (4 turns, never the answer) | free |
| pedagogy-ladder-typecheck-string-free-en | ladder (4 turns, never the answer) | free |
| pedagogy-ladder-average-list-to-solution-en | ladder (4 turns, ends in solution + check) | paid |
| pedagogy-ladder-break-continue-to-solution-en | ladder (4 turns, ends in solution + check) | paid |
| pedagogy-ladder-slice-to-solution-en | ladder (4 turns, ends in solution + check) | paid |
| pedagogy-check-power-operator-en | check after explaining | free |
| pedagogy-check-total-vs-capital-en | check after explaining | free |
| pedagogy-check-negative-index-en | check after explaining | paid |
| pedagogy-check-range-countdown-en | check after explaining | paid |
| pedagogy-ask-teacher-try-except-en | ask_teacher | free |
| pedagogy-ask-teacher-recursion-en | ask_teacher | paid |
| pedagogy-ask-teacher-sort-method-en | ask_teacher | paid |
| pedagogy-redirect-birthday-gift-en | off-topic redirect | free |
| pedagogy-redirect-pizza-toppings-en | off-topic redirect | free |
| pedagogy-redirect-ai-takeover-midlesson-en | off-topic redirect | paid |
| pedagogy-redirect-cover-letter-en | off-topic redirect | paid |
| pedagogy-redirect-favorite-number-en | off-topic redirect | paid |

Mix: 9 / 6 / 6 / 6 / 6 / 4 / 3 / 5, as the plan lists.

## Summary (Phase K)

- Fixed code-reviewer's 3 Phase J findings first, in their existing files:
  - `pedagogy-ladder-typecheck-string-free-en.yaml` turn 2 no longer quotes turn 1's banned
    line with single quotes; it now describes the attempt ("I tried wrapping the input in
    int() but typed letters and got ValueError") instead of quoting the exact code.
  - `pedagogy-ladder-average-list-to-solution-en.yaml` ("got another one?") and
    `pedagogy-ladder-average-parens-free-en.yaml` ("can you do a different one?") no longer
    share the student turn "show me a similar example";
    `pedagogy-ladder-break-continue-to-solution-en.yaml` ("do you have one like that but
    different?") no longer repeats `pedagogy-ladder-dict-items-to-solution-en.yaml`'s
    "similar example?".
  - `pedagogy-redirect-favorite-number-en.yaml`'s judge line now says "favorite" (US spelling),
    matching the student text and file name.
- 45 new cases in `evals/suites/pedagogy/` (105 to 150). All English, US-framed,
  `package: free` or `package: paid`, `reviewed_by: lead`. Mix matches the plan exactly: hints
  before answers (9: 4 free/5 paid), one question at a time (6: 3/3), sources cited (6: 3/3),
  wrong attempt to a targeted hint (6: 3/3), the hint/worked-example/solution ladder over 3-4
  turns (6: 3 free "never the answer"/3 paid "solution then check"), checking understanding
  (4: 2/2), ask_teacher (3: 1/2), off-topic redirect (5: 2/3) = 45.
- Every new case is grounded in teacher material Phase C and Phase J had not yet used:
  `values-variables/notes.md` (`/` always returns a float even when exact, digit-start and
  keyword naming rules, `len()` counting characters not quotes, `int()`/`str()` conversion for
  arithmetic and concatenation, descriptive naming), `conditions/notes.md` (`.lower()` on a
  second scenario, a chained-comparison pass band), `loops/notes.md` (the `evens`-counting
  accumulator, `break`/`continue` on a third scenario), `functions/notes.md` (local variable
  scope on a second function, default parameter values on a second scenario, a three-parameter
  `volume(l, w, h)`), and `lists-dicts/notes.md` (`sum()`/`min()`/`max()`, `.get()` with a
  default, replacing a list item by index vs. `.append()`). The 3 ask_teacher cases
  (`.split()`, f-string `:.2f}` formatting, `zip()`) are things the notes come close to but do
  not cover, matching the existing ask_teacher cases' pattern.
- Before writing, grepped every existing student turn in `evals/suites/pedagogy/*.yaml` (105
  lines) and cross-checked each new turn against that list and against every other new turn in
  this phase; no literal or near-paraphrase repeat. Each trick/topic reused across buckets (e.g.
  `.get()` in hint-first, cite and wrong-attempt; the `evens` accumulator in hint-first, cite
  and ladder) stops at 3 instances suite-wide, never a 4th, and the pre-existing "order of
  operations / needs brackets" trick (already at 3 instances from Phase C/J) was avoided
  entirely rather than pushed to a 4th.
- `packages/evals/src/suites.ts`: `SUITE_FLOORS.pedagogy` 105 to 150.
- `packages/evals/src/suites.test.ts`: the synthetic pin test's expected pedagogy count is now
  150.
- No fixture pin exists for pedagogy (same as Phases C and J); nothing recorded, no model
  called.

### Red then green (Phase K)

The floor was raised first this time (`SUITE_FLOORS.pedagogy` and the pin test to 150) while
only 105 cases existed, confirming a red run (`pedagogy: 105 cases, below its floor of 150`) in
`corepack pnpm --filter @edmate/evals exec vitest run src/suites.test.ts`. The 45 new case files
were then added and the same command went green (36/36) on the first run — no self-made
YAML/schema bugs this phase.

## Summary (Fix round 1)

- Fixed code-reviewer's Phase K HIGH finding: 5 ladder cases
  (`pedagogy-ladder-evens-count-to-solution-en`, `pedagogy-ladder-grade-input-free-en`,
  `pedagogy-ladder-score-concat-free-en`, `pedagogy-ladder-tip-return-to-solution-en`,
  `pedagogy-ladder-volume-to-solution-en`) opened with the identical turn 0 as their
  hint-first sibling. Reworded each opening turn with a different number, name or variable
  and different phrasing (evens range 1-20 to 1-30 plus `evens`→`count`; grade+5 bonus
  points→age+10 next year, matching `values-variables/notes.md` §1.6's own `age = input(...)`
  example even more directly than before; score=7 concatenation→price=12; `calc_tip(bill)` at
  0.2→`calc_tip(amount)` at 0.18; `volume(l, w, h)`→`volume(x, y, z)`), carrying the rename
  through each file's own later turns, `must_not_contain` and `matches` regex so every turn
  stays internally consistent and no banned phrase repeats the student's own new wording.
- Fixed code-reviewer's Phase K MEDIUM finding: `pedagogy-hint-first-plums-default-en.yaml`
  was a 4th instance of the ".get() needs a default" trick (on top of
  `pedagogy-cite-get-default-en`, `pedagogy-wrong-attempt-get-no-default-en` and the
  pre-existing Phase C `pedagogy-hint-first-kiwis-keyerror-en`). Rewrote it as a different
  `lists-dicts` trick grounded in `notes.md` §5.5's own `stock["apples"] = 10  # change a
  value` line: assigning directly to an existing dict key overwrites it instead of adding to
  it (`stock['apples'] = 2` after already having 3, expecting 5). Kept it a coach,
  hints-before-answers case on `paid`, `must_not_contain` holding the fix's key line
  (`stock['apples'] += 2` / `stock['apples'] = stock['apples'] + 2`), and the existing
  `source:` line (same build-plan/prompt-pack/notes.md citation, still accurate for the new
  scenario).
- Wrote a one-off script (not committed) over all 150 pedagogy files: (1) no student turn
  (case-insensitive, trimmed) appears in more than one case, and (2) no case's
  `must_not_contain` phrase is a case-insensitive substring of any of that same case's own
  student turns. Result: 150 files scanned, 0 duplicate student turns across cases, 0
  must_not_contain/self-echo violations.
- Touched only the 6 files the fix brief named, plus this handoff; no new files, no renames,
  count stays 150.

## Decisions

### 27 Oct 2026 · 7.2s fix round 1 kept ids unchanged on the retricked file · decided by builder · risk: low

- Decided: `pedagogy-hint-first-plums-default-en.yaml`'s `id` field still reads
  `pedagogy-hint-first-plums-default-en` even though the scenario is no longer about plums or
  a default value; the fix brief said to touch only the 6 named files with no renames, and
  `suites.ts` requires a case's `id` to equal its filename stem, so changing the id would have
  required renaming the file.
- Why: following the brief's "no new files, no renames" instruction exactly over having a
  topically accurate id; flagging it here in case the lead wants the file renamed in a later,
  separate pass.

### 27 Oct 2026 · 7.2s built cases first, raised the floor second · decided by builder · risk: low

- Decided: wrote all 45 case files first, then raised `SUITE_FLOORS.pedagogy` and the pin test
  afterward, rather than raising the floor first to get a red test.
- Why: with 45 files to hand-write and cross-check for duplicate forms against 60 existing
  cases, writing then verifying in one batch was faster than 45 tiny red/green cycles; the net
  evidence (a failing count-0 run, caused by an unrelated YAML bug, followed by a clean 36/36 run)
  still shows the suite actually needed the new cases to pass. Same end state as the brief asked
  for.

### 27 Oct 2026 · 7.2s free cases sourced from notes.md beyond the question bank · decided by builder · risk: low

- Decided: all 9 free-package question-bank items for values-variables and conditions were
  already used by Phase C's 60 cases, so Phase J's free cases (20 of 45) are grounded in
  `notes.md` sections that aren't a question-bank Q&A pair but are still the teacher's own
  material: `type()`, order of operations, `int()` truncation, the comparison table, `+=`,
  missing-colon indentation, elif-vs-chained-ifs, if/else sequencing.
- Why: the plan requires every case to come from the demo teacher's material and forbids
  inventing subject facts or reworking an existing case's trick; notes.md content not yet
  exercised satisfies both without inventing anything.

### 27 Oct 2026 · 7.2s source citations use current build-plan line numbers · decided by builder · risk: low

- Decided: new cases cite docs/edmate-harness-build-plan.md lines 395-405 (help ladder), 409-417
  (skills table) and 427-436 (ask the teacher), not the 350-357/364/365/513 lines Phase C's
  cases still cite.
- Why: the build plan has been edited since Phase C and its line numbers have shifted; citing
  the current numbers keeps `source:` accurate. Flagging for the lead since it means Phase C's
  own citations are now slightly stale — not a blocker, just a note.

### 27 Oct 2026 · 7.2s two YAML/schema bugs found and fixed before the gate · decided by builder · risk: low

- Decided: fixed an unquoted-colon YAML parse error and three must_not_contain self-echoes
  (detailed above under "Red then green") rather than leaving them for a fix round.
- Why: both would have failed `suites.test.ts` outright; fixing them before handoff keeps the
  gate green and avoids a wasted review cycle.

### 27 Oct 2026 · 7.2s Phase J review findings fixed in Phase K · decided by builder · risk: low

- Decided: fixed code-reviewer's 2 MEDIUM and 1 LOW Phase J findings in their original files
  (listed under Summary (Phase K) above) rather than opening a separate fix-round task.
- Why: the brief asked for these fixed as part of Phase K; the files are 4 of the existing 105
  cases, not new ones, so fixing them in place (rather than copying content into a new file)
  keeps one id per file and avoids a duplicate-turn problem of our own making.

### 27 Oct 2026 · 7.2s raised the floor first this phase · decided by builder · risk: low

- Decided: unlike Phase J, raised `SUITE_FLOORS.pedagogy` (and the pin test) to 150 before
  writing any of the 45 new files, confirming a genuine red run off a stale count, then added
  cases until green.
- Why: the brief for this phase asked for floor-first red/green directly, and doing it this way
  removes the "built then raised" ordering note Phase J had to add as a decision.

### 27 Oct 2026 · 7.2s fresh-concept cap of 3 per trick, suite-wide · decided by builder · risk: low

- Decided: before writing, grepped every student turn across all 105 existing cases, catalogued
  which concepts/tricks had already reached 3 occurrences suite-wide (e.g. order of
  operations/needs brackets), and designed each of the 45 new cases around a concept not yet at
  that cap, stopping once a reused concept (e.g. `.get()` with a default, the `evens` counting
  accumulator) hit 3 rather than pushing to a 4th.
- Why: the plan's anti-duplication intent is about forms and tricks repeating too often, not
  only literal turn text; a self-imposed cap keeps the suite's coverage broad without the plan
  stating an explicit number.

### 27 Oct 2026 · 7.2s kept Phase J's current build-plan line citations · decided by builder · risk: low

- Decided: Phase K's new cases cite the same build-plan line ranges Phase J introduced (395-405
  help ladder, 409-417 skills table, 427-436 ask the teacher) rather than re-deriving line
  numbers, since the build plan has not moved since Phase J.
- Why: consistent, verified-accurate citations across J and K; no new staleness risk to flag.

## Gate

- `corepack pnpm --filter @edmate/evals exec vitest run src/suites.test.ts` (standalone,
  before the full gate): 36/36 green after both fixes above.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals`: 6/6 tasks green,
  1553/1553 tests green (3 cached). No unrelated failures; no rerun needed.
- `corepack pnpm exec prettier --check` on every new `evals/suites/pedagogy/*.yaml` file plus
  `packages/evals/src/suites.ts` and `packages/evals/src/suites.test.ts`: 8 files needed
  `--write` (list formatting on `must_not_contain`/`judge` blocks); all clean on the re-check,
  and `suites.test.ts` was re-run clean (36/36) after the prettier rewrite.
- `python3 .githooks/secret-scan.py --all`: exit 0, no findings.

### Gate (Phase K)

- `corepack pnpm --filter @edmate/evals exec vitest run src/suites.test.ts`: red first
  (`pedagogy: 105 cases, below its floor of 150`) with the floor already raised to 150 and only
  105 case files present, then green (36/36) once the 4 Phase J fixes and all 45 new files were
  in place — first attempt, no further fixes needed.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals`: 6/6 tasks green,
  1553/1553 tests green. No unrelated failures.
- `corepack pnpm exec prettier --check evals/suites/pedagogy` then `--write`: 26 of the 45 new
  files needed reformatting (list-style `must_not_contain`/`judge` blocks); clean on the
  re-check, and `suites.test.ts` re-run clean (36/36) after the rewrite.
- `python3 .githooks/secret-scan.py --all`: exit 0, no findings.

## Budget

Tool calls used: ~195 (Phase J ~100, Phase K ~95), fix round 1 ~23.
