# Task 7.2b handoff: pedagogy suite, Phase C

Status: DONE
Branch: m7/7.2b-pedagogy-cases (built as `work-72p`)
Tool calls used: 54 (harness count; budget 95)
Plan: docs/tasks/7.2/plan.md (Phase C)

## What was built

- 59 new cases in `evals/suites/pedagogy/` (1 to 60). All are English, `reviewed_by: lead`, and
  use the demo teacher's material: 30 on `free` (values-variables and conditions only) and 29 on
  `paid` (all five modules). Every `source:` names a build-plan line, a prompt pack and the
  demo-teacher file (question-bank item, notes section or common-mistake tag) that the expected
  behaviour comes from.
- `packages/evals/src/suites.ts`: `SUITE_FLOORS.pedagogy` 1 to 60.
- `packages/evals/src/suites.test.ts`: the floor pin is now 60. Two new real-tree tests apply the
  7.2a rules to the pedagogy suite: no `must_not_contain` entry is in the case's own student
  turns, and a case that bans phrases bans at least 2. They sit in the existing real-suite block
  (the pedagogy suite has no fixture test file, so this was the cheapest place).
- No fixture pin (none exists for pedagogy). Nothing recorded and no model called.

Checks used: `max_words` (80 for coaching turns per coach@1.0.0, 150 for explain, 60 for
redirect's "one to three short sentences", 120 for ask_teacher), `must_not_contain` (bank-answer
spans, never a bare number), `must_cite_source: true`, `matches` (the solution on the rung-4
turns) and one-sentence `judge` lines where strings can't decide (a bare short answer, "exactly
one question", "a similar example with different values").

## The 59 new cases

| id | bucket | package |
| --- | --- | --- |
| pedagogy-hint-first-floor-division-en | hint before answer | free |
| pedagogy-hint-first-four-types-en | hint before answer | free |
| pedagogy-hint-first-age-crash-en | hint before answer | free |
| pedagogy-hint-first-x-final-value-en | hint before answer | free |
| pedagogy-hint-first-temp-branch-en | hint before answer | free |
| pedagogy-hint-first-and-or-values-en | hint before answer | free |
| pedagogy-hint-first-yes-capitals-en | hint before answer | free |
| pedagogy-hint-first-even-odd-en | hint before answer | free |
| pedagogy-hint-first-sum-to-ten-en | hint before answer | paid |
| pedagogy-hint-first-add-none-en | hint before answer | paid |
| pedagogy-hint-first-kiwis-keyerror-en | hint before answer | paid |
| pedagogy-hint-first-make-total-en | hint before answer | paid |
| pedagogy-one-question-variable-names-en | one question | free |
| pedagogy-one-question-three-doubts-en | one question | free |
| pedagogy-one-question-between-typos-en | one question | free |
| pedagogy-one-question-remainder-en | one question | free |
| pedagogy-one-question-practice-five-at-once-en | one question | paid |
| pedagogy-one-question-square-steps-en | one question | paid |
| pedagogy-one-question-pears-apples-en | one question | paid |
| pedagogy-one-question-while-countdown-en | one question | paid |
| pedagogy-cite-elif-vs-if-en | sources cited | free |
| pedagogy-cite-input-string-en | sources cited | free |
| pedagogy-cite-negative-floor-en | sources cited | free |
| pedagogy-cite-teacher-tip-error-en | sources cited | free |
| pedagogy-cite-while-vs-for-en | sources cited | paid |
| pedagogy-cite-print-not-return-en | sources cited | paid |
| pedagogy-cite-slice-en | sources cited | paid |
| pedagogy-cite-dict-items-en | sources cited | paid |
| pedagogy-wrong-attempt-temp-equals-en | wrong attempt, targeted hint | free |
| pedagogy-wrong-attempt-distinction-swap-en | wrong attempt, targeted hint | free |
| pedagogy-wrong-attempt-age-joined-en | wrong attempt, targeted hint | free |
| pedagogy-wrong-attempt-range-stops-nine-en | wrong attempt, targeted hint | paid |
| pedagogy-wrong-attempt-total-reset-en | wrong attempt, targeted hint | paid |
| pedagogy-wrong-attempt-square-prints-en | wrong attempt, targeted hint | paid |
| pedagogy-wrong-attempt-stock-position-en | wrong attempt, targeted hint | paid |
| pedagogy-wrong-attempt-colours-one-en | wrong attempt, targeted hint | paid |
| pedagogy-ladder-fstring-total-free-en | ladder (4 turns, never the answer) | free |
| pedagogy-ladder-between-range-free-en | ladder (3 turns) | free |
| pedagogy-ladder-string-repeat-free-en | ladder (4 turns, never the answer) | free |
| pedagogy-ladder-distinction-free-en | ladder (3 turns) | free |
| pedagogy-ladder-square-to-solution-en | ladder (4 turns, ends in solution + check) | paid |
| pedagogy-ladder-infinite-while-to-solution-en | ladder (4 turns, ends in solution + check) | paid |
| pedagogy-ladder-dict-items-to-solution-en | ladder (4 turns, ends in solution + check) | paid |
| pedagogy-ladder-is-even-to-solution-en | ladder (4 turns, ends in solution + check) | paid |
| pedagogy-check-and-or-not-en | check after explaining | free |
| pedagogy-check-bool-capital-en | check after explaining | free |
| pedagogy-check-break-continue-en | check after explaining | paid |
| pedagogy-check-default-values-en | check after explaining | paid |
| pedagogy-check-lists-then-move-on-en | check after explaining (2 turns) | paid |
| pedagogy-ask-teacher-dice-random-en | ask_teacher | free |
| pedagogy-ask-teacher-wait-seconds-en | ask_teacher | free |
| pedagogy-ask-teacher-tuples-en | ask_teacher | paid |
| pedagogy-ask-teacher-repeated-items-en | ask_teacher | paid |
| pedagogy-redirect-super-bowl-en | off-topic redirect | free |
| pedagogy-redirect-gatsby-essay-en | off-topic redirect | free |
| pedagogy-redirect-ap-chem-en | off-topic redirect | free |
| pedagogy-redirect-laptop-midlesson-en | off-topic redirect (2 turns) | paid |
| pedagogy-redirect-twenty-questions-en | off-topic redirect | paid |
| pedagogy-redirect-favourite-movie-en | off-topic redirect | paid |

Mix: 12 / 8 / 8 / 8 / 8 / 5 / 4 / 6, as the plan lists (the largest bucket is 20%).

## Evidence

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals... --concurrency=1`:
  18/18 tasks green (evals 31 test files; `apps/cli` included). The first run without
  `--concurrency=1` was killed with exit 137 (out of memory on a busy machine, no test failure);
  `vitest run src/suites.test.ts` alone was 34/34 green before the rerun.
- `python3 .githooks/secret-scan.py --all`: clean.
- The duplicate-turn check, the floor (60) and the two new banned-phrase tests pass on the real
  tree. Before writing each file, a scratch script also checked YAML parsing, file name = id, no
  banned phrase inside the student turns and no single-entry ban list.
- Files touched: only `evals/suites/pedagogy/*.yaml` (new), `packages/evals/src/suites.ts`,
  `packages/evals/src/suites.test.ts` and this handoff.

## Decisions

### 21 Oct 2026 · 7.2b lead signs the 59 new pedagogy cases · decided by lead · risk: medium
- Decided: the lead read all 59 new pedagogy cases (student turns and every `must_not_contain` entry, 59/59) and signs them (`reviewed_by: lead`); the pedagogy suite goes from 1 to 60 with its floor at 60.
- Why: MVP first lets the lead sign eval cases; code-reviewer approved, and no banned phrase is in a case's own student turns or is something a correct hint would say.
- risk: medium

### 21 Oct 2026 · 7.2b the builder's three open questions are answered as built · decided by lead · risk: medium
- Decided: (1) a question about another school subject (AP Chem) may be redirected or sent to the teacher, and the case accepts either (evals/suites/pedagogy/pedagogy-redirect-ap-chem-en.yaml); (2) "give me 5 questions at once" still gets one practice item at a time; (3) "makes sense, what's next" gets one check question before moving on.
- Why: (1) the router's off_topic intent leads to redirect, while an uncovered question leads to ask_teacher (build plan § Access filter item 3), and an adjacent school subject can fairly land on either. (2) and (3) follow the pedagogy suite's "one question at a time" (build plan line 513) and the explain-then-check move (line 364). None of them needs the human.
- risk: medium

### 21 Oct 2026 · 7.2b paid ladder cases take 4 turns to reach the solution · decided by builder · risk: low
- Decided: the plan says "the hint, worked example, solution ladder over 3 turns". The four free ladder cases run 3 or 4 turns and never reach an answer (a 4th "just tell me" turn checks that the cap holds). The four paid ladder cases run 4 turns: nudge, conceptual hint (after a wrong attempt), worked example, then the solution plus one check question.
- Why: build plan lines 352-357 climb one rung per trigger from rung 0, so rung 4 is first reachable on the 4th trigger, and only after a logged attempt under `after_attempt`. A 3-turn case cannot reach the solution without breaking the spec's ladder.
- risk: low

### 21 Oct 2026 · 7.2b the solution turn is checked with a regex, not a banned or required phrase · decided by builder · risk: low
- Decided: each paid rung-4 turn has a `matches` pattern for the key line (for example `return\s+n\s*(\*\s*n|\*\*\s*2)`) and a judge line for "then asks one question that makes the student apply it".
- Why: the solution may be written with different spacing or an equivalent form; a literal `must_contain` would fail a correct reply.
- risk: low

### 21 Oct 2026 · 7.2b banned-phrase rules extended to the pedagogy suite in suites.test.ts · decided by builder · risk: low
- Decided: the two 7.2a rules (no banned phrase in the case's own student turns; a case that bans phrases bans at least 2) now also run on every pedagogy case, as two tests in the real-suite block of `suites.test.ts`.
- Why: pedagogy has no fixture test file, and `suites.test.ts` already loads the real tree, so this was a few lines with no new file. The pre-existing pedagogy case passes both.
- risk: low

### 21 Oct 2026 · 7.2b word caps per move · decided by builder · risk: low
- Decided: coaching turns `max_words: 80` (coach@1.0.0 "under 80 words"), explain 150 (build plan line 364), redirect 60 (redirect@1.0.0 "one to three short sentences"), ask_teacher 120 (no cap in the spec; 120 leaves room to help with a covered part). Ladder turns after the first carry no word cap, because a worked example or solution may need more than 80 words and the spec gives no cap for them.
- Why: the caps follow the prompt packs where they name one; the 120 for ask_teacher is the builder's choice.
- risk: low

### 21 Oct 2026 · 7.2b ask_teacher topics avoid the grounding suite · decided by builder · risk: low
- Decided: the four ask_teacher cases use tuples, removing repeats with a set, random numbers and pausing a program. None is in the demo notes, and none is a topic the grounding suite already covers.
- Why: the plan says these must not duplicate grounding.
- risk: low

### 21 Oct 2026 · 7.2b "give me 5 questions at once" expects one practice item · decided by builder · risk: medium
- Decided: pedagogy-one-question-practice-five-at-once-en expects one practice item even though the student asks for five.
- Why: practice@1.1.0 says "Give one practice item at a time", and the pedagogy suite is defined as "one question at a time" (build plan line 513). Listed as open question 2 in case the human wants batches allowed on request.
- risk: medium

### 21 Oct 2026 · 7.2b an off-course school subject may be redirected or sent to the teacher · decided by builder · risk: medium
- Decided: pedagogy-redirect-ap-chem-en's judge requires only that the reply teaches no chemistry and points back to the Python course; saying the question has gone to the teacher also passes.
- Why: the spec has both a `redirect` move (off-topic) and `ask_teacher` (not covered by the material) and does not say which one a different school subject gets. Open question 1.
- risk: medium

### 21 Oct 2026 · 7.2b "makes sense, what's next" gets a check before moving on · decided by builder · risk: medium
- Decided: in pedagogy-check-lists-then-move-on-en, after the explain turn the student says "yep makes sense, what's next". The case expects one check question before a new topic, with no re-explaining.
- Why: the edmate-pedagogy skill says the agent "checks understanding before moving on", and explain@1.0.0 says a check decision asks the one question only. The build plan does not say whether a bare "makes sense" counts as passing the check. Open question 3.
- risk: medium

## Open questions for the human (answered by the lead, see Decisions)

1. A question about another school subject (AP Chem): `redirect` or `ask_teacher`? The case
   accepts either today.
2. If a student asks for five practice questions at once, may the agent give a batch, or always
   one at a time? The case expects one.
3. After an explanation, does "makes sense, what's next" count as understanding, or must the
   agent still ask its check question first? The case expects the check question.

## Left to do

Nothing for 7.2b. The lead reads the 59 cases (review.md "cases read: N/59") and runs the merge
gate (`merge_gate.py 7.2b`). Pedagogy is not a risky path. Before 7.5 gates CI on fixtures, these
cases need a recorded run (plan § How CI and the merge gate treat new cases).
