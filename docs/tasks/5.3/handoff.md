# Task 5.3 handoff: retrieval index (Phase A)

- **Status:** PARTIAL (Phase A done; Phases B–D left)
- **Branch:** `m5/5.3-retrieval-index` (built on local `build-5.3a`, pushed without force)
- **Worktree:** `.claude/worktrees/agent-a1d87b646b89373e2`
- **Plan:** `docs/tasks/5.3/plan.md` (with the lead's answers of 20 Oct 2026)

## What Phase A delivers

`packages/db` can now store, embed and rank a teacher's chunks:

- `documents.create`, `chunks.insertMany` and `chunks.setEmbeddings` (`src/repositories/chunks.ts`). Each one checks ownership in the same statement, and each bumps the teacher's material revision in the same transaction.
- Migration `0012_material_revision.sql` adds a new table, `teacher_material_revisions`. It only adds.
- `retrieval.search`, `retrieval.probe` and `retrieval.revision` (`src/repositories/retrieval.ts`). Search runs full text and vector search, each filtered by teacher, allowed module and module ownership in the WHERE clause, before ranking. The two result lists are merged by reciprocal-rank fusion (k = 60, ties broken by id). Matching teacher notes come first. Each chunk gets a 0–1 score.
- `retrievalIndexFor(repos, opts)` is the production `RetrievalIndex`. If the embedder fails, times out or returns a bad vector, search falls back to full text only. `leakCheck` is a fail-closed stub that always returns `{ hit: true }`.

## Acceptance evidence (Phase A)

| Item | Command → trimmed output |
|---|---|
| Gate | `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db --force --concurrency=1` → `Tasks: 14 successful, 14 total` |
| db tests | `@edmate/db:test: Test Files 28 passed (28)`, `Tests 533 passed (533)` (30 new in `retrieval.int.test.ts`; 6 new methods in the isolation grid) |
| Coverage of new code | `chunks.ts 100 / 100 / 100 / 100`, `retrieval.ts 100 / 100 / 100 / 100` (stmts / branch / funcs / lines); `src/repositories/**` threshold (100% lines and statements) met |
| Dependents | `@edmate/web: Tests 132 passed`, `@edmate/worker: Tests 121 passed, 10 skipped` |
| Teacher and module isolation | `retrieval.int.test.ts` "returns only the teacher's chunks in allowed modules; a foreign module id is ignored", "another teacher naming A's modules gets nothing", "another teacher's modules never hit"; `repositories.int.test.ts` grid cases for `documents.create`, `chunks.insertMany`, `chunks.setEmbeddings`, `retrieval.search`, `retrieval.probe`, `retrieval.revision` (snapshot covers `teacher_material_revisions`, so a failed write never bumps it) |
| Scope checked before SQL | "scope and arguments are checked before any SQL" (repositories over a handle that throws on any use: every bad scope is `scope`, bad args `invalid`, never `failed`); the port rejects a malformed scope before embedding (embed calls = 0) |
| Teacher notes first | "a matching teacher note comes first even when a material chunk scores higher" (full text only and hybrid) |
| Hybrid | "hybrid returns both a vector-only and a full-text-only chunk"; deterministic order, ties by id (SQL and fused rank) |
| Score 0–1 | every result parses as a contract `Chunk` with `0 ≤ score ≤ 1` |
| Full-text fallback | embedder throws / hangs (50 ms timeout) / returns a bad or no vector → same ids as no embedder; `onEmbedFallback` gets only `embed_failed` / `embed_timeout` / `embed_invalid` |
| probe | keys are exactly `hit`, `score`; another teacher's modules → `{ hit: false, score: 0 }` |
| Writes bump the revision | "every write bumps the teacher's material revision; failed writes and other teachers do not" |
| No existence oracle | another teacher's module, a missing module and a document id taken by another teacher are all `not_found` and write nothing; a mixed `setEmbeddings` batch rolls back as a whole |
| Tagged teacher → course → module | raw join chunks → documents → modules → courses: 0 rows disagree on teacher, module, kind or source title |
| Driver errors scrubbed | closed pool → `RepositoryError('failed')` for `retrieval.search` / `retrieval.probe` whose chain carries no query text, module id or teacher id |
| No contracts change | `git diff origin/main --stat -- packages/contracts` → empty |
| No model calls | embeddings come from `test/retrieval-seed.ts`'s scripted keyword-axis embedder; no API key is read |
| Secret scan | `python3 .githooks/secret-scan.py --all` → clean |

Local run note: the integration suites need the test port override, `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`. Without it they skip locally.

## Changes

- New: `packages/db/src/repositories/chunks.ts`, `packages/db/src/repositories/retrieval.ts`, `packages/db/migrations/0012_material_revision.sql` and `meta/0012_snapshot.json` (from `drizzle-kit generate`), `packages/db/test/retrieval.int.test.ts`, `packages/db/test/retrieval-seed.ts`.
- Changed:
  - `src/schema/content.ts` and `src/schema/index.ts`: the `teacherMaterialRevisions` table.
  - `src/repositories/index.ts`: the `documents`, `chunks` and `retrieval` repositories, all wrapped by `guardAll`, plus exports.
  - `src/repositories/ports.ts`: re-exports `retrievalIndexFor`.
  - `src/repositories/README.md`: new "Retrieval" section and the revision rule.
  - `test/repositories.int.test.ts`: 6 new `CASES`, plus one isolation document and chunk per teacher.
  - `test/helpers.ts`: the new table added to `DATA_MODEL_TABLES`.
  - `migrations/meta/_journal.json`.

## Deviations from the plan

1. **The revision table has a text `id` primary key plus a unique index on `teacher_id`,** where the plan had `teacher_id` as the primary key. `schema.test.ts` requires every table to have a text `id` primary key. The upsert targets the unique index.
2. **Search and probe are a `retrieval` repository, and `retrievalIndexFor` takes `Repositories`, not `db`.** The raw Drizzle handle is not exported from `@edmate/db`, so this keeps the composition root on the public surface. It also means the methods get `guarded()` scrubbing and isolation `CASES` like every other method.
3. **New method `retrieval.revision(scope)`.** Phase B's cache key needs it, and the revision tests use it.
4. **Options are named `embedder` (a `Pick<ModelGateway, 'embed'>`), `embedTimeoutMs` (800 ms default) and `onEmbedFallback(code)`.** The last one is the plan's "fixed-code counter", done as a callback; a callback that throws is ignored. `leakTimeoutMs` comes in Phase B, together with the real leakCheck.
5. **Full-text score.** The plan said `ts_rank_cd(search, q, 32)`. The code takes raw `ts_rank_cd` and maps it to `raw / (raw + 0.05)`. Flag 32 is the same curve with the half point fixed at 1, and that point is far above the raw values here (about 0.1 per match). With flag 32, a single-term match scored about 0.09, which made every full-text-only probe a miss at a 0.5 floor.
6. `setEmbeddings` also bumps the revision, following the plan's "each write bumps". Embeddings don't change text, so this costs at most one extra cache rebuild after indexing.
7. `test/helpers.ts` is not in Phase A's file list. It had to change because `DATA_MODEL_TABLES` must list every schema table.

## Left to do

- **Phase B:** leakCheck with an LRU cache keyed by `teacherId | revision | owned allowed ids`, built with `lockedIndex` from `@edmate/harness` (which moves to `dependencies`). It needs `leakTimeoutMs` (fail closed) and a background cold build. Also the shared contract list `packages/harness/src/testing/retrievalContract.ts`, run by `memoryRetrieval.test.ts` and by `packages/db/test/retrieval-leak.int.test.ts` (fail-closed injections, no logging, SLO p95 ≤ 50 ms / p99 ≤ 100 ms, cache cleared on a revision bump).
- **Phase C:** in `packages/ingest`: the chunker (≤ 300 words, never crosses a unit, no overlap, heading kept on the first chunk), `indexDocument` (embed batches of 96, failure leaves NULL embeddings) and the hashed test embedder. Read `docs/tasks/5.1/handoff.md` on main first.
- **Phase D:** the recall test on the demo Q&A set (heading-level gold, about 30 in-course items plus about 8 out-of-course items marked `reviewed_by: pending`, per Q1). Calibrate `TEXT_HALF`, `VECTOR_ZERO`, `NOTE_MATCH_FLOOR`, `PROBE_FLOOR` and `coverageThreshold` (Q3 = yes, code-reviewer, `risk: high`). The "with embeddings" assertion waits on B-24 (Q2).
- **For Phase B/D to check:** HNSW with WHERE filters filters after the index scan (ef_search 40), so a large teacher with a small allowed set could get fewer than 20 vector candidates. pgvector 0.8's `hnsw.iterative_scan` (set per transaction) is the likely fix. The demo corpus is far below the point where this shows.

## Decisions

### 5.3 Production RetrievalIndex search/probe and chunk writes in `packages/db/src/repositories`, ownership-checked, material revision bumped in the same transaction · risk: high
Writes use `INSERT … SELECT` from the owner row (documents from `modules`; chunks from `documents` joined to `modules`), plus a scoped all-or-nothing `UPDATE` for embeddings. Search and probe filter by teacher, allowed modules and module ownership in the same statement, before ranking. These are new access paths for teacher material, so security-reviewer is required (risk group "access filter"). leakCheck stays `{ hit: true }` until Phase B.

### Search and probe are a guarded `retrieval` repository; `retrievalIndexFor(repos, opts)` adapts it · risk: high
The plan had `retrievalIndexFor(db, …)`. It now takes repositories, so every method gets `guarded()` driver-error scrubbing and isolation `CASES`, and nothing outside `@edmate/db/internal` needs a raw handle. Adds `retrieval.revision(scope)`.

### A "matching" teacher note is one found by full text, or by vector with score ≥ 0.5 · risk: high
In hybrid mode the vector side always returns its top 20, so an unrelated note would otherwise jump to the top. This is provisional; Phase D calibrates the 0.5.

### Revision table keeps the repo's `id` primary key, unique on `teacher_id`
The schema test requires a text `id` primary key on every table. Additive migration 0012.

### Provisional score calibration
Full text: `raw / (raw + 0.05)` over `ts_rank_cd`. Vector: cosine similarity, clamped to 0–1. `PROBE_FLOOR` = 0.5. All are placeholders until Phase D measures the demo set.

### A taken document id is `not_found`, a repeated chunk `ord` is `invalid`
Document ids are global and chosen by the caller, so `not_found` gives no existence oracle. Chunk ids come from a document the teacher already owns, so a duplicate is the teacher's own conflict.
