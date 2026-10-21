# 4.6c handoff: lockedLeak follow-ups (4.6b fix-round re-review)

- **Status:** DONE
- **Branch:** `m4/4.6c-lockedleak-followups`
- **Worktree:** `.claude/worktrees/agent-a6f2c0f57a946678e` (local branch `work-4.6c`)
- **Spec:** the board entry (no plan.md). Kept the paused builder's WIP (aa0bc16), reviewed it and finished it.

## Changes
1. **Markdown emphasis inside a word** (`lockedMatch.ts`, `padMarkdownEmphasis`): only in the `rendered` reading, a run of `*` or `` ` `` of any length, or exactly `__` / `~~`, gets zero-width padding when it has a letter directly on both sides. So `t**h**e`, `lo~~o~~p` and `` lo`o`p `` read as one word. `snake_case`, `a * b` and `* item` bullets are left alone. The `text` and `values` readings are unchanged.
2. **Known-miss notes** (in the `lockedMatch.ts` header): `<a<b>`, a `<` inside a quoted value, `--!>` comments and non-ASCII tag names. The paused builder's wording was corrected to match what the code does (checked against the code). A unit test pins each one.
3. **A failed or timed-out post-guard step counts as a locked trip** (`runner.ts`): it sets `lockedTrip`, so the saved help state has `lockedStopped: true`. One test covers the timeout and one covers the failure.
4. **A corrupt stored help state is reported once** (`errors.ts` `HelpStateUnreadable`, `runner.ts`): one background report per turn. It gives the kind only, never the stored data.
5. **Eval cases:** the three B-19 cases moved from `docs/tasks/4.6/pending-cases/` to `evals/suites/locked/` with `reviewed_by: sid2305`. Their spans were added to the fixture gate. Counts are now 37 cases, 42 steps and 34 failing by phrase. Both mutations fail all 37.
6. **New fixture-gate form** "markdown bold inside words" (`l**o**op`, sent in 5-character chunks) runs across all 37 cases.
7. **New pending case** `locked-loops-md-inword-bold-en` is parked in `docs/tasks/4.6/pending-cases/` (`reviewed_by: pending`). The fixture gate loads it from there and checks that every form trips.

## Acceptance evidence
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/evals...` → `Tasks: 14 successful, 14 total`. Harness `4996 passed`, evals `936 passed`, contracts `348 passed`, config `42 passed`.
- Coverage: `lockedMatch.ts 100 | 100 | 100 | 100`, `runner.ts 98.91 | 96.99 | 98.73 | 99.51`.
- Mutation check: with `padMarkdownEmphasis` turned off, every seeded case fails its "markdown bold inside words" form. Restored afterwards.
- No regression on the original 34 locked cases: all pass every form, old and new.

## Deviations
- The accept list names a case `locked-loops-md-inword-bold-en (pending)` that did not exist yet. I wrote it as a pending case and did not add it to the suite (it needs a human reviewer).

## Decisions
- Markdown in-word padding applies to the `rendered` reading only, and only to runs with a letter directly on both sides (`*`/`` ` `` of any length, `_`/`~` only doubled). Kept from the WIP. risk: medium
- Any post-guard failure (timeout, error or invalid result) sets the session stop flag, failing closed. risk: high
- `HelpStateUnreadable` is a new harness error, pushed to `background` once per turn when the stored help state can't be read. risk: low
- The new md-inword case waits in `docs/tasks/4.6/pending-cases/` with `reviewed_by: pending` until a human signs it off. The fixture gate runs it from there. risk: low
- Spans for the three B-19 cases come from `loops/notes.md`: 3.1 "A `for` loop runs its indented body…", 3.4 "A `while` loop repeats as long as its condition is True:", 3.3 "To add things up, keep a running total in a variable:". risk: low
- The known-miss tests lock in today's behaviour, so any fix to one of these misses must change its test on purpose. risk: low
