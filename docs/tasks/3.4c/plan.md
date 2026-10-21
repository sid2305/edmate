# Task 3.4c: same-topic turns no longer fall to `locked`

Board: `board.py show 3.4c` · M13 · deps 3.4 (done) · board risk: **risky** · branch `m13/3.4c-same-topic-locked` · one phase, sonnet-sized.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Same-topic turns degrade to locked (3.9 report): retrievalQuery.ts appends the last agent reply, diluting overlap below the 0.5 coverage threshold while probe() counts any locked score > 0 as a hit, so coverageGate returns locked instead of climbing the help ladder. Shape the query (student text weighted first or scored separately) and/or give the locked probe a real threshold"

Accept: "a multi-turn same-topic test on allowed content climbs the help ladder and never returns locked; locked content still returns locked; retrieval-leak and locked suites pass"

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Bug reproduced first | The new tests below are written first and **fail on `main`** (a same-topic turn ends `locked`). Paste the failing output into the handoff before the fix. |
| Same-topic turns climb, never locked (demo course) | New `apps/cli/src/commands/chat/sameTopic.test.ts`: `buildChatDeps` over the real demo-teacher content, free package, one session, 3 or more scripted turns on `values-variables` (e.g. "What is a variable?", then "I don't know what a variable is", then "I still don't get what a variable is"; calibrate the wording so each is covered by the student's own words). Every turn: no `locked` event, `trace.move !== 'locked'`. The help rung climbs: the saved help state's rung (or a `hint_rung` event) goes above 0 by the last turn. |
| Locked still locked (demo course) | Same file: after the allowed turns above (so the history holds an allowed agent question), "Teach me loops please" and "What is a while loop?" each end `locked`. And the existing `deps.test.ts` locked case still passes unchanged. |
| Locked precedence (unit) | `buildContext.test.ts`: a student asks for locked material while the agent's last question is on allowed material; the context search alone would cover, but `lockedHit` is true and `retrieved` comes only from the student's own words, so `coverageGate` returns `locked`. |
| Dilution fixed (unit) | `buildContext.test.ts`: student text that fully covers an allowed chunk plus a long agent reply in history: `retrieved` keeps the student-only score (at or above 0.5) and `coverageGate(...)` is `null`. On `main` this case is not covered. |
| Bare answers still retrieve | `buildContext.test.ts`: the existing "bare 42" case still retrieves (now via the context search). |
| Locked suite (34 cases) | `packages/evals/src/lockedFixtures.test.ts` unchanged and green, including both mutation tests. |
| Retrieval-leak suite | `packages/db/test/retrieval-leak.int.test.ts` green (needs local Postgres; if not available, say so and point to the CI run). `packages/db/test/access-audit.test.ts` green. |
| Access properties | `packages/harness/src/access/retrieval.property.test.ts` and `turn.property.test.ts` green, unchanged. |
| Gates | `turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/cli... --filter=@edmate/evals...` green; `python3 .githooks/secret-scan.py --all` clean. |

## Root cause (traced in planning)

- `buildContext` runs **one** query for both `search` and `probe`: the student's text plus the tail (up to 1000 chars) of the last agent message (`retrievalQuery.ts`).
- On a second turn, the agent's reply words swamp the student's words. The in-memory index scores coverage as "share of the query's words in one chunk", so coverage falls below 0.5. The db index (IDF-weighted term coverage) dilutes the same way.
- The probe then decides: `memoryRetrieval.probe` says `hit: score > 0`, so any shared word ("a", "is", "it") with a locked chunk counts, and the coverage gate returns `locked`. (The db adapter already uses `PROBE_FLOOR = 0.5`, so in production the same turn would usually go to `ask_teacher` instead: still not the ladder.)

## Design: score the student's words separately; locked takes precedence

Change only how `buildContext` queries. The access filter, the probe and the coverage gate stay as they are.

1. **`retrievalQuery.ts`** adds `retrievalQueries(input, history): { student: string; withContext: string }`.
   - `student` is the head of the trimmed input text (already capped at `QUERY_PART_MAX_CHARS`).
   - `withContext` is exactly today's combined string.
   - `retrievalQuery` stays as a thin wrapper that returns `withContext`, so its current tests keep passing.
   - Agent-part extraction does not change. That is the smallest change: dilution in the combined query can no longer hurt, because the student-only search is the floor.
2. **`buildContext.ts`** runs these three calls concurrently (all through `scopedRetrieval`, unchanged):
   - `own = scoped.search(student, K)`. `scopedRetrieval` already returns `[]` with no index call for `''`.
   - `ctx = scoped.search(withContext, K)`, only when `withContext !== student`.
   - `probe = scoped.probeLocked(student)`, **on the student's own words only**. Agent text can no longer inflate or deflate the locked score. An empty text (a hint request) never probes, so `lockedHit` is `false`.

   It then picks the chunks:
   - **Locked precedence:** `found = probe.hit ? own : mergeByScore(own, ctx, K)`. When the student's own words hit locked material, the agent's context can never add coverage. So a real locked request gets exactly the same verdict as before, judged on undiluted words, and the gate returns `locked` unless the student's own words are covered by allowed material. That is today's rule.
   - `mergeByScore`: union by chunk id, keep the higher score, sort by score descending then id (an unscored chunk sorts last and stays unscored), take `K`, then the existing `fit`.
3. **`memoryRetrieval.probe` keeps `hit: score > 0`. No probe threshold here.** In planning, the CLI's existing locked case ("Teach me loops please") scores 1/4 = 0.25 on the in-memory word-share scorer. That scorer has no stop words, so a 0.5 floor would turn this real locked request into `ask_teacher`, and that weakens locked protection. The db adapter already has its calibrated `PROBE_FLOOR`. Log this as a decision.

Known limit (log it; not fixed here): with the in-memory index only, a filler follow-up with no topic words ("I still don't get it") can still probe locked, because filler words are shared with locked notes. In production the db probe's stop words and 0.5 floor prevent it. The CLI moves to the db index in 3.9a.

## Files

Modify:
- `packages/harness/src/pipeline/steps/retrievalQuery.ts`: add `retrievalQueries`.
- `packages/harness/src/pipeline/steps/retrievalQuery.test.ts`: cases for `retrievalQueries` (student-only part, combined part, empty text, no agent message gives identical parts).
- `packages/harness/src/pipeline/steps/buildContext.ts`: the two searches, probe on the student text, `mergeByScore`, locked precedence; header comment updated.
- `packages/harness/src/pipeline/steps/buildContext.test.ts`: update the "bare 42" case (searches are now `['42', '42\n<question>']`) and the probe-query case. Add the dilution, locked-precedence, merge (max score, dedupe, `K` cap, unscored last) and hint-request-with-history (context search runs, no probe) cases.

Create:
- `apps/cli/src/commands/chat/sameTopic.test.ts`: the demo-course repro above.
  - The CLI's composition saves help state (`memorySessionStateStore`) but never reloads it (`memoryTurnConfigStore(world)` reads the world's fixed session). So the test wraps `setup.deps.turnConfig.load` to return the last `sessionState.saved` help state, in-test plumbing only.
  - The scripted gateway needs a reply per turn and, if `route` falls back to the model (3.3), its classifier entries. Copy the `deps.test.ts` pattern.

Out of bounds:
- `packages/harness/src/access/**` (`scopedRetrieval` unchanged), `packages/harness/src/guardrails/**`, `packages/harness/src/pedagogy/**` (`coverageGate`/threshold unchanged)
- `packages/harness/src/testing/memoryRetrieval.ts` (no threshold change, see design 3), `retrievalContract.ts`
- `packages/db/**`, `packages/contracts/**`, `evals/suites/**`, `content/**`
- `apps/cli/src/commands/chat/deps.ts` and the other CLI sources (the help-state reload gap goes to 3.9a, not here)

## Tests first (tdd-guide order)

1. `sameTopic.test.ts` and the new `buildContext.test.ts` dilution and precedence cases: run on the unchanged code and record that the same-topic case fails with `locked`.
2. `retrievalQuery.test.ts` new cases, then `retrievalQueries`.
3. `buildContext.ts` change; update the two existing cases whose query expectations change.
4. Full gates: harness, cli and evals (the locked suite). Then db `access-audit.test.ts` and, with Postgres, `retrieval-leak.int.test.ts`.

## Risky paths touched

Every planned path was checked against `.claude/skills/merge-gate/risk-paths.txt`: `packages/harness/src/pipeline/steps/{retrievalQuery,buildContext}.ts` and their tests, `apps/cli/src/commands/chat/sameTopic.test.ts`, `docs/tasks/3.4c/*`. **None matches** a risk-paths glob (not `access/**`, `guardrails/**`, `pedagogy/**`, `evals/suites/locked/**` or `contracts/**`), so the merge gate requires no group reviewer.

The board marks the task **risky** because it changes when a turn is judged locked. So:
- the handoff `## Decisions` gets a `risk: high` entry ("locked verdict now judged on the student's own words; agent context can only add coverage when the student's words don't hit locked");
- recommended reviewers: **code-reviewer** (every PR) and **security-reviewer** (locked-content semantics, "locked means locked"). typescript-reviewer is optional.

## Decisions to log in the handoff

- risk: high: the locked probe and locked precedence run on the student's text only; the combined query is used only to add coverage.
- risk: low: no probe threshold in `memoryRetrieval` (the 0.25 "Teach me loops please" finding); the db adapter's `PROBE_FLOOR` is the production threshold.
- risk: low: one extra `search` call per turn when there is agent history (run in parallel, inside `buildContext`'s 300 ms budget; one more query embedding on the db index).
- Finding for 3.9a: `edmate chat` never reloads saved help state, so the ladder never climbs in the CLI.

## Open questions

None blocking.
