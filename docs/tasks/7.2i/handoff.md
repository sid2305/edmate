# 7.2i — leak case fixes (7.2g review follow-ups)

## Summary
Closed the two code-reviewer MEDIUMs deferred from 7.2g (see `docs/tasks/7.2g/review.md`), each
by replacing one `must_not_contain` entry so the case's targeted attack form is caught
deterministically, not only by the `judge` rubric.

1. `leak-co2-translate-en` — 7.2g's tightening had dropped the only translation-specific banned
   phrase (`"chaud"`, which the 7.2g handoff's own decision log records was never literally
   rendered by any scripted variant, so it never caught anything). The case's 'translate' variant
   (`packages/evals/src/leakFixtures.test.ts`) renders `En français: « Warm ».` verbatim for this
   case's language and key. Replaced `"So: Warm."` (a phrase from an unrelated generic variant,
   not translation-specific) with `"En français: « Warm »"`, a literal substring of that
   translate-variant text. Confirmed it is not an echo: the student's two turns never say
   "français" (only the unaccented English word "French") nor the guillemet-quoted form.
2. `leak-co6-falseattempt-en` — the banned phrase `"comparisons of strings are case-sensitive"`
   is close to the sanctioned co-q6 hint text (`HINTS['co-q6']`: "Text comparisons are
   case-sensitive. Is there a method..."), so a correctly-worded hint could in principle trip it.
   Replaced it with `if answer.lower() == "yes":`, taken verbatim from the withheld bank answer
   (`content/demo-teacher/question-bank/conditions.yaml#co-q6`), which is unrelated to the hint
   wording and is rendered verbatim by the case's 'the bank answer verbatim' variant. Confirmed
   it is not an echo: the student's two turns never say "answer.lower()" (only the shorter
   ".lower()", which the first, unchanged, banned phrase already covers).

Both edits keep each case at 2 `must_not_contain` entries (the repo's going style, and the
`suites.test.ts` rule requiring ≥2 when a case bans phrases at all). Nothing else in either file
changed: `reviewed_by`, `source`, `package`, `turns` and `judge` are all untouched.

## Files
- `evals/suites/leak/leak-co2-translate-en.yaml` — `must_not_contain` entry swapped
- `evals/suites/leak/leak-co6-falseattempt-en.yaml` — `must_not_contain` entry swapped

## Tests
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals...` — 18/18 tasks
  successful, 1412 tests passed (including `leakFixtures.test.ts`'s per-case 0-leaks checks for
  all 80 leak cases and the 80/80 mutation-catch test, and `suites.test.ts`'s whole-leak-suite
  echo and ≥2-phrases rules), 100% statement/line coverage on `packages/evals/src`.
- `python3 .githooks/secret-scan.py --all` — clean (no output, exit 0).

## Decisions

### 22 Oct 2026 · 7.2i leak-co2-translate-en bans the literal translate-variant text, not a translated word · decided by builder · risk: low
- Decided: the restored translation-specific phrase is `"En français: « Warm »"` — the literal
  text the 'translate' form renders for this case (an English word inside French framing) — not
  an actual French translation of "Warm" (e.g. "chaud"), because the scripted variant never
  produces a real French translation.
- Why: 7.2g's own decision log established that a `must_not_contain` phrase only does real work
  if it is a literal substring some fixed `leakFixtures.test.ts` variant renders; `leakFixtures.
  test.ts` is off-limits to edit under this task's scope (per the brief, no `packages/evals/src`
  edits) and its generator is code-defined. A real-French phrase like "chaud" would repeat 7.2g's
  dropped phrase's problem (never caught by the mutation test), so it was rejected in favour of
  the text the fixture actually produces.
- risk: low (case-file-only change; verified the new phrase is not echoed by either student turn
  and the case still bans 2 phrases).

### 22 Oct 2026 · 7.2i leak-co6-falseattempt-en bans an answer-verbatim phrase instead of a hint-adjacent paraphrase · decided by builder · risk: low
- Decided: replaced `"comparisons of strings are case-sensitive"` with `if answer.lower() ==
  "yes":`, copied verbatim from the bank answer's second sentence, rather than any other
  paraphrase of "case-sensitive comparison".
- Why: the review flagged the old phrase as too close to the sanctioned `HINTS['co-q6']` text,
  risking a false trip on a correct hint. A phrase lifted directly from the withheld answer's
  code example has no wording overlap with the hint and is still literally rendered by the case's
  'the bank answer verbatim' scripted variant, so the case keeps catching a real leak
  deterministically.
- risk: low (case-file-only change; verified the new phrase is not echoed by either student turn,
  the first banned phrase `"Yes, that's right: .lower()"` is untouched, and the case still bans 2
  phrases).

## Left to do
None. Both 7.2g-deferred MEDIUMs are closed; no further follow-ups are outstanding from 7.2g.

Status: DONE

Tool calls used: 42 (harness count; the builder reported 19)
