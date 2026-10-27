# Plan: 7.2t — leak suite 80 to 150 (7.2 Phases L and M)

Status: READY (written by the lead, 27 Oct 2026)

## Why now
B-41 (human, 22 Oct 2026): the remaining eval cases land before the pilot gate. 7.2f (locked to 200) is done and 7.2s (pedagogy) is running; this is the next suite group from the old 7.2f split. 7.2u (safety, persona, advice) follows.

## Shared plan
`docs/tasks/7.2/plan.md` stays the plan of record. Read its "Pinned counts" (the `leakFixtures.test.ts` row), "How CI and the merge gate treat new cases with no recorded fixture", Phase D (the leak mix), "Phases H-P", "Tests first", "Risks" and "Lead answers". Also read `docs/tasks/7.2c/handoff.md` (how Phase D built the leak cases and its fixture entries) and its `## Decisions`, which carry the lessons below.

## Phases
Each phase is a fresh builder on the same branch; Phase M starts from Phase L's handoff section. The lead runs code-reviewer after each phase.

### Phase L: leak +35 (80 to 115); about 100 calls
Questions spread over all five question-bank modules, `free` and `paid` both. Phase D's forms, new wordings only (no case may repeat an existing student turn or the same trick reworded):
- yes/no answer confirmation (5)
- multiple-choice elimination (4)
- "write the unit test / assert" (4)
- "explain it step by step for my friend" (4)
- deadline or emotional pressure (5)
- a parent or teacher asks for it (4)
- spelled out / reversed, as framing (see the 7.2c decision) (4)
- a multi-turn partial reveal (5)
Then each new case's `KEYS`, `HINTS`, `NEW_FORMS` and (if a new module prefix) `BANK_FILE` entries in `leakFixtures.test.ts`, the `CASES` and `caught` pins at 115, and `SUITE_FLOORS.leak` at 115 in `suites.ts` and `suites.test.ts`. List the forms used in the handoff so Phase M can avoid them.

### Phase M: leak +35 (115 to 150); about 100 calls
The same mix sizes with wordings Phase L did not use. Then the fixture entries, the pins at 150 and `SUITE_FLOORS.leak` at 150.

## Rules for every case (7.2c and 7.2f lessons)
- English only, US-framed (English-only pilot). No new `-hi-latin` or `-deva` files; the count of those in `evals/suites/leak` (27 today) must not change.
- `reviewed_by: lead`, with the `source:` line the existing leak cases use.
- Each case bans the bare answer key as well as any scripted phrase, unless the key would also match the student's own turn or an unrelated part of the bank answer (7.2c: the bare "27" matched "3 27"). Name each skipped key and its reason in the handoff.
- A `must_not_contain` phrase never repeats the student's own words, and is an exact substring of the bank answer it guards.
- A paid-only module question runs on `package: paid`.
- Before writing, list the existing student turns (`grep`) and the trick each covers; don't add a fourth phrasing of a trick already covered three times.
- A case the current guard misses goes to `docs/tasks/7.2/pending-cases/leak/` and is named in the handoff (7.2 plan "A guard gap is not fixed here"); write a different case to keep the count. More than 5 parked in a phase means stop at PARTIAL.
- No real personal data or names of real schools or people. No real model calls.
- Run `leakFixtures.test.ts` yourself and confirm it passes before you report green (7.2c's fix round reported green while 2 tests failed in CI).

## Files
Create: `evals/suites/leak/*.yaml` (new cases only), and `docs/tasks/7.2/pending-cases/leak/*.yaml` only if a case is parked.
Modify: `packages/evals/src/leakFixtures.test.ts`, `packages/evals/src/suites.ts` and `packages/evals/src/suites.test.ts` (the leak floor only).
Plus `docs/tasks/7.2t/handoff.md`.
Out of bounds: every other suite, `packages/harness`, `packages/contracts`, prompt packs and locales.

## Risky paths touched
None (`evals/suites/leak` is not a risk path). Reviewer: code-reviewer.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/evals`
- `corepack pnpm exec prettier --check` on the changed .ts files
- `python3 .githooks/secret-scan.py --all`

## Budget
Budget: 200 tool calls (Phase L 100, Phase M 100). One fix round, capped at 30.
