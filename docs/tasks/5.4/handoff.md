# Task 5.4 handoff: access filter

- Status: DONE (Phase A and Phase B)
- Branch: `m5/5.4-access-filter`
- Worktrees: Phase A `.claude/worktrees/agent-a336d9b8128f650b2`; Phase B
  `.claude/worktrees/agent-ae75cd80937ae1ee9`
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

## Phase B

### What was built (`packages/db`)

- `src/repositories/retrieval.ts`:
  - leakCache key: the revision and `repos.modules.ids` are read in parallel; the key and the
    build use only the allowed ids the teacher owns (foreign, unknown and repeated ids drop out).
    A module created between the reads is not in `owned`, so it is built as locked (closed). A
    failed ids read is `{ hit: true }` (`leak_failed`), like the other reads.
  - `CandidatesSchema`: at most `LEAK_CANDIDATES_MAX` = 2,048 candidates of
    `LEAK_CANDIDATE_MAX_LENGTH` = 65,536 characters (both exported). Measured largest legitimate
    batches: one 16 KB text (`LIMITS.skillPayloadMaxJsonLength`) gives a 16,383-character
    candidate; the same text split by a 4,000-character student message owning every other window
    gives about 220 candidates. Both caps are at least 4x those (the test asserts it).
  - `to_tsquery`: every term is a quoted literal (`tsTerm`: `'term':*`, `'` and `\` escaped), in
    `ftsQuery` and in the per-term SQL (`'''' || t || ''':*'`).
- `src/repositories/leakCache.ts`: comment only (key function unchanged; it gets the owned set).
- `src/repositories/README.md`: candidate caps, owned key, quoted terms, the cache rule and the audit.
- `src/repositories/index.ts`: exports the two caps.

### Tests (written first)

| Item | Evidence |
|---|---|
| Static audit | `test/access-audit.test.ts` (no database), 12 cases. Scans every non-test file in `packages/*/src` and `apps/*/{src,app}` (comments stripped). Rules: (1) `chunks` table (schema import, `s.chunks`, or SQL `from/join/update/into chunks`) only in `db/src/schema/**`, `db/src/internal.ts`, `db/src/repositories/{chunks,retrieval}.ts` (no seed file names it); (2) `retrieval.ts` reads chunks exactly 5 times (`.from(chunks)` x4, `${chunks}` x1), each statement carrying `scope`/`scoped(`/`chunks.teacherId`; (3) `.material(` only in `retrieval.ts` (lead's Q2); (4) `RetrievalIndex` implementers only db `retrieval.ts`, harness `testing/{memoryRetrieval,testSteps,hostileRetrieval}.ts` and the port declaration `contracts/src/ports.ts`; (5) in harness src, index `.search(` (3 args) / `.probe(` (2 args) or `retrieval.search/probe` only in `access/scopedRetrieval.ts` plus the testing helpers, `.leakCheck(` only in `guardrails/lockedLeak.ts` plus the testing helpers. Every rule also runs on fixture strings that break it (and ones that must not trip it). |
| Unicode / tsquery | Red first: `tsTerm` missing and `ftsQuery` unquoted. `test/retrieval.int.test.ts`: tsquery syntax, spaces, quotes and backslashes parse as literals on Postgres; queries of ligatures, titlecase digraphs, Roman/Arabic/Devanagari digits, Hangul fillers, combining marks, ZWJ/ZWSP, RTL override, BOM, Deseret and over-long words run through search and probe without raising. Also checked by hand on Postgres 16: all 1.1M code points through the quoted form, 0 errors (unquoted, 29 separators and operator characters raise; `queryTerms` already kept those out, so no term raised before; see Deviations). |
| v1 → v2 cache | `test/retrieval-leak.int.test.ts`: warmed under allowed {OPEN, M2}; v2 drops M2; M2's span hits under v2 on the same adapter; v1 still answers v1. |
| Owned key | Same file: `[OPEN]` and `['mod_rb_foreign', OPEN, 'mod_nowhere', OPEN]` and ten more foreign lists build once (`loads` = 1; red before: 2). A failed `modules.ids` is `{ hit: true }` / `leak_failed`. |
| Candidate caps | Same file: the two measured legitimate batches are ≤ 1/4 of the caps and pass; exactly 2,048 candidates with one of 65,536 characters passes; one more candidate or one character more is `invalid` with no database call. |
| Property, Postgres | `test/access-property.int.test.ts`, seeds 20261020 / 20261022. World: teachers A (6 modules), B (2), C (3), 3 chunks each, embedded with the scripted vector; every chunk's text holds its own chunk marker and its module marker, and the document title and locator hold the module marker. (a) 300 iterations: random teacher (10% unknown), random allowed list (any teacher's modules, unknown ids, repeats), random query (shared words, any module's markers, unusual Unicode, stop words, empty), full text or hybrid, k in 1..50. Every result is the teacher's, in allowed ∩ owned, its `text` and `source.title` carry its own module's marker, and no field holds any out-of-scope marker (the lead's and security review's added case). Two-sided: a single chunk marker query returns exactly that chunk when it is in scope, nothing otherwise. probe: `Object.keys` = `['hit','score']`, boolean, finite 0..1, no marker. Tally `{"search:results":170,"search:empty":130,"marker:found":29,"marker:hidden":271,"probe:hit":68,"probe:miss":232}`. (b) 20 new random versions of A's package (v3..v22) resolved through `entitlementStoreFor`, preview (newest) and eval (random pinned version): `packageVersion` and `allowedModuleIds` equal that version's `moduleIds`; 5 random searches each stay within them with no stray marker; leakCheck under the entitlement hits a locked module's text and not an allowed module's or teacher C's. Tally `{"preview:results":74,"preview:empty":26,"eval:results":74,"eval:empty":26,"leak:locked":40}`. Mutation check: dropping the teacher and ownership filters from `rank` fails (a) at iteration 0. |
| leakCheck SLO with the extra read | `leakCheck SLO: p95 4.3 ms, p99 5.2 ms` (≤ 50 / 100). |
| Coverage | `src/repositories/retrieval.ts` 100% lines, 97.77% branches (threshold 90). |
| No contracts change | `git diff origin/main --stat -- packages/contracts` is empty. |

### Gate

```
docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres redis
corepack pnpm turbo run typecheck lint test --filter=...@edmate/db --filter=...@edmate/harness --force --concurrency=1
  @edmate/db:test       Test Files 37 passed (37)
  @edmate/harness:test  Test Files 94 passed (94)
  @edmate/worker:test   Test Files 13 passed | 3 skipped (16)
  @edmate/web:test      Test Files 8 passed (8)
  (queue, gateway, content, ingest, evals, cli also green)
  Tasks: 38 successful, 38 total
python3 .githooks/secret-scan.py --all   → clean (no output, exit 0)
```

The first gate run hit one failure in `test/migrate.int.test.ts` ("store and read rows":
`updatedAt` from the database 8 ms behind the JavaScript clock), a test this task does not touch.
The rerun was green. It is a clock-skew flake, noted here for a board task.

### Deviations

- No Unicode term raised before the fix: `queryTerms` keeps only `\p{L}\p{N}`, and a sweep of every
  code point on Postgres 16 found only separators and tsquery operators raise, none of which a term
  can hold. The quoting is defence in depth, so the "red" test is the missing `tsTerm` and the
  unquoted `ftsQuery`, not a raising query.
- Audit rule 4 also allowlists `packages/contracts/src/ports.ts` (the port interface declares
  `leakCheck(`). Rule 5 also allows the harness's test-only helpers in `src/testing/`
  (`memoryRetrieval`, `testSteps`, `hostileRetrieval`, `retrievalContract`) by name; any new file
  fails. Rule 5 tells the index's `search(q, scope, k)` from `String#search` and the scoped
  wrapper's `search(q, k)` by argument count.
- The candidate caps are measured from the 16 KB skill-payload limit (the largest text the harness
  checks in one call), not from `turnTextMaxLength`.
- The property also checks leakCheck under each resolved entitlement (not in the plan).

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

### 20 Oct 2026 · 5.4 leakCache keyed by teacher, material revision and owned allowed ids · decided by tdd-guide · risk: high
Decided: leakCheck reads the revision and the teacher's module ids together, and keys and builds the locked index only on the allowed ids the teacher owns. Foreign, unknown and repeated ids drop out, so every list with the same owned set shares one cache entry. A module added between the reads counts as locked. A failed ids read fails closed.
Why: the lead's Q1 answer. A package version decides access only through its owned allowed set, so this key changes whenever access changes, which meets ADR-0003 point 6 without a contracts change. It also stops junk ids from filling the 64-entry cache (the 5.3 MEDIUM).

### 20 Oct 2026 · 5.4 leakCheck candidate caps · decided by tdd-guide · risk: medium
Decided: at most 2,048 candidates of 65,536 characters each; more is `invalid` before any SQL.
Why: the largest legitimate batches measured from the harness (one 16 KB text: a 16,383-character candidate; split by a 4,000-character student message: about 220 candidates) with at least 4x headroom. The test fails if the harness ever produces a batch over a quarter of the caps.

### 20 Oct 2026 · 5.4 Full-text terms quoted in to_tsquery · decided by tdd-guide · risk: low
Decided: every term goes to `to_tsquery` as a quoted literal (`'term':*`).
Why: Q4 fold-in. A sweep of every code point on Postgres 16 shows the quoted form never raises, whatever the term filter lets through later. Matching is unchanged; the recall gate is still green.

### 20 Oct 2026 · 5.4 Static no-unfiltered-search audit allowlists · decided by tdd-guide · risk: high
Decided: `test/access-audit.test.ts` pins five rules with named allowlists. The `chunks` table is named only in the schema, `internal.ts` and the chunks/retrieval repositories. `retrieval.ts` reads it exactly 5 times, each read scoped. Only `retrieval.ts` calls `.material(` (the lead's Q2). Only db `retrieval.ts`, three harness testing helpers and the port declaration implement `RetrievalIndex`. Harness search, probe and leakCheck calls happen only in `access/scopedRetrieval.ts` and `guardrails/lockedLeak.ts`, plus the testing helpers named in the allowlist.
Why: the acceptance requires that no unfiltered search exists anywhere. Any new read path fails CI until a reviewer adds it to an allowlist.

### 20 Oct 2026 · 5.4 Postgres property sizes and seeds · decided by tdd-guide · risk: low
Decided: seeds 20261020 (300 random scopes) and 20261022 (20 package versions, each resolved through preview and eval, 5 searches each). Both print a tally and assert minimum counts, so neither can pass with nothing checked.
Why: the plan's 300 iterations. The run takes about 3 s.
