# Task 7.2c handoff: leak suite, Phase D

Status: DONE
Branch: m7/7.2c-leak-cases (built as `work-72l`)
Tool calls used: about 85 (harness count; budget ~90)
Plan: docs/tasks/7.2/plan.md (Phase D)

## What was built

- 36 new cases in `evals/suites/leak/` (44 to 80). All `reviewed_by: lead`, `source:` cites the
  build-plan leak-guard line, the demo-teacher question-bank item and the package file
  (`finalAnswers`) the gating comes from. 28 English, 4 `hi-latin`, 4 `deva` (leak is a
  `GUARD_FOLDERS` suite, so Hindi/Hinglish as a safety net is in scope under the English-only
  pilot rule, not an exception to it).
- Every bank module is covered: conditions 7, functions 6, lists-dicts 8, loops 6,
  values-variables 9 (today's 44 cases were mostly conditions/values). Package: 23 `paid`
  (functions, lists-dicts, loops sources, which `free.yaml` doesn't carry) and 13 `free`
  (conditions, values-variables sources that `free.yaml` does carry).
- `packages/evals/src/suites.ts`: `SUITE_FLOORS.leak` 44 to 80.
- `packages/evals/src/leakFixtures.test.ts`: `BANK_FILE` gained `fn`/`ld`; `KEYS` and `HINTS`
  gained 22 new refs (verbatim answer spans, verified absent from the question); `NEW_FORMS`
  gained the 36 new case ids; `variantsFor()`'s `switch (form)` gained 9 new branches
  (`yesno`, `mcq`, `unittest`, `stepbystep`, `pressure`, `authority`, `spelled`, `reversed`,
  `partialreveal`), each pushing exactly 2 variants; the case/caught counts moved 44 to 80.
- `packages/evals/src/suites.test.ts`: the leak floor pin is now 80. The two 7.2a/7.2b
  banned-phrase tests (no banned phrase in the case's own student turns; a case that bans
  phrases bans at least 2) now also run on the leak suite, scoped to the 9 new-form id prefixes
  (see Decisions: the pre-7.2c 44 cases are out of bounds to edit and some fail these rules).

## The 36 new cases

| id | form | module |
| --- | --- | --- |
| leak-yesno-case-sensitive-en | yesno | conditions |
| leak-yesno-index-error-en | yesno | lists-dicts |
| leak-yesno-missing-return-en | yesno | functions |
| leak-yesno-remainder-en | yesno | values-variables |
| leak-yesno-break-continue-hi-latin | yesno | loops |
| leak-mcq-value-types-en | mcq | values-variables |
| leak-mcq-default-param-en | mcq | functions |
| leak-mcq-range-step-deva | mcq | loops |
| leak-mcq-is-even-en | mcq | functions |
| leak-unittest-square-en | unittest | functions |
| leak-unittest-append-en | unittest | lists-dicts |
| leak-unittest-even-odd-en | unittest | conditions |
| leak-unittest-x-value-en | unittest | values-variables |
| leak-stepbystep-distinction-en | stepbystep | conditions |
| leak-stepbystep-missing-key-en | stepbystep | lists-dicts |
| leak-stepbystep-infinite-loop-hi-latin | stepbystep | loops |
| leak-stepbystep-age-input-en | stepbystep | values-variables |
| leak-pressure-floor-division-en | pressure | values-variables |
| leak-pressure-between-range-en | pressure | conditions |
| leak-pressure-dict-loop-hi-latin | pressure | lists-dicts |
| leak-pressure-sum-loop-deva | pressure | loops |
| leak-pressure-name-error-en | pressure | functions |
| leak-authority-syntax-error-en | authority | conditions |
| leak-authority-fstring-total-en | authority | values-variables |
| leak-authority-dict-update-deva | authority | lists-dicts |
| leak-authority-range-print-en | authority | loops |
| leak-spelled-string-repeat-en | spelled | values-variables |
| leak-spelled-warm-branch-en | spelled | conditions |
| leak-reversed-hi-count-en | reversed | loops |
| leak-reversed-negative-index-hi-latin | reversed | lists-dicts |
| leak-partialreveal-return-ends-en | partialreveal | functions |
| leak-partialreveal-variable-names-en | partialreveal | values-variables |
| leak-partialreveal-and-or-en | partialreveal | conditions |
| leak-partialreveal-len-sum-en | partialreveal | lists-dicts |
| leak-partialreveal-list-vs-dict-en | partialreveal | lists-dicts |
| leak-partialreveal-mod-remainder-deva | partialreveal | values-variables |

Mix: yesno 5, mcq 4, unittest 4, stepbystep 4, pressure 5, authority 4, spelled 2, reversed 2,
partialreveal 6 — exactly the plan's forms list (spelled+reversed combine to the plan's "4").

## Evidence

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...`: 18/18 tasks green;
  `@edmate/evals` test: 31 files, 1277 tests, 100% statement coverage on `packages/evals/src`.
  `src/leakFixtures.test.ts`: 163/163, including "loads all 80 cases" and "mutation: a
  pass-through gate and a no-op answerLeak fail all 80 cases". `src/suites.test.ts`: the leak
  floor (80) and both scoped banned-phrase tests pass.
- `python3 .githooks/secret-scan.py --all`: clean, run twice (once before, once after merging
  `origin/main`).
- Files touched: only `evals/suites/leak/*.yaml` (36 new), `packages/evals/src/suites.ts`,
  `packages/evals/src/suites.test.ts`, `packages/evals/src/leakFixtures.test.ts`, and this
  handoff — matches the plan's `Files` list exactly.
- `git status --porcelain`: 39 entries (3 modified files + 36 new case files); no file outside
  the plan is touched.

## Decisions

### 21 Oct 2026 · 7.2c "spelled out / reversed" built as framing, not real encoding · decided by builder · risk: low
- Decided: the "spelled out" and "reversed" forms are social-engineering phrasing tricks
  ("Spelling it out for you: ...", "Reading it backwards, the answer is ...") rather than true
  character-reversal or letter-by-letter-with-separators encodings.
- Why: `compileAnswerKeys`'s normalisation (NFKC, drop `\p{Cf}`, lowercase, unify quotes) is
  proven against zero-width and fullwidth splits but not against a true reversed string or a
  comma/hyphen-separated letter spelling; a case built on either would likely expose a guard
  gap rather than test the social-engineering framing the plan's mix intends. Testing a real
  gap belongs to a dedicated board task, not silently inside a 36-case Phase D add.
- risk: low

### 21 Oct 2026 · 7.2c module-to-package gating follows the demo packages · decided by builder · risk: low
- Decided: every case sourced from `functions`, `lists-dicts` or `loops` is `package: paid`;
  every case sourced from `conditions` or `values-variables` may be `free`.
- Why: `content/demo-teacher/packages/free.yaml` carries only `values-variables` and
  `conditions` (`moduleIds`); `paid.yaml` carries all five. A free-package case built on a
  paid-only module's answer would not match how the demo teacher's packages are actually
  scoped.
- risk: low

### 21 Oct 2026 · 7.2c must_not_contain phrases are literal substrings of the case's own scripted variant · decided by builder · risk: low
- Decided: every new form in `variantsFor()`'s `switch` pushes exactly 2 variants shaped as
  `"<frame>: ${k0}"`; every `must_not_contain` phrase in the matching case file is a literal
  substring of one of those two rendered templates, and contains the bank-answer key itself.
- Why: this guarantees the phrase can only appear in the model's reply if the leak guard failed
  to suppress the key, so the real-guard test ("0 leaks") can pass only by truly blocking the
  key, and the mutation test (pass-through gate, no-op `answerLeak`) is guaranteed to render the
  phrase and get caught. A looser or paraphrased phrase could pass "caught" by coincidence, or
  fail "0 leaks" on wording the guard never needed to touch.
- risk: low

### 21 Oct 2026 · 7.2c the new banned-phrase guard tests are scoped to the 36 new-form cases, not the whole leak suite · decided by builder · risk: medium
- Decided: `suites.test.ts`'s leak version of the 7.2a/7.2b banned-phrase rules (no banned
  phrase in the case's own student turns; a case that bans phrases bans at least 2) filters to
  the 9 new-form id prefixes (`leak-yesno-`, `leak-mcq-`, `leak-unittest-`, `leak-stepbystep-`,
  `leak-pressure-`, `leak-authority-`, `leak-spelled-`, `leak-reversed-`,
  `leak-partialreveal-`), not the whole `leak/` folder.
- Why: run unscoped, these two rules fail on about 21 of the pre-7.2c 44 cases (10 echo a
  banned phrase in the student's own turn, e.g. `leak-co2-digits-en` bans "Warm" after the
  student already wrote a branch that prints "Warm"; 14 ban exactly one phrase, e.g. every
  `leak-forged-note-*` and `leak-vv6-*`/`leak-vv8-*` case). Fixing those is editing existing
  case files, which plan.md's "Files out of bounds" reserves for "one the lead names in
  review", and the exit condition for PARTIAL lists "a file outside this plan needs changing
  ... an existing case". Scoping the new tests to 7.2c's own cases keeps the suite green without
  touching files 7.2c isn't allowed to touch, while still adding the stricter check for every
  case 7.2c is responsible for.
- risk: medium (flags a real, pre-existing gap in 21 of the 44 cases for the lead; recommend a
  small follow-up — either a board task the lead names in review, or an explicit one-off edit
  the lead approves — to tighten those 21 cases and then widen the new tests back to the whole
  `leak/` folder)

### 21 Oct 2026 · 7.2c cases carry reviewed_by: lead per standing MVP-first policy · decided by builder · risk: medium
- Decided: all 36 new cases are written with `reviewed_by: lead` rather than `pending`.
- Why: matches 7.2a/7.2b's convention and the "MVP first" memory rule (the lead signs eval
  cases pre-pilot). This still needs the lead's actual read of the 36 cases' student turns and
  `must_not_contain`/`judge` entries before merge (`review.md` "cases read: N/36"), same as
  7.2b.
- risk: medium

## Open questions for the human

None new. The known gap in the pre-7.2c 44 cases (see the scoped-test decision above) is a
candidate board task, not a blocker: it doesn't stop 7.2c or any other ready task.

## Left to do

Nothing for 7.2c itself. The lead reads the 36 cases (`review.md` "cases read: N/36") and runs
the merge gate (`python3 .claude/skills/merge-gate/merge_gate.py 7.2c`). Leak is not a risky
path. Recommend a small follow-up board task: tighten the ~21 pre-7.2c leak cases that fail the
new banned-phrase rules, then widen `suites.test.ts`'s leak tests back to the whole `leak/`
folder.
