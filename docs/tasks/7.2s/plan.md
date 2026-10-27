# Plan: 7.2s — pedagogy suite 60 to 150 (7.2 Phases J and K)

Status: READY (written by the lead, 27 Oct 2026)

## Why now
B-41 (human, 22 Oct 2026): the remaining eval cases land before the pilot gate. 7.2f (locked to 200) is done; this is the next suite group from the old 7.2f split. 7.2t (leak) and 7.2u (safety, persona, advice) follow.

## Shared plan
`docs/tasks/7.2/plan.md` stays the plan of record. Read its "Pinned counts", "How CI and the merge gate treat new cases with no recorded fixture", Phase C (the pedagogy mix), "Phases H-P", "Tests first", "Risks" and "Lead answers". Also read `docs/tasks/7.2b/handoff.md` (how Phase C built the pedagogy cases) and the 7.2f lessons below.

## Phases
Each phase is a fresh builder on the same branch; Phase K starts from Phase J's handoff section. The lead runs code-reviewer after each phase.

### Phase J: pedagogy +45 (60 to 105); about 95 calls
Phase C's categories, new forms only (no case may repeat an existing student turn or the same trick reworded), across the demo teacher's modules, `free` and `paid` both:
- hints before answers, the first turn's `must_not_contain` is the bank answer (9)
- one question at a time (`max_words` plus a judge line) (6)
- sources cited (`must_cite_source: true`) (6)
- a wrong attempt gets a targeted hint, not the fix (6)
- the hint, worked example, solution ladder over 3 turns (6)
- checking understanding after an explanation (4)
- an uncovered question goes to `ask_teacher` (3)
- an off-topic redirect back to the lesson (5)
Then `SUITE_FLOORS.pedagogy` at 105. List the forms used in the handoff so Phase K can avoid them.

### Phase K: pedagogy +45 (105 to 150); about 95 calls
The same mix sizes with forms Phase J did not use. Then `SUITE_FLOORS.pedagogy` at 150.

## Rules for every case (7.2f lessons)
- English only, US-framed. No `-hi-latin` or `-deva` files at all; the count of those in evals/suites/pedagogy must not change.
- `reviewed_by: lead`, with the `source:` line the existing pedagogy cases use.
- A `must_not_contain` phrase never repeats the student's own words, and is an exact substring of the bank answer or content it guards.
- Before writing, list the existing student turns (`grep`) and the trick each covers; don't add a fourth phrasing of a trick already covered three times.
- No real personal data or names of real schools or people. No real model calls.

## Files
Create: `evals/suites/pedagogy/*.yaml` (new cases only).
Modify: `packages/evals/src/suites.ts` and `packages/evals/src/suites.test.ts` (the pedagogy floor only).
Plus `docs/tasks/7.2s/handoff.md`.
Out of bounds: every other suite, `packages/harness`, `packages/contracts`, prompt packs and locales.

## Risky paths touched
None (evals/suites/pedagogy is not a risk path). Reviewer: code-reviewer.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals`
- `corepack pnpm exec prettier --check` on the changed .ts files
- `python3 .githooks/secret-scan.py --all`

## Budget
Budget: 190 tool calls (Phase J 95, Phase K 95). One fix round, capped at 30.
