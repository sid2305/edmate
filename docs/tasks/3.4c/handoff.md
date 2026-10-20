Status: DONE

## Summary

A same-topic turn 2+ was degrading to `locked`: `retrievalQuery.ts` built one combined query
(student text + the tail of the last agent reply) for both the context search and the locked
probe. On turn 2+ the agent's own reply words swamped the student's words, diluting coverage
below the 0.5 threshold, while `memoryRetrieval.probe` counts any shared word as a hit, so
`coverageGate` returned `locked` instead of climbing the help ladder.

Fix: the student's own words and the agent-widened query are now built and searched separately.
The locked probe and the locked-precedence check always run on the student's own words alone, so
the agent's reply can never inflate or dilute a locked verdict. The agent-widened search only adds
coverage, and only merges in when the student's own words don't hit locked material.

## Files

- `packages/harness/src/pipeline/steps/retrievalQuery.ts`: added `retrievalQueries(input, history)`
  returning `{ student, withContext }`; `retrievalQuery` is now a thin wrapper over `withContext`.
- `packages/harness/src/pipeline/steps/retrievalQuery.test.ts`: new cases for `retrievalQueries`.
- `packages/harness/src/pipeline/steps/buildContext.ts`: runs `scoped.search(student, K)`,
  `scoped.probeLocked(student)` and (only when `withContext !== student`)
  `scoped.search(withContext, K)` concurrently; added `mergeByScore` (union by id, keep the higher
  score, unscored last, capped at K); locked precedence: `found = probe.hit ? own : mergeByScore(...)`.
- `packages/harness/src/pipeline/steps/buildContext.test.ts`: updated the "bare 42" and probe-query
  cases for the new two-search shape; added dilution-fixed, locked-precedence, merge (dedupe/cap/
  unscored-last) and hint-request-with-history cases.
- `apps/cli/src/commands/chat/sameTopic.test.ts` (new): `buildChatDeps` over the real demo-teacher
  content, free package, one session, three same-topic allowed turns on `values-variables`, then two
  locked turns on `loops`. Wraps `setup.deps.turnConfig.load` to replay the last saved help state
  (3.9a gap; in-test plumbing only, `apps/cli/src/commands/chat/deps.ts` untouched).

## Evidence

### Bug reproduced first (failed on `main`)

Checked out `origin/main`'s `buildContext.ts`/`retrievalQuery.ts` into this worktree, ran the new
tests, then restored the fixed files (no commit made with the reverted files).

`apps/cli` — `sameTopic.test.ts` on main's code:
```
FAIL  src/commands/chat/sameTopic.test.ts > ... > three same-topic allowed turns: never locked, the saved help rung climbs above 0
AssertionError: expected true to be false // Object.is equality
  139|  expect(events.some((e) => e.type === 'locked')).toBe(false);
```
(a same-topic allowed turn ends `locked`, confirming the 3.9 report)

`packages/harness` — new `buildContext.test.ts` cases on main's code (9 failing):
```
FAIL > dilution fixed (3.4c): ... AssertionError: expected 0.3888888888888889 to be greater than or equal to 0.5
FAIL > locked precedence (3.4c): ... AssertionError: expected 'mod_test_02' not to be 'mod_test_02'
FAIL > merges own and context searches by score, ...: [ 'chk_own', 'chk_shared' ] vs expected [ ..., 'chk_ctx' ]
FAIL > a hint request with agent history: the context search runs ...: probes not empty (expected [])
FAIL (x5) retrievalQuery.test.ts > retrievalQueries ...: TypeError: retrievalQueries is not a function
```

### After the fix

```
$ corepack pnpm turbo run typecheck lint test --filter=@edmate/harness... --filter=@edmate/cli... --filter=@edmate/evals... --force --concurrency=1
 Tasks:    26 successful, 26 total
```
- `@edmate/harness:test` — all green; `buildContext.test.ts` 37/37, `retrievalQuery.test.ts` 11/11.
- `@edmate/cli:test` — 82/82, including `sameTopic.test.ts` (1/1) and the unchanged
  `deps.test.ts` locked case ("Teach me loops please" still ends `locked`).
- `@edmate/evals:test` — 910/910.

Locked suite (34+ cases, including mutation tests):
```
$ corepack pnpm --filter @edmate/evals exec vitest run src/lockedFixtures.test.ts
 Test Files  1 passed (1)
      Tests  44 passed (44)
```

Access properties, unchanged:
```
$ corepack pnpm --filter @edmate/harness exec vitest run src/access/retrieval.property.test.ts src/access/turn.property.test.ts
 Test Files  2 passed (2)
      Tests  3 passed (3)
```

DB (local Postgres was available):
```
$ corepack pnpm --filter @edmate/db exec vitest run test/access-audit.test.ts
 Test Files  1 passed (1)
      Tests  12 passed (12)
$ corepack pnpm --filter @edmate/db exec vitest run test/retrieval-leak.int.test.ts
 Test Files  1 passed (1)
      Tests  25 passed (25)
```

Secret scan:
```
$ python3 .githooks/secret-scan.py --all
(clean, no output)
```

## Deviations

- The plan's example wording ("What is a variable?", "I don't know what a variable is", "I still
  don't get what a variable is") turned out to not stay covered by the student's own words on the
  CLI's real lexical index (no stop words, short queries): filler words ("i", "don't", "know")
  dilute the student-only query the same way the agent's reply used to. Used instead: "What is a
  variable?", "Is a variable a name for a value?", "So is a variable just a name for a value?" —
  each stays mostly in-vocabulary with the course notes, keeping coverage ≥ 0.5 on the single-word,
  stop-word-free in-memory scorer. Functionally identical (same topic, never resolving, attempt
  stays `none`/`wrong`).
- Similarly, the locked example "What is a while loop?" was swapped for "Explain while loops":
  generic words ("what", "is", "a") in the original phrase happened to score ≥ 0.5 against an
  unrelated allowed-module chunk (an arithmetic-operators paragraph) purely by overlap, which would
  have made the test flaky evidence for "locked still locked" rather than a real repro. This is the
  in-memory index's known lack of stop words/IDF weighting (3.9 Phase A decision, unaffected by this
  task); the production db index's IDF weighting does not have this failure mode.
- Added a route-intent-model classifier entry to the scripted gateway for turns where no rule is
  confident (one of the new wordings needs it); matches the plan's note that route's model fallback
  may be reached and needs a scripted entry, same technique as `deps.test.ts`.

## Decisions

### 20 Oct 2026 · 3.4c locked probe and precedence run on the student's own words · decided by tdd-guide
Decided: the locked probe and the locked-precedence check in `buildContext` run on the student's
own words only (`retrievalQueries(...).student`); the agent-widened query is used only to add
coverage via `mergeByScore`, and only when the student's own words don't hit locked material.
Why: this is the smallest change that keeps locked-content protection exactly as strict as before
(judged on undiluted words) while fixing the same-topic degrade; a diluted or inflated locked
verdict from the agent's own reply text would be a safety regression either way.
risk: high

### 20 Oct 2026 · 3.4c no probe threshold in the in-memory index · decided by tdd-guide
Decided: `memoryRetrieval.probe`/`scopedRetrieval.probeLocked` keep `hit: score > 0`; no threshold
was added here.
Why: the in-memory scorer has no stop words, so a 0.5 floor would turn a real locked request
("Teach me loops please" scores 0.25) into `ask_teacher`, weakening locked protection in the CLI
and in harness tests. The db adapter already has its own calibrated `PROBE_FLOOR = 0.5`, which is
the production threshold; this task is out of bounds for `packages/db/**`.
risk: low

### 20 Oct 2026 · 3.4c one extra search call per turn with agent history · decided by tdd-guide
Decided: `buildContext` now runs up to two searches plus one probe concurrently (via
`Promise.all`), instead of one search plus one probe. On a locked turn the widened search's result is discarded rather
skipped (packages/harness/src/pipeline/steps/buildContext.ts); this is accepted, not fixed (3.4c review LOW, wontfix).
Why: needed to keep the student-only query and the agent-widened query separate; the extra call
only happens when there is an agent message in history, runs in parallel with the others inside
buildContext's existing 300 ms budget, and on the db index is one more query embedding per turn.
risk: low

### 20 Oct 2026 · 3.4c finding for 3.9a: edmate chat never reloads saved help state · decided by tdd-guide
Decided: not fixed here (explicitly out of bounds per the plan). `apps/cli/src/commands/chat/deps.ts`
composes `memoryTurnConfigStore(world)`, which reads the world's fixed session row and never looks
at what `memorySessionStateStore.saveHelpState` wrote, so the CLI's help ladder never climbs across
turns in practice. `sameTopic.test.ts` works around this with in-test plumbing
(`withHelpStateReload`) to prove the harness-level fix climbs correctly.
Why: logging as a finding for 3.9a, per the plan's explicit scope boundary.
risk: low

### 20 Oct 2026 · 3.4c filler follow-ups still lock on the CLI's in-memory index until 3.9a · decided by lead
Decided: a follow-up with no topic words ("I still don't get it", after "I don't know what a variable is") still ends `locked` through `edmate chat`. This is because the in-memory index has no stop words and no probe floor. It is accepted for now, and 3.9a closes it by moving the CLI to the db index, which has both.
Why: the code review reproduced it on the branch. The db index is what students use in production. Adding a threshold to the in-memory probe would stop real locked requests from locking (the planner's analysis).
risk: low
