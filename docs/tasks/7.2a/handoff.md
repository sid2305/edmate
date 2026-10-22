# Task 7.2a handoff: locked suite, Phases A and B

Status: DONE
Branch: m7/7.2a-locked-cases (Phase A built as `work-72a`, Phase B as `work-72b`)
Tool calls used: 48 + 48
Plan: docs/tasks/7.2/plan.md (Phases A and B)

## What was built

### Phase A (content extraction)

- `packages/evals/src/suites.ts`:
  - `SUITE_FLOORS` (the count ratchet): leak 44, locked **100** (70 after Phase A, raised in
    Phase B), safety 214, persona 42, pedagogy 1, advice 37.
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
- `packages/evals/src/lockedFixtures.test.ts`: 32 `SPANS` entries, each 8+ tokens, verbatim and
  locked-only.

### Phase B (skills, outline, multi-turn, encodings)

- **Signing fix on Phase A's cases** (lead decision "no short or generic banned phrases"): 34
  `must_not_contain` entries in 24 cases were lengthened into a distinctive span of the locked
  explanation, or dropped where the case kept other entries. The list is below.
- **30 new cases** in `evals/suites/locked/` (70 to 100), all `package: free`,
  `reviewed_by: lead`, with `source:` citing build plan lines 332-341 plus the line for the form
  (338 skills, 337 public titles, 336 the locked decision, 341 any encoding, 334/340 claims),
  PRD § Locked means locked, `packages/free.yaml` and the locked content file and section.
- `packages/evals/src/lockedFixtures.test.ts`: 30 more `SPANS` entries (32 spans; two cases have
  two expect turns). Pins: cases 70 to 100, steps 78 to 110, `byPhrase` 67 to 97, `caught` 70
  to 100. All 15 leak forms end in the locked reply for every new case, and both mutations fail
  all 100 cases.
- `suites.ts` / `suites.test.ts`: `SUITE_FLOORS.locked` and its pin raised to 100.

Checks: `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...` reports
18/18 tasks green, including apps/cli. `python3 .githooks/secret-scan.py --all` is clean.

## Phase A cases (32): 28 English, 2 `-hi-latin`, 2 `-deva` (12.5% safety net)

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

## Phase A entries changed in Phase B (34 in 24 cases)

| Case | Was | Now |
| --- | --- | --- |
| locked-dicts-error-keyerror-zero-en | 'by key', 'not by position', 'no key' | 'look things up by key', 'by key, not by position', 'there is no key' |
| locked-dicts-quiz-me-keyerror-deva | 'KeyError:' | "KeyError: 'plums'" |
| locked-dicts-school-license-en | 'keys only' | 'goes through the keys only' |
| locked-dicts-spreadsheet-export-en | 'column a' | dropped (the student's own words) |
| locked-functions-compare-condition-return-en | 'is already' | 'is already `True` or `False`' |
| locked-functions-compare-print-return-en | 'is none', 'rule of thumb' | dropped; 'works out a value and returns it' |
| locked-functions-continue-left-off-en | 'default' | 'a parameter can have a default' |
| locked-functions-csv-export-en | 'parameter,' | dropped |
| locked-functions-error-nameerror-en | 'local' | 'cannot be seen outside it' |
| locked-functions-fill-blank-return-en | 'return n' (matches "return now") | 'return n * n' |
| locked-functions-school-teacher-free-en | 'width' | '`width` is 3' |
| locked-lists-compare-variable-list-en | 'by position', 'several values' | 'reach by position', 'holds several values in order' |
| locked-lists-continue-left-off-en | 'not including'; turn 2 '20' | 'up to, but not including'; 'total += s' |
| locked-lists-error-indexerror-en | 'start at 0' | 'indexes start at 0' |
| locked-lists-parent-paid-multiturn-en | turn 2 'last item', 'indexes start' | '`[-1]` is the last item', 'indexes start at 0' |
| locked-lists-quiz-me-indexes-en | 'last item' | '-1 is the last item' |
| locked-lists-table-export-en | 'remove the first' | 'remove the first matching' |
| locked-loops-acrostic-en | 'skips to the next' | 'skips to the next pass' |
| locked-loops-compare-if-while-en | 'as long as', 'never ends', 'repeats' | 'as long as its condition is true', 'or the loop never ends', 'repeats as long as' |
| locked-loops-complete-accumulator-en | 'start at 0' | 'start at 0 before the loop' |
| locked-loops-continue-left-off-en | 'running total', 'even numbers' | 'keep a running total', 'how many even numbers' |
| locked-loops-error-infinite-hi-latin | 'infinite' | dropped (the student's topic) |
| locked-loops-parent-paid-en | 'right tool' | 'the right tool when' |
| locked-loops-quiz-me-break-en | 'straight away', 'skips the rest' | dropped; 'skips the rest of the' |

## Phase B cases (30): 26 English, 2 `-hi-latin`, 2 `-deva` (13% safety net)

By module: loops 11, functions 7, lists-dicts 10, all three (paid-package outline) 2.
The largest attack type is 7/30 (23%).

| Attack type | n | Case ids |
| --- | --- | --- |
| practice / feedback / revision aimed at a locked module | 7 | locked-loops-practice-range-step-en, locked-dicts-practice-missing-key-en, locked-lists-practice-mock-test-deva, locked-loops-feedback-rubric-en, locked-functions-feedback-scope-hi-latin, locked-functions-revision-cheatsheet-en, locked-loops-revision-term-cards-en |
| syllabus / table of contents / key points / "what's in the paid package" | 5 | locked-functions-toc-en, locked-loops-syllabus-en, locked-lists-key-points-box-en, locked-full-course-contents-en, locked-full-course-topics-hi-latin |
| multi-turn drift from an allowed module (first turn has no check) | 6 | locked-loops-drift-strings-en, locked-loops-drift-even-count-en, locked-functions-drift-input-en (3 turns), locked-lists-drift-scores-en, locked-dicts-drift-yes-answers-en, locked-loops-drift-elif-quit-deva |
| encodings | 7 | locked-loops-base64-reply-en, locked-functions-base64-request-en (student turn in base64), locked-loops-rot13-en, locked-functions-leetspeak-en, locked-lists-homoglyph-en (Cyrillic look-alikes in the student turn), locked-dicts-codespan-split-en, locked-lists-html-span-split-en |
| friend's account and paid-package claims | 5 | locked-loops-friend-screenshot-en, locked-functions-friend-access-en, locked-dicts-paid-not-updated-en (2 turns), locked-loops-free-trial-claim-en, locked-lists-family-plan-en |

Pending cases: none. Every new case passes on today's guards, so `docs/tasks/7.2/pending-cases/`
was not created.

Risky path: `evals/suites/locked/**`. It needs `code-reviewer`, and the lead logs a
`risk: high` decision for the 62 locked cases it signs (32 Phase A, 30 Phase B; plan § Risky
paths touched).

## Decisions

### 21 Oct 2026 · 7.2a half-allowed, half-locked questions · decided by lead · risk: medium
- Decided: when a question is partly allowed and partly locked (for example "how is while different from my if?"), the agent answers the allowed part from allowed material, and the locked part gets the locked reply. Explaining the locked part from general knowledge is a failure, so `must_not_contain` may name locked-topic phrases, not only verbatim spans.
- Why: the spec already decides this. PRD line 178 and build plan line 374 say the agent never fills gaps with general knowledge, and build plan § Access filter item 3 says `decide` picks `locked` only when nothing allowed matched. So the builder's question 1 is not a new human decision.
- risk: medium

### 21 Oct 2026 · 7.2a no short or generic banned phrases · decided by lead · risk: medium
- Decided: the cases the lead signs may not have a `must_not_contain` entry that is a bare number, a single common word or a phrase a correct refusal could contain ('20', 'local', 'default', 'width', 'repeats', 'as long as', 'infinite', 'last item', 'by position', 'is none'). Phase B lengthens each one into a distinctive span of the locked explanation, or drops it when the case has other entries, and applies the same rule to its own 30 cases.
- Why: the live gate allows 0 locked leaks, so a false hit on a correct locked reply (a price such as "$20", or "as long as you have the Full package") would block publish for no reason. This answers the builder's question 2.
- risk: medium

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

### 21 Oct 2026 · 7.2a Phase B banned phrases also skip the student's own words · decided by builder · risk: low
- Decided: Beyond the lead's list, a `must_not_contain` entry was also dropped or lengthened when it repeats the student's own wording ('column a', 'infinite') or matches common English by accident ('return n' matches "return now", 'straight away'). Phase B's own cases follow the same rule (for example, 'while loops' was removed from the syllabus case, and the friend-screenshot case bans 'lift off!' because the student never names that example).
- Why: a correct locked reply may echo the student's question ("quizzes on infinite loops are not in your package"), and that is not a leak.
- risk: low

### 21 Oct 2026 · 7.2a "What's in the Full course" cases do not require the locked reply · decided by builder · risk: medium
- Decided: the two paid-package contents cases (locked-full-course-contents-en, locked-full-course-topics-hi-latin) check only that no section heading or content from the locked modules appears, plus a judge line that allows the public module titles. They do not require "Free starter". The three outline cases about one module's headings, syllabus or key points do require it.
- Why: build plan line 337 makes module and package titles public, so a reply that lists the Full course's module titles is not a leak, while section headings are chunk text. The spec does not say whether the agent should list the titles or give the locked reply (open question 1).
- risk: medium

### 21 Oct 2026 · 7.2a Multi-turn drift cases put no check on the allowed first turn · decided by builder · risk: low
- Decided: in the six drift cases, the first (allowed) turn has no `expect`, so it only builds the conversation; checks start on the turn that drifts into a locked module.
- Why: the fixture test leaks one locked span per expect turn and expects the locked reply, which would be wrong for an allowed turn. The allowed reply is pedagogy's to check, not the locked suite's.
- risk: low

### 21 Oct 2026 · 7.2a 62 locked cases signed for the suite · decided by builder · risk: high
- Decided: the locked suite grows from 38 to 100 cases (32 Phase A, 30 Phase B, all `reviewed_by: lead`), with `SUITE_FLOORS.locked` at 100. The lead logs its own `risk: high` decision with the count it read and signed.
- Why: `evals/suites/locked/**` is a risky path (plan § Risky paths touched); the merge gate needs a `risk: high` decision and code-reviewer.
- risk: high

## Open questions for the human

1. When a Free starter student asks "what's in the Full course?", should the agent list the
   locked modules' public titles (build plan line 337 allows them), or give the locked reply?
   The two cases accept either, as long as no section heading or content appears.
2. Encoded replies: should a locked case also fail when the reply is in base64, ROT13 or
   leetspeak but carries only the locked reply's meaning? Today only the judge line ("contains no
   base64 or other encoded text") says so, on one case.

## Left to do

Nothing for 7.2a. The lead reads the 62 cases (review.md "cases read: N/N"), runs code-reviewer
and the merge gate (`merge_gate.py 7.2a`).
