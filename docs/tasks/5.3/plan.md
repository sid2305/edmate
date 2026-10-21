# Task 5.3: Chunking, embeddings, full-text fallback, hybrid ranking, production RetrievalIndex

Board: milestone M5 · deps `1.8`, `5.1`, `M3` · branch `m5/5.3-retrieval-index` · **risky** (`packages/db/src/repositories/**`, plus `packages/harness/src/pedagogy/**` in Phase D if Q3 is approved).

## Acceptance (verbatim, `docs/board/tasks.yaml`)

Title: "Chunking, embeddings, full-text fallback, hybrid ranking with teacher notes first; chunks tagged teacher → course → module"
Accept: "recall@5 ≥ 0.8 on the demo Q&A set, with and without embeddings; the production RetrievalIndex implements leakCheck (ADR-0007) with shared contract tests: fails closed, never logs candidates, checks the teacher owns the modules, meets the p95 ≤ 50 ms / p99 ≤ 100 ms SLO, and clears its cache on a material revision."

### How it is shown (paste into handoff.md)

| Item | Evidence |
|---|---|
| recall@5 ≥ 0.8, without embeddings | `packages/db/test/recall.int.test.ts`, "full text only": the adapter has no embedder, chunk embeddings are NULL; prints and asserts hits/total per item. |
| recall@5 ≥ 0.8, with embeddings | Same file, "hybrid": embedder from the fixture vectors (Q2); asserts ≥ 0.8 again. |
| The demo Q&A set | `content/demo-teacher/qa-recall.yaml` (task 1.8; it already exists). Note: 5.6 is the practice skill, not the demo course, so nothing here waits on 5.6. Scope for recall = every demo module (teacher preview), so recall measures ranking, not access. |
| Hybrid, teacher notes first | `retrieval.int.test.ts`: a `teacher_note` chunk that matches outranks a better-scoring `material` chunk; FTS-only and vector-only rows both come back; RRF order is deterministic (ties by id). |
| Tagged teacher → course → module | `retrieval.int.test.ts`: every written chunk joins `modules` → `courses` with the same `teacher_id`; a write naming another teacher's document or module is `not_found`. |
| leakCheck shared contract tests | `packages/harness/src/testing/retrievalContract.ts` (case list, no vitest import); run by `memoryRetrieval.test.ts` and `packages/db/test/retrieval-leak.int.test.ts` against the same world. |
| Fails closed | Contract cases: db error, adapter timeout, closed pool → `{ hit: true }`; malformed scope or candidates → rejection (ADR-0007 points 4–5). |
| Never logs candidates | Contract case spies `console.*`, `process.stdout/stderr.write`; asserts no candidate substring appears in any output, error message or error cause, on success and failure paths. |
| Checks the teacher owns the modules | Contract cases: allowed ids of another teacher do not widen the allowed set; another teacher's material never hits; missing `teacherId` rejects. |
| SLO | `retrieval-leak.int.test.ts`, "SLO": warm cache, 8,000-char batch, 300 calls on a corpus of 10× the demo course; asserts p95 ≤ 50 ms and p99 ≤ 100 ms measured at the adapter (includes the revision round trip). |
| Cache cleared on material revision | Same file: hit=false → insert a locked chunk containing the span (bumps revision) → hit=true without re-creating the adapter; same for `setEmbeddings`-free edits. |
| No contracts change | `git diff main -- packages/contracts` is empty. |
| No real model calls | Embedding in tests uses `ScriptedGateway`, the hashed test embedder or the recorded fixture; no API key read in tests. |

## Spec it must honour

- Build plan § Access filter 2: `search` applies `teacher_id = $1 AND module_id = ANY($2)` in SQL **before** ranking; no unfiltered search anywhere. § Ingestion 4: chunks tagged teacher → course → module; embeddings plus full-text; hybrid ranking. § Staying true: a `teacher_note` chunk is "ranked first".
- ADR-0003 (probe returns only `{ hit, score }`), ADR-0007 (leakCheck: one boolean, complement scope, shared matcher `lockedIndex` from `@edmate/harness`, ownership, never logs, fails closed, SLO, cache key includes the material revision).
- `packages/db/src/repositories/README.md` rules 1–10 (scope first, validated before SQL, scope in the same statement, no `sql.raw(`, scrubbed errors, isolation `CASES`). The README already says "RetrievalIndex 5.3 / 5.4 … must add their isolation cases here".
- Schema already in place (task 1.1/2.7): `chunks` with `vector(1536)` HNSW cosine index and generated `tsvector('simple')` GIN index. Gateway `EMBEDDING_CONFIG` = `text-embedding-3-small`, 1536 dims.
- Decision 18 Oct (3.5 Q2): coverage threshold 0.5 on a 0–1 scale is provisional; "5.3 calibrates the default on the demo Q&A set". So `Chunk.score` must be an absolute 0–1 relevance, not a raw RRF value.
- Rule 3: `packages/harness` changes here are limited to `src/testing/` (pure TS, no vitest import).

## Design (short)

1. **Writes** (`packages/db/src/repositories/chunks.ts`): `documents.create(scope, {id, moduleId, kind, sourceTitle, storageKey?})` via `INSERT … SELECT FROM modules WHERE id=$m AND teacher_id=$t`; `chunks.insertMany(scope, documentId, drafts)` via `INSERT … SELECT FROM documents WHERE id=$d AND teacher_id=$t` (module and kind come from the document, so a chunk can't be filed under another teacher's module); `chunks.setEmbeddings(scope, [{id, embedding}])` checks length 1536 and finiteness before SQL. Each write bumps the teacher's material revision in the same transaction.
2. **Material revision**: additive migration `0012_material_revision.sql`: table `teacher_material_revisions(teacher_id pk → users, revision bigint not null default 0, updated_at)`; `UPDATE … SET revision = revision + 1` (upsert). Future delete paths (8.x, 13.4) must bump it; noted in the README.
3. **search** (`packages/db/src/repositories/retrieval.ts`, `retrievalIndexFor(db, { embed?, embedTimeoutMs = 800, leakTimeoutMs = 100 })`): one SQL statement per signal, both filtered by teacher and `module_id = ANY($allowed) AND module_id IN (SELECT id FROM modules WHERE teacher_id=$t)`.
   - Full text: OR of the query's terms with prefix match (`to_tsquery('simple', 'term:* | …')`, terms built from a word regex and passed as parameters, a short fixed English stop-word list in code), `ts_rank_cd(search, q, 32)`; top 20.
   - Vector (only when `embed` exists and returns in time and the row has an embedding): `1 - (embedding <=> $v)`; top 20.
   - Fuse by reciprocal rank (k = 60), then a stable partition: matching `teacher_note` chunks first, then the rest; return top k with `score` = calibrated 0–1 relevance (`max(textScore, vecScore)` mapped by constants set in Phase D), never the RRF number.
   - Embed failure or timeout → full-text only (that is the "fallback"); the error is dropped silently except a fixed-code counter, no query text logged.
4. **probe**: the same ranking over `scope.moduleIds` (owned by the teacher), returns only `{ hit, score }` of the best chunk; `hit = score ≥ PROBE_FLOOR` (constant, Phase D calibrates).
5. **leakCheck** (Phase B): validate scope and candidates (reject like the memory adapter), read the revision, look up an LRU cache (max 64 entries) keyed `teacherId | revision | sorted owned allowed ids`; on miss load the teacher's chunk text grouped by module in `(document_id, ord)` order, split into allowed (owned ∩ allowed) and outside, build `lockedIndex(outside, inside)`. The whole call races `leakTimeoutMs`; timeout or any error → `{ hit: true }`. A cold build keeps running in the background so the next call is warm. No logger is injected; errors carry a fixed code only.
6. **Chunker** (Phase C, `packages/ingest/src/chunk/chunker.ts`): `ParsedUnit[]` (5.1) → `ChunkDraft { text, locator, ord }`: never crosses a unit (so the locator stays exact), splits at paragraph then sentence to ≤ 300 words, no overlap (overlap would make the module text that leakCheck joins differ from the source). The first chunk of a Markdown section keeps its heading line verbatim, which helps full-text recall and is still source text. Chunks need an `ord` column? No: `chunks.id` is ordered `<documentId>-<ord padded>`; decision below.
7. **indexDocument** (Phase C, `packages/ingest/src/index/indexDocument.ts`): parse → chunk → `writer.insertMany` → embed in batches of 96 through a `Pick<ModelGateway, 'embed'>` → `writer.setEmbeddings`. Embedding failure leaves NULL embeddings and returns `{ chunks: n, embedded: false }` (FTS still finds them). `ChunkWriter` is a local structural interface in ingest that `@edmate/db`'s repository satisfies; ingest does not import db.

## Phase A: Postgres writes, search and probe (`packages/db`, can start before 5.1 merges)

- **Create:** `src/repositories/chunks.ts`, `src/repositories/retrieval.ts` (search, probe; `leakCheck` returns `{ hit: true }` always until Phase B, so the adapter is safe if wired early), `migrations/0012_material_revision.sql` + `meta/0012_snapshot.json` (via `db:generate`), `test/retrieval.int.test.ts`, `test/retrieval-seed.ts` (synthetic world: two teachers, allowed/locked/draft modules, material + teacher notes, a scripted embedder).
- **Modify:** `src/schema/content.ts` (revision table), `src/repositories/index.ts`, `src/repositories/ports.ts` (export `retrievalIndexFor`), `src/repositories/README.md` (retrieval section, revision rule), `test/repositories.int.test.ts` (`CASES` for the new methods), `src/index.ts`.
- **Tests first:** scope rejects before SQL; search never returns another teacher's or a non-allowed module's chunk (including a module id that exists for another teacher); an allowed id the teacher doesn't own is ignored; teacher note first; FTS-only path when embed throws/times out; `score` in [0,1]; probe keys are exactly `hit`,`score`; writes bump the revision; ownership `not_found` without an existence oracle; driver errors scrubbed.
- **State after:** the db can store and rank chunks; leakCheck is a fail-closed stub. Green commit.

## Phase B: leakCheck, cache, shared contract tests (`packages/harness/src/testing`, `packages/db`)

- **Create:** `packages/harness/src/testing/retrievalContract.ts` (exported from `testing/index.ts`): a framework-free list `{ name, run(make: (world: Chunk[]) => Promise<RetrievalIndex>) }` covering ADR-0007 points 1–5 (one boolean, complement scope, draft/unpackaged modules count, allowed-duplicate ignored, cross-chunk span, other teacher never hits, foreign allowed ids don't widen, malformed scope rejects, no logging) and the search/probe scope cases. `packages/db/src/repositories/leakCache.ts`, `packages/db/test/retrieval-leak.int.test.ts` (contract cases, fail-closed injections, SLO, revision invalidation).
- **Modify:** `retrieval.ts` (real leakCheck), `packages/harness/src/testing/memoryRetrieval.test.ts` (also runs the contract list), `packages/db/package.json` (`@edmate/harness` moves to `dependencies` for `lockedIndex`; no cycle: harness does not depend on db).
- **Tests first:** the contract list against `memoryRetrieval` (must pass unchanged, proving the list matches ADR-0007), then against Postgres; fail-closed via a db stub that throws and one that hangs; SLO; revision bump clears the cache.
- **State after:** acceptance items "leakCheck … cache" are met. Green commit.

## Phase C: chunker and indexing pipeline (`packages/ingest`, needs 5.1 merged)

- First read `git show main:docs/tasks/5.1/handoff.md` (the planner could not; the plan assumes 5.1 plan's `ParsedUnit { text, locator }` / `ParsedDocument { sourceTitle, units }` and `parseMarkdown`). Adapt names, not behaviour.
- **Create:** `src/chunk/chunker.ts` (+ test), `src/index/indexDocument.ts` (+ test), `src/index/types.ts` (`ChunkDraft`, `ChunkWriter`), `src/testing/hashedEmbedder.ts` (deterministic 1536-dim hashed-trigram vectors, for unit tests only).
- **Modify:** `src/index.ts`, `package.json` (`@edmate/contracts` dependency; `@edmate/harness` devDependency for `ScriptedGateway`).
- **Tests first:** every draft keeps its unit's locator; no draft over 300 words; no text lost or duplicated (concatenation equals the input modulo whitespace); heading line kept on the first chunk; embed batching (97 texts → 2 calls); embed failure → NULL embeddings, `embedded: false`, nothing thrown; writer rejection propagates with a fixed code.
- **State after:** a document can be parsed, chunked, stored and embedded end to end in tests. Green commit.

## Phase D: recall gate and score calibration (`packages/db/test`, `content/demo-teacher`, maybe `pedagogy`)

- **Create:** `packages/db/test/recall.int.test.ts` (load demo content with `@edmate/content`, chunk notes with `@edmate/ingest` (devDependency of db), insert, run each item with k = 5, print a per-item table, assert ≥ 0.8 both ways); `packages/db/test/fixtures/demo-embeddings.json` (if Q2 = recorded); `packages/db/scripts/record-demo-embeddings.ts` (gated `--live`, refuses without the key, never run in CI).
- **Modify:** `content/demo-teacher/qa-recall.yaml` and `packages/content/src/schema.ts` + `rules.ts` (if Q1 = heading-level gold), `retrieval.ts` (calibration constants, with the measured distributions in a comment), `packages/harness/src/pedagogy/coverage.ts` default threshold (only if Q3 = yes).
- **Tests first:** the recall test (red), then tune: stop words, prefix terms, RRF k, calibration constants. Do not tune to individual items; if a fix only helps one question, stop and report. Calibrate on in-course vs ~8 out-of-course questions (so `score ≥ threshold` separates them).
- **State after:** acceptance met. If FTS-only recall is < 0.8 after reasonable tuning, report it; do not change the `'simple'` tsvector config (a migration and a locale decision) without asking.

## Files out of bounds

`packages/contracts/**` and `docs/adr/**` (no port change is needed); `packages/harness/src/{pipeline,guardrails,access}/**` (consumers stay as they are; `lockedIndex` is imported, not edited); 5.4's entitlement-filtered tool registry, package-versioned search caches and property test; the db seed (demo chunks in the seed come with the thin slice); document states and the upload centre (8.x); video (5.2); `CorrectionStore` and teacher-note writes from answers (5.10); composition-root wiring in `apps/*`; any chunk delete path.

## Risky paths touched

Checked every planned path against `.claude/skills/merge-gate/risk-paths.txt`:
- `packages/db/src/repositories/**` (`chunks.ts`, `retrieval.ts`, `leakCache.ts`, `index.ts`, `ports.ts`, `README.md`): group "access filter / keeping teachers' data apart" → **security-reviewer**.
- `packages/harness/src/pedagogy/coverage.ts` (Phase D, only if Q3 = yes): safety group → **code-reviewer** (MVP-first; logs `risk: high`).
- Not risky by path: `packages/db/src/schema/**`, `packages/db/migrations/**` (additive, no drop or delete, so no database-reviewer from the gate; recommended anyway), `packages/harness/src/testing/**`, `packages/ingest/**`, `packages/content/src/{schema,rules}.ts`, `content/demo-teacher/**`, `packages/db/test/**`.
- Planned handoff decision: "5.3 Production RetrievalIndex in `packages/db/src/repositories`, leakCheck per ADR-0007, cache keyed by material revision · risk: high", reviewers named in `review.md`: code-reviewer, security-reviewer (+ database-reviewer advisory for the migration).

## Decisions (draft, for the handoff)

- **No `course_id` on chunks** (planner, low): teacher → course → module is the `chunks.module_id → modules.course_id` chain, written through ownership-checked inserts; one course per teacher in the MVP. Reversible with an additive column.
- **Explicit material revision counter** (planner, medium) instead of `count/max(updated_at)`: exact under delete + insert and across processes; one extra indexed read per leakCheck.
- **`@edmate/db` depends on `@edmate/harness` at runtime** (planner, medium): ADR-0007 point 3 requires the real adapter to use the shared matcher.
- **Score = calibrated absolute relevance, not RRF** (planner, medium): RRF orders; the 0–1 score feeds `coverageThreshold`.
- **No chunk overlap; heading line kept on a section's first chunk** (planner, low).
- **Chunk order from ids** `<documentId>-c<0000>` (planner, low): avoids an `ord` column; leakCheck orders by id within a document.

## Risks

- **FTS recall with the `'simple'` config** (no stemming, no stop words): mitigated by prefix terms, a small stop-word list and the kept heading line; escalate rather than migrate.
- **SLO timing flake on CI** (see 4.3a): warm cache, 300 calls, percentiles not maxima, generous test timeout; the cold build is outside the measured window and fails closed if it overruns.
- **Cold-cache first call returns `hit: true`** for a large teacher: the turn falls back to the locked reply once; the background build makes the next call warm.
- **Recall overfitting** to an 18-item set (see Q1).

## Open questions for the human

- **Q1. Recall gold and set size.** The set has 18 items and gold at module level only; with 5 modules, "a top-5 chunk from the expected module" is a weak bar. Recommend: add `expectedLocator` (the notes heading that answers it) to each item, count a hit at heading level, report module level too, and add ~12 items (lead-signed) to reach 30 plus ~8 out-of-course questions for calibration.
- **Q2. Embeddings in the recall test.** No real calls in tests. Recommend: the human runs `record-demo-embeddings.ts --live` once with their OpenAI key (a few cents), committing ~1 MB of vectors for the demo notes and questions (open-licensed demo text, nothing secret); unit tests use the hashed embedder. If you'd rather not, the "with embeddings" run uses the hashed embedder, which proves the plumbing but not semantic recall, and a follow-up task records real vectors.
- **Q3. Calibrate `coverageThreshold` in `pedagogy/coverage.ts` here** (risky path, code-reviewer, `risk: high`)? Recommend yes: otherwise the thin teacher-upload/student-chat slice runs on an uncalibrated 0.5 against a new score scale and may send covered questions to `ask_teacher`.

## Lead answers (20 Oct 2026)
- **Q1: yes.** Gold answers become heading-level, with about 12 more items (30 in-course in total) and about 8 out-of-course items for calibration. Under MVP first the lead signs these (`reviewed_by: lead`); the builder marks new items `reviewed_by: pending` and the lead signs them in review.
- **Q2: open, with the human (B-24).** Phases A–C don't depend on it. If Phase D starts before an answer, build the hashed test embedder and the recording script, and leave the "with embeddings" recall assertion pending on the recorded vectors.
- **Q3: yes.** This was already decided on 18 Oct (3.5 Q2: "5.3 calibrates the default"). Phase D calibrates `coverageThreshold`; code-reviewer, logged `risk: high`.
