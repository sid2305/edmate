# Task 5.4: Access filter (filtered `search`, code-only `probe`, entitlement-filtered tool registry, package-versioned caches)

Board: milestone M5 · deps `5.3`, `M3` · branch `m5/5.4-access-filter` · **risky** (`packages/harness/src/access/**`, `packages/db/src/repositories/**`). Two phases (two packages), one fresh builder each.

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Access filter: filtered `search`, code-only `probe`, entitlement-filtered tool registry, package-versioned caches"
Accept: "property test (random entitlements → results ⊆ allowed modules); `probe` never returns text; no unfiltered search exists anywhere."

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| Property, harness (any index) | `packages/harness/src/access/retrieval.property.test.ts`: seeded PRNG (`testing/prng.ts`, no fast-check, 1.2 decision), 2,000 iterations. Each one builds a random world and a random valid entitlement, then picks an honest, widening or text-leaking index. Asserts that `scopedRetrieval(...).search` and `buildContext` return only chunks of the entitlement's teacher in `allowedModuleIds`, or fail closed with `RetrievalScopeError`. Prints the seed and a tally of outcomes. |
| Property, whole turn | `packages/harness/src/access/turn.property.test.ts`: 200 full turns through the runner with the scripted gateway and a spy. No `ModelRequest` (system, messages, tools) holds the marker of any chunk outside the allowed modules. Every offered tool's skill is in `entitlement.skills`. |
| Property, Postgres (random entitlements) | `packages/db/test/access-property.int.test.ts`, 300 iterations: (a) random allowed subsets, foreign ids included, plus random queries (unusual Unicode included). `retrievalIndexFor(...).search` results are within allowed ∩ owned by the teacher. (b) Random package versions are resolved through `entitlementStoreFor` (eval and preview sources). The search results are within `pkg.moduleIds`. |
| `probe` never returns text | Type: the contract already returns `{ hit, score }`. Runtime, harness: `probeLocked` builds a fresh `{ hit: raw.hit === true, score: finite and clamped }`, so an index that adds `text` or a marker passes none of it on (unit case and property). Runtime, db: in the property, `Object.keys(probe)` equals `['hit','score']`, the types are right, and the JSON has no marker. |
| No unfiltered search anywhere | `packages/db/test/access-audit.test.ts` (static, no database) scans `packages/*/src` and `apps/*/{src,app}`. See Phase B for the rules. A type test with `@ts-expect-error` shows that `RetrievalIndex.search` without a scope does not compile. |
| Entitlement-filtered tool registry | The filter moves to `access/tools.ts` and is covered by the whole-turn property and by `access/tools.property.test.ts`: random registries × entitlements, so policy tools and offered tools stay within the entitled skills; duplicates fail closed; a model `tool_call` naming an unentitled tool is never run. |
| Package-versioned caches | Inventory: there are two caches, both tested. (1) `promptCacheKey` (pedagogy): pkg id and version are in the key; the existing test is kept and the turn property adds a version-only change. (2) db `leakCache`: the key becomes (teacher, material revision, sorted **owned** allowed ids). Test: leakCheck is warmed under package v1 (allowed {m1,m2}); v2 drops m2; the m2 span then hits on v2 without re-creating the adapter. See Q1. |
| No contracts change | `git diff origin/main -- packages/contracts` is empty. |
| No model calls | Scripted gateway, spy gateway, the scripted embedder from `retrieval-seed.ts`. |

## Spec it must honour

- Build plan § Access filter 1–9 and ADR-0003 (points 2, 3, 5, 6, 9). ADR-0007 (leakCheck: fail closed, never logs, cache key includes the material revision). Turn pipeline step 6 (fallback → `ask_teacher`).
- Rule 3: harness imports only contracts, zod, mathjs and its own modules. The harness tsconfig has `types: []` (no Node), so the static audit lives in `packages/db/test`.
- `packages/db/src/repositories/README.md` rules (scope first, validated before SQL, no `sql.raw(`, scrubbed errors, isolation `CASES`).
- Already built and kept: the server-side entitlement (3.2, `access/entitlement.ts`, with an entitle property test); the tool seam (3.7, `pipeline/tools.ts`: checked in decide and again in generate); `buildContext.checkScope` (3.4); the db filters (5.3). 5.4 consolidates these into `access/` and proves them. It does not redesign them.

## Design

1. **`access/scopedRetrieval.ts`.** `scopedRetrieval(index: RetrievalIndex, e: Entitlement)` returns `{ search(q, k), probeLocked(q) }` with the scope fixed from `e`.
   - search: an empty query or an empty allowed list returns `[]` without calling the index. Otherwise it calls `index.search(q, { teacherId, allowedModuleIds: dedup(allowed) }, k)`, then re-checks every chunk: right teacher, module in allowed, module not in locked. One stray chunk throws `RetrievalScopeError`; the error names ids only. The result is sliced to k and the chunks are copied.
   - probeLocked: with no locked modules or an empty query, it returns `{ hit: false, score: 0 }` and makes no call. Otherwise it returns a fresh object, `{ hit: r?.hit === true, score: clamp01(finite(r?.score) ?? 0) }`.
   - `RetrievalScopeError` and `checkScope` move here from `buildContext`, which re-exports the error.
2. **`access/tools.ts`.** `entitledTools`, `policyTools`, `offeredTools` and `DuplicateToolError` move here from `pipeline/tools.ts`, unchanged. `pipeline/tools.ts` keeps `ToolRegistry`, `RegisteredTool`, `noTools` and `toolSpec`, and re-exports the moved names, so imports don't churn. `access/tools.ts` imports from `pipeline/tools.ts` as types only (no runtime cycle).
3. **The cache rule** (a doc comment in `access/index.ts` and the db README). A cache that holds anything derived from teacher material or an entitlement is keyed by everything that decides access: the package id and version, or the exact owned allowed-module set, plus the material revision for material. The cache inventory is the two caches listed above. No new cache is added.
4. **db, folded in from 5.3a** (see Q4):
   - the leakCache key uses allowed ids ∩ owned. `repos.modules.ids` is read in parallel with the revision.
   - `CandidatesSchema` gets a `.max()` on count and length, derived from the harness's largest legitimate batch with at least 4× headroom, and a test shows a maximal legitimate batch still passes.
   - `to_tsquery` gets quoted terms (or `plainto`/`phraseto` with prefix), so unusual Unicode can't raise.

## Phase A: harness access filter (`packages/harness`)

- **Create:** `src/access/scopedRetrieval.ts`, `src/access/tools.ts`, `src/access/scopedRetrieval.test.ts` (with the `@ts-expect-error` type cases), `src/access/tools.property.test.ts`, `src/access/retrieval.property.test.ts`, `src/access/turn.property.test.ts`, `src/testing/hostileRetrieval.ts` (widening, text-leaking and junk-probe wrappers over `memoryRetrieval`; exported from `testing/index.ts`).
- **Modify:** `src/access/index.ts` (exports and the cache-rule comment), `src/pipeline/tools.ts` (re-exports), `src/pipeline/steps/buildContext.ts` (uses `scopedRetrieval`; behaviour unchanged), `src/pipeline/index.ts`, `src/testing/index.ts`. Move the moved functions' cases from `src/pipeline/tools.test.ts` into `access/` (or leave them, since they still import through the re-exports).
- **Tests first:**
  - scopedRetrieval: a widening index → throws; another teacher's chunk → throws; a locked-module chunk → throws; k is honoured; empty allowed → no call; a probe with `text`/extra keys/NaN/string `hit` → `{hit:false|true, score}` only; no locked ids → no probe call.
  - Then the three property tests.
  - The existing `buildContext.test.ts`, `property.test.ts` and `tools.test.ts` pass unchanged.
- **Gate:** `turbo run typecheck lint test --filter=...@edmate/harness` (dependents: db, web, worker).
- **State after:** the harness access filter is consolidated and the harness half of the acceptance is proven. Green commit. About 12 files and about 100 tool calls.

## Phase B: Postgres property, static audit, cache key (`packages/db`)

- **Create:**
  - `test/access-property.int.test.ts`: reuses `test/retrieval-seed.ts` and the helpers. Builds a three-teacher world with a unique marker per chunk, then runs the random allowed sets, the random queries, the package versions through `entitlementStoreFor` and the probe checks.
  - `test/access-audit.test.ts`: the static rules, with an allowlist of files.
- **The audit's rules:**
  1. The `chunks` table (as an import from the schema, or as SQL text `from|join chunks`) appears only in `db/src/schema/**`, `db/src/internal.ts` and `db/src/repositories/{chunks,retrieval}.ts`, plus any seed file the builder finds (list it).
  2. The number of `.from(chunks)` and `${chunks}` reads in `retrieval.ts` is pinned, so any new read fails the audit until it is reviewed. Each one sits in a statement that carries `scope`/`scoped(`/`chunks.teacherId`.
  3. `.material(` is called only in `retrieval.ts`.
  4. Only allowlisted files implement `RetrievalIndex`: db `retrieval.ts`, harness `testing/{memoryRetrieval,testSteps,hostileRetrieval}.ts`.
  5. In harness `src`, `.search(`/`.probe(` on a `RetrievalIndex` appear only in `access/scopedRetrieval.ts`, and `.leakCheck(` only in `guardrails/lockedLeak.ts`. Test files are excluded.
- **Modify:** `src/repositories/retrieval.ts` (the owned-intersect key, `CandidatesSchema.max`, the tsquery quoting), `src/repositories/leakCache.ts` (only if the key function changes), `src/repositories/README.md` (the cache rule and the audit), plus `test/retrieval-leak.int.test.ts` and `test/retrieval.int.test.ts` (version-bump cache case, max batch, Unicode terms).
- **Tests first:** the audit (green on main is expected; prove it can fail with a fixture string for each rule); the Unicode term that raises today (red); the v1 → v2 cache case; the foreign-id key sharing the owned key; then the property test.
- **Gate:** `turbo run typecheck lint test --filter=...@edmate/db --force --concurrency=1` with Postgres up, plus the secret scan. The leakCheck SLO must still hold with the extra `modules.ids` read.
- **State after:** acceptance met. About 7 files and about 90 tool calls.

## Files out of bounds

- `packages/contracts/**` and `docs/adr/**` (no port change; see Q1).
- `packages/harness/src/guardrails/**`, including `lockedLeak.ts` (it already scopes from the entitlement; the audit only reads it).
- `packages/harness/src/pedagogy/**` (`promptCacheKey` and the compose skills list are unchanged).
- 5.5's real tools and calculator.
- The rest of 5.3a: HNSW query rewrite, IDF batching, the script's Node note, recalibration, the out-of-course set.
- 5.3b; the locked eval suite (7.x); composition-root wiring in `apps/*`; any delete path.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)

- `packages/harness/src/access/**` (scopedRetrieval.ts, tools.ts, index.ts, and the tests there): group "access filter / money / isolation" → **security-reviewer**.
- `packages/db/src/repositories/**` (retrieval.ts, leakCache.ts, README.md): same group → **security-reviewer**.
- Not risky: `packages/harness/src/{pipeline,testing}/**`, `packages/db/test/**`. No contracts, ADR, guardrails, pedagogy, `.claude` or `.github` path is touched.
- Planned handoff decision: "5.4 Access filter consolidated in harness/access (scoped retrieval, tool filter); leakCache keyed by owned allowed set and material revision; static no-unfiltered-search audit · risk: high". `review.md` names security-reviewer and code-reviewer.

## Decisions (draft, for the handoff)

- The static audit lives in `packages/db/test` (planner, low). Harness has no Node types. CI runs turbo without a cache, so it runs every time.
- Property iterations (planner, low): harness 2,000 index-level and 200 full turns; Postgres 300.
- The tool filter moves into `access/` with re-exports (planner, medium; Q3).

## Open questions (each with a recommendation)

- **Q1. ADR-0003 point 6 says "caches keyed by package version".** leakCheck's port scope has no package version, and adding one is a contracts change plus an ADR. Recommend: key leakCache on (teacher, material revision, owned allowed set). That is keyed by exactly what a package version controls and is strictly finer. Log it `risk: high`; no ADR.
- **Q2. `retrieval.material(scope)` returns all of a teacher's text, locked included, on the public `Repositories` surface.** Recommend: keep it, and pin it with audit rule 3 (only `retrieval.ts` calls it). Alternative: move it off the public surface, which means more churn in the isolation grid.
- **Q3. Move the skill filter from `pipeline/tools.ts` into `access/`,** so security-reviewer covers it. Recommend: yes, with re-exports. Start 5.5 after Phase A merges to avoid a conflict in `tools.ts`.
- **Q4. 5.3a fold-ins.** Recommend that 5.4 owns three items: the owned-ids cache key (closes the leakCache memory MEDIUM), `CandidatesSchema.max()`, and the `to_tsquery` Unicode robustness (the Postgres property fuzzes queries). The lead trims 5.3a's title to the rest.

## Lead answers (20 Oct 2026)
- **Q1:** accepted. leakCache is keyed on (teacher, material revision, owned allowed ids). Everything a package version changes shows up in those keys, so this meets ADR-0003's "package-versioned caches" without an ADR. The builder logs it as a `risk: high` decision.
- **Q2:** keep `retrieval.material` on the Repositories surface. The static audit must fail if anything other than `retrieval.ts` calls it.
- **Q3:** accepted. The tool filter moves into `access/`, and 5.5 starts only after Phase A merges.
- **Q4:** accepted. 5.4 takes the owned-ids cache key, `CandidatesSchema.max()` and the `to_tsquery` Unicode fix. 5.3a keeps the rest.
