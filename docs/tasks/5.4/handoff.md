# Task 5.4 handoff: access filter

- Status: PARTIAL (Phase A DONE; Phase B, the `packages/db` half, is a separate build)
- Branch: `m5/5.4-access-filter`
- Worktree: `.claude/worktrees/agent-a336d9b8128f650b2`
- Plan: `docs/tasks/5.4/plan.md` (with the lead answers of 20 Oct 2026)

## Phase A

### What was built (`packages/harness`)

- `src/access/scopedRetrieval.ts` (new): `scopedRetrieval(index, entitlement)` returns
  `{ search(q, k), probeLocked(q) }` with the scope fixed from the entitlement.
  - search: an empty query, an empty allowed list or a `k` that is not a positive number returns
    `[]` without calling the index. Otherwise it asks for the teacher and the deduplicated allowed
    ids, then `checkScope` re-checks every result: it must be an object with a source, the
    entitlement's teacher, an allowed module and not a locked one. One stray result throws
    `RetrievalScopeError` (ids only, never text). Results are rebuilt with exactly the Chunk fields
    (extra keys an index adds are dropped) and sliced to `k`.
  - probeLocked: no locked modules or an empty query gives `{ hit: false, score: 0 }` and no call.
    Otherwise it returns a fresh `{ hit: raw.hit === true, score: finite and clamped to 0..1 }`; a
    non-object answer counts as no hit.
  - `RetrievalScopeError` and `checkScope` moved here from `buildContext`, which re-exports the error.
- `src/access/tools.ts` (new): `entitledTools`, `policyTools`, `offeredTools` and
  `DuplicateToolError` moved from `pipeline/tools.ts` unchanged. `pipeline/tools.ts` keeps
  `ToolRegistry`, `RegisteredTool`, `noTools`, `toolSpec` and re-exports the moved names;
  `access/tools.ts` imports `pipeline/tools.ts` as types only (no runtime cycle).
- `src/pipeline/steps/buildContext.ts`: uses `scopedRetrieval`; same behaviour, plus a chunk in a
  locked module now fails closed too (it could only happen with a corrupt entitlement, which the
  contract already rejects).
- `src/access/index.ts`: exports the new names and holds the cache rule and the cache inventory
  (`promptCacheKey`; db `leakCache`, keyed in Phase B).
- `src/testing/hostileRetrieval.ts` (new, exported from `testing/index.ts`): `wideningRetrieval`,
  `textLeakingRetrieval`, `junkProbeRetrieval` over `memoryRetrieval`, and `markedWorld` (every
  chunk's text carries its own unique marker).
- `vitest.config.ts`: a 100% coverage threshold for `src/access/**` (Definition of done).

### Tests (written first; red on missing modules, then green)

| Item | Evidence |
|---|---|
| Unit | `src/access/scopedRetrieval.test.ts`, 29 cases: scope and dedupe sent to the index; another teacher's, an unallowed and a locked chunk each throw with ids only; non-list/non-object answers fail closed; widening index refused; `k` honoured; k ≤ 0/NaN/0.5 and empty query/allowed make no call; extra keys dropped, results copied; probe junk (`text`, NaN, string `hit`, ±Infinity, string score, null, a string) passes on only `{hit, score}`; `@ts-expect-error` cases: `RetrievalIndex.search` without a scope, a caller-supplied scope, `probeLocked` with ids, `.text` on a probe result. |
| Property, index | `src/access/retrieval.property.test.ts`, seed 20261020, 2,000 iterations: random three-teacher world × random valid entitlement (foreign and duplicate ids included) × honest/widening/text-leaking/junk-probe index × random query (Unicode included). Search and `buildContext` return only in-scope chunks with no out-of-scope marker, or throw `RetrievalScopeError` exactly when the index returned a stray chunk; honest results equal the honest index's ids; probe keys are `['hit','score']` with no marker. Tally: `{"honest:results":282,"honest:empty":218,"widen:refused":362,"widen:empty":151,"leakText:results":295,"leakText:empty":215,"junkProbe:results":281,"junkProbe:empty":196,"probe:hit":817}` |
| Property, whole turn | `src/access/turn.property.test.ts`, seed 20261020, 200 turns through `runTurn` with the real admit, entitle, buildContext, decide and generate, the scripted gateway and the spy, a random registry and a random model `tool_call` (sometimes unknown or unentitled). No request or event holds an out-of-scope marker; every offered tool's skill is entitled; every run tool was offered and entitled. Tally: `{"in_scope_text_sent":110,"offered":39,"ran":3,"call_not_run":105,"honest:done":49,"widen:done":58,"leakText:done":52,"junkProbe:done":41}`. Plus a version-only change (pkg v2 → v3) changes the request `cacheKey`. |
| Property, tools | `src/access/tools.property.test.ts`, seed 20261020, 2,000 random registries × entitlements × decision lists: entitled/policy/offered tools stay within the skills, keep decision order once each, duplicates throw `DuplicateToolError`, nothing runs. Tally: `{"duplicate":304,"offered":480,"none":1216}` |
| Unchanged tests | `pipeline/steps/buildContext.test.ts`, `access/property.test.ts`, `pipeline/tools.test.ts` and `pipeline/turn.integration.test.ts` pass unchanged. |
| Coverage | `src/access/**` 100% statements, branches, functions and lines (threshold added). |
| No contracts change | `git diff origin/main --stat -- packages/contracts` is empty. |

### Gate

```
docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres redis
corepack pnpm turbo run typecheck lint test --filter=...@edmate/harness --force --concurrency=1
  @edmate/harness:test  Test Files 94 passed (94)
  @edmate/db:test       Test Files 35 passed (35)
  @edmate/worker:test   Test Files 13 passed | 3 skipped (16)
  @edmate/web:test      Test Files 8 passed (8)
  (queue, gateway, content, ingest, evals, cli also green)
  Tasks: 38 successful, 38 total
python3 .githooks/secret-scan.py --all   → clean (no output, exit 0)
```

### Deviations

- `scopedRetrieval` also returns `[]` without a call when `k` is not a positive number, and
  rebuilds each chunk with only the Chunk fields (the plan said "copied"). Both are stricter.
- `checkScope` takes `unknown` and also refuses a non-list answer or a non-object entry.
- `decide.ts` and `generate.ts` still import the tool filter through `pipeline/tools.ts` (the
  re-exports), as the plan allowed; the moved cases stay in `pipeline/tools.test.ts`.
- Added a 100% coverage threshold for `src/access/**` in `vitest.config.ts` (not in the plan's
  file list; it enforces the Definition of done).

### Left to do (Phase B, `packages/db`)

The Postgres property, the static no-unfiltered-search audit, the owned-ids leakCache key,
`CandidatesSchema.max()` and the `to_tsquery` Unicode fix, as in the plan.

## Decisions

### 20 Oct 2026 · 5.4 Access filter consolidated in harness/access (scoped retrieval, tool filter) · decided by tdd-guide · risk: high
Decided: every turn-time read of the retrieval index goes through `access/scopedRetrieval.ts`, which fixes the scope from the entitlement, re-checks each chunk (teacher, allowed, not locked), rebuilds it with only the Chunk fields and passes on only a fresh `{ hit, score }` from the probe. The tool filter moved to `access/tools.ts` with re-exports from `pipeline/tools.ts`.
Why: the build plan's access filter and ADR-0003 want one reviewed place for it; keeping only known fields and a fresh probe object means a buggy or hostile index cannot smuggle text through extra keys.

### 20 Oct 2026 · 5.4 Cache rule and inventory recorded in access/index.ts · decided by tdd-guide · risk: high
Decided: a cache of anything derived from teacher material or an entitlement is keyed by the package id and version or the exact owned allowed-module set, plus the material revision for material. The inventory is `promptCacheKey` and the db `leakCache` (keyed in Phase B on teacher, material revision and owned allowed ids, per the lead's Q1 answer). No new cache added.
Why: ADR-0003 point 6 (package-versioned caches) without a contracts change.

### 20 Oct 2026 · 5.4 Property sizes and seeds · decided by tdd-guide · risk: low
Decided: seed 20261020; 2,000 index-level iterations, 200 whole turns, 2,000 tool-registry iterations. All three print a tally of outcomes.
Why: the plan's sizes; together they run in under a second locally, so CI time is not a concern.

### 20 Oct 2026 · 5.4 100% coverage threshold for harness access · decided by tdd-guide · risk: low
Decided: `vitest.config.ts` enforces 100% for `src/access/**`, as it does for guardrails and pedagogy.
Why: the Definition of done requires 100% on `packages/harness/src/access/`; a threshold keeps it from slipping.
