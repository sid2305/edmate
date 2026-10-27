# Handoff: 7.2t

Status: PARTIAL

## Summary

Phase L of the leak count ratchet: grew `evals/suites/leak/` from 80 to 115 cases
(+35), reusing the 9 social-engineering forms (`yesno`, `mcq`, `unittest`,
`stepbystep`, `pressure`, `authority`, `spelled`, `reversed`, `partialreveal`)
already implemented in `variantsFor()` in `packages/evals/src/leakFixtures.test.ts`.
Phase M (115 to 150) is not started; that is the remaining work for this task.

TDD: raised `SUITE_FLOORS.leak` (`packages/evals/src/suites.ts`) and the two
pinned-count assertions in `packages/evals/src/suites.test.ts` and
`packages/evals/src/leakFixtures.test.ts` to 115 first, confirmed red
(`AssertionError: expected 115 to be 80` / `expected { leak: 115, ... } to
equal { leak: 80, ... }`), then added the 35 case files until the gate was
green.

Of the 37 question-bank items across `conditions`, `values-variables`,
`loops`, `functions` and `lists-dicts`, 35 already had `KEYS`/`HINTS` entries
in `leakFixtures.test.ts` from Phase D (7.2c). Used exactly those 35, one
bank item per form (a clean 1:1 mapping across the 9 forms at the counts the
plan calls for: yesno 5, mcq 4, unittest 4, stepbystep 4, pressure 5,
authority 4, spelled 2, reversed 2, partialreveal 5 = 35). `fn-q3`
("parameter vs argument") and `lo-q7` ("while vs for") have no `KEYS`/`HINTS`
entry and were left unused for a later phase (see Decisions).

Phase L forms used (bank item -> form), so Phase M can avoid repeating a
(item, form) pair:
`co-q1`/yesno, `vv-q1`/yesno, `lo-q1`/yesno, `fn-q4`/yesno, `ld-q4`/yesno,
`co-q2`/mcq, `vv-q2`/mcq, `lo-q2`/mcq, `fn-q5`/mcq,
`co-q3`/unittest, `vv-q3`/unittest, `lo-q3`/unittest, `fn-q6`/unittest,
`co-q4`/stepbystep, `vv-q4`/stepbystep, `lo-q4`/stepbystep, `fn-q7`/stepbystep,
`co-q5`/pressure, `vv-q5`/pressure, `lo-q5`/pressure, `ld-q1`/pressure, `ld-q5`/pressure,
`co-q6`/authority, `vv-q6`/authority, `lo-q6`/authority, `ld-q6`/authority,
`vv-q7`/spelled, `ld-q2`/spelled,
`fn-q1`/reversed, `ld-q7`/reversed,
`co-q7`/partialreveal, `vv-q8`/partialreveal, `fn-q2`/partialreveal,
`ld-q3`/partialreveal, `ld-q8`/partialreveal.

No cases were parked to `docs/tasks/7.2/pending-cases/leak/` — all 35 slots
landed cleanly with no guard gap found.

Bare do-not-say key skipped in `must_not_contain` (kept the phrased-template
entries only), each because the bare key is already a substring of the
case's own student turns or an unrelated part of the bank answer, following
the 7.2c precedent:
- `leak-mcq-branch-choice-en` (co-q2): bare key `Warm` is the branch word the
  student's own code already prints.
- `leak-mcq-sum-loop-en` (lo-q2): bare key `55` is also one of the student's
  own MCQ options.
- `leak-mcq-name-error-en` (fn-q5): bare key `return total` is also one of
  the student's own MCQ options.
- `leak-authority-hi-count-en` (lo-q6): bare key `3` already appears in the
  student's own `range(3)` code.

Used the full key (`4 + 8 + 15 = 27`, not the truncated `27`) in
`leak-partialreveal-list-sum-total-en` (ld-q8), matching the fix-round-2
lesson in `docs/tasks/7.2c/handoff.md` (a truncated `27` collides with an
unrelated "3 27" lead-in elsewhere in the bank answer's full text).

Whole-suite check (script, run against all 115 files under
`evals/suites/leak/`):
- No single student turn (NFKC-normalised, case-insensitive, punctuation
  stripped) repeats across the corpus, beyond 4 pre-existing duplicate
  groups from before Phase L (all among the original 80 cases, out of
  scope for this phase; none involve a file added in this phase).
- No `must_not_contain` phrase is a substring of its own case's student
  turns: 0 found.
- No case has fewer than 2 banned phrases: 0 found.
- Total files under `evals/suites/leak/`: 115.

## Decisions

### 27 Oct 2026 · 7.2t leave fn-q3 and lo-q7 unused this phase · decided by builder · risk: low
- Decided: Phase L reuses only the 35 bank items that already had `KEYS`/`HINTS` entries in `leakFixtures.test.ts`; `fn-q3` ("parameter vs argument") and `lo-q7` ("while vs for") are left for a later phase rather than adding new `KEYS`/`HINTS` entries now.
- Why: this gives a clean 1:1 mapping of bank item to form at the exact counts the plan calls for (35 cases over 9 forms), with no new fixture plumbing; Phase M's +35 can pick these two up alongside new wordings of the already-used items.

### 27 Oct 2026 · 7.2t vary pressure/authority framings beyond the deadline pattern · decided by builder · risk: low
- Decided: the 5 new `pressure` cases and 4 new `authority` cases use varied angles (scholarship fear, falling behind peers, losing phone privileges, an older sibling TA, a school counselor, a family friend who teaches CS elsewhere, a stepdad who used to teach programming) instead of repeating the "deadline in N minutes" framing already used 5 times in the original 80 cases.
- Why: the brief requires no trick get a fourth rewording; reusing the same emotional lever a sixth time would have made the new cases weaker tests of the guard than a fresh angle.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals`: green. 31 test files passed, 1623 tests passed (0 failed). `src/leakFixtures.test.ts` passed explicitly (233 tests). `src/suites.test.ts` passed explicitly (36 tests).
- `corepack pnpm exec prettier --check` on the 3 changed .ts files: 1 pre-existing formatting issue in `leakFixtures.test.ts` (long lines from Phase D, unrelated to this phase's additions) fixed with `--write`; re-ran `--check`: clean. Re-ran `vitest run src/leakFixtures.test.ts src/suites.test.ts` after the format fix: still 269/269 passing.
- `python3 .githooks/secret-scan.py --all`: clean, no findings.

## Budget

Tool calls used: ~98 (across the full Phase L build, including the prior context now summarized).
