# Task 5.3 handoff: retrieval index

- **Status:** DONE except for the B-24 assertion (Phases A–D done; the recorded-vector recall run skips until `packages/db/test/fixtures/demo-embeddings.json` is recorded by the human, Q2)
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

- **Phase B:** done (see "Phase B" below).
- **Phase C:** done (see "Phase C" below). Was: in `packages/ingest`: the chunker (≤ 300 words, never crosses a unit, no overlap, heading kept on the first chunk), `indexDocument` (embed batches of 96, failure leaves NULL embeddings) and the hashed test embedder. Read `docs/tasks/5.1/handoff.md` on main first.
- **Phase D:** the recall test on the demo Q&A set (heading-level gold, about 30 in-course items plus about 8 out-of-course items marked `reviewed_by: pending`, per Q1). Calibrate `TEXT_HALF`, `VECTOR_ZERO`, `NOTE_MATCH_FLOOR`, `PROBE_FLOOR` and `coverageThreshold` (Q3 = yes, code-reviewer, `risk: high`). The "with embeddings" assertion waits on B-24 (Q2).
- **For Phase D to check (Phase A review MEDIUM):** HNSW with WHERE filters filters after the index scan (ef_search 40), so a large teacher with a small allowed set could get fewer than 20 vector candidates. pgvector 0.8's `hnsw.iterative_scan` (set per transaction) is the likely fix. The demo corpus is far below the point where this shows. Phase B tried and could not make a red test (see "Phase B").

## Phase B

- **Status:** Phase B done; Status stays PARTIAL. Left to do: Phases C and D.
- **Builder:** tdd-guide, local branch `build-5.3b`, pushed to `m5/5.3-retrieval-index`.

### What Phase B delivers

- **Real leakCheck** in `retrievalIndexFor` (`packages/db/src/repositories/retrieval.ts`), per ADR-0007. It checks the scope and candidates before any SQL: a malformed scope rejects with `RepositoryError('scope')` and malformed candidates with `RepositoryError('invalid')`; the error message names only the method and the kind. It reads the revision first. Then it takes the locked index for `(teacherId, revision, sorted allowed ids)` from the cache, or builds it from the teacher's own material with the shared `lockedIndex` from `@edmate/harness`. How the index works:
  - modules outside the allowed list are locked, draft and unpackaged ones included;
  - spans that also appear in an allowed module are ignored;
  - each module's chunks are joined in `(document_id, id)` order.

  The whole call races `leakTimeoutMs` (100 ms default). A timeout or any error gives `{ hit: true }`. A cold build that loses the race keeps running, so the next call is warm.
- **New repository method `retrieval.material(scope)`** returns every chunk text of the teacher's own modules, ordered by module, document and chunk. The teacher filter and the module-ownership subquery are in the same statement. It has an isolation `CASES` entry.
- **`leakCache.ts`**, an LRU of 64:
  - concurrent callers share one in-flight build;
  - a failed build is never cached;
  - a build is dropped after `leakBuildTimeoutMs` (30 s);
  - a newer revision drops the teacher's older entries, and a late build of an older revision is not stored.
- **Shared contract** `packages/harness/src/testing/retrievalContract.ts` (`RETRIEVAL_CONTRACT`, `contractWorld`, `CONTRACT`; exported from `@edmate/harness/testing`; no vitest import). It has 11 cases:
  - one boolean;
  - shared folding;
  - complement, including draft modules;
  - allowed duplicate ignored;
  - cross-chunk span;
  - per teacher;
  - foreign allowed ids don't widen;
  - malformed scope or candidates reject;
  - never logs or echoes a candidate, on success and failure paths;
  - search scope;
  - probe keys and teacher.

  `memoryRetrieval.test.ts` runs the list unchanged, and so does `packages/db/test/retrieval-leak.int.test.ts`.
- **New options on `retrievalIndexFor`:** `leakTimeoutMs`, `leakBuildTimeoutMs` and `onLeakFallback(code)` (`leak_timeout` / `leak_failed`; a callback that throws is ignored).
- **`@edmate/harness` moved** from `devDependencies` to `dependencies` of `@edmate/db`. This makes no cycle: harness depends only on contracts and zod.

### Acceptance evidence (Phase B)

| Item | Command → trimmed output |
|---|---|
| Gate | `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db --filter=...@edmate/harness --force --concurrency=1` → `Tasks: 34 successful, 34 total` |
| Test counts | `@edmate/db: Tests 564 passed (564)`; `@edmate/harness: Tests 3666 passed (3666)`; `@edmate/web: Tests 132 passed`; `@edmate/worker: Tests 121 passed, 10 skipped` |
| Coverage of new code | `leakCache.ts 100 / 100 / 100 / 100`, `retrieval.ts 100 / 100 / 100 / 100` (stmts / branch / funcs / lines) |
| Shared contract | The same 11 cases pass in `memoryRetrieval.test.ts` and in `retrieval-leak.int.test.ts` (on Postgres) |
| Fails closed | `retrieval-leak.int.test.ts` "fails closed":<br>• the revision or material read throws → `{ hit: true }` (`leak_failed`)<br>• a hung database → `{ hit: true }` after 30 ms (`leak_timeout`)<br>• a closed pool → `{ hit: true }`<br>• a failed build is not cached<br>• a cold build slower than the timeout → `{ hit: true }`, then warm (one material load)<br>• a build that never ends is dropped after `leakBuildTimeoutMs`<br>• a counter that throws changes nothing<br>• a malformed scope or candidate list rejects with zero database calls |
| Never logs candidates | A contract case spies on `console.*`, `process.stdout/stderr.write` and every error message, stack and cause. The candidate marker appears nowhere. |
| Ownership | Contract case "per teacher". Contract case "allowed ids of another teacher's modules do not widen the allowed set": B's module holds A's locked span and is named as allowed for A, and the span still hits. Grid case `retrieval.material` in `repositories.int.test.ts`. |
| SLO | `retrieval-leak.int.test.ts` "SLO": 50 modules × 20 chunks (about 35,000 words, about 10× the demo notes' 3,100), 8,000-character replies through `lockedCandidates`, 300 warm calls → `leakCheck SLO: p95 5.3 ms, p99 5.8 ms` (local run; asserted ≤ 50 / ≤ 100) |
| Cache cleared on a revision | Test "a new locked chunk hits without re-creating the adapter; a new allowed copy clears it":<br>1. starts at `{ hit: false }`;<br>2. `documents.create` alone: still false;<br>3. a locked chunk is inserted: true;<br>4. the same words are added to an allowed module: false. |
| Cache unit | `test/leak-cache.test.ts`, 9 tests: key, shared builds, failures not stored, build timeout, revision drop, late old build, LRU order |
| No contracts change | `git diff origin/main --stat -- packages/contracts` → empty |
| Secret scan | `python3 .githooks/secret-scan.py --all` → exit 0 |

### Changes (Phase B)

- New: `packages/harness/src/testing/retrievalContract.ts`, `packages/db/src/repositories/leakCache.ts`, `packages/db/test/leak-cache.test.ts`, `packages/db/test/retrieval-leak.int.test.ts`.
- Changed in `packages/db`:
  - `src/repositories/retrieval.ts`: the real leakCheck, `retrieval.material` and the new options.
  - `src/repositories/index.ts`: exports `LeakFallback`.
  - `src/repositories/README.md`: a leakCheck paragraph.
  - `test/repositories.int.test.ts`: the `retrieval.material` case.
  - `test/retrieval.int.test.ts`: Phase A's stub test removed, with a pointer to the new suite.
  - `package.json` and `pnpm-lock.yaml`: harness moved to `dependencies`.
- Changed in `packages/harness`: `src/testing/index.ts` (exports) and `src/testing/memoryRetrieval.test.ts` (runs the contract).

### Deviations (Phase B)

1. **The cache key uses the allowed ids as given (sorted, deduplicated), not only the owned ones.** Finding the owned subset needs another query before the cache lookup. Foreign ids can't widen anything: the material query returns only this teacher's modules, so a foreign id matches no chunk. They only make a different key.
2. **Fail-closed injections are in the db suite, not in the shared contract.** Only an adapter with a database can be broken that way. When the in-memory test double is configured with an Error it rejects, and the harness already treats that as closed. The contract covers ADR-0007 points 1–4 plus the search and probe scope.
3. **New repository method `retrieval.material(scope)`.** The plan's file list doesn't name it. leakCheck needs the teacher's text through the guarded repository surface, the same way search and probe get theirs.
4. **`leakBuildTimeoutMs` and `onLeakFallback` are new options.** The first stops a hung query from pinning a cache key forever. The second mirrors `onEmbedFallback`, so a fail-closed leakCheck can be counted without logging.
5. **`leakCache.ts` never calls a Map's delete method.** `scope.test.ts` bans that text anywhere in `src/repositories`. Entries are removed by rebuilding the maps (64 entries at most), and LRU order comes from a use counter.
6. **The contract cases on Postgres use `leakTimeoutMs: 5_000`.** They test matching, not latency. The SLO test uses the 100 ms default.

### HNSW filtered scan (lead note): not done, moved to Phase D

I tried to make a red test: 1,000 locked chunks on the query's axis plus 1,000 allowed chunks off it, with the far module allowed. Postgres chose a sequential scan plus a sort, which is exact, so the test passed with no fix. With `enable_seqscan=off, enable_sort=off`, a plain filtered query did use `chunks_embedding_hnsw_idx`. The repository's own statement (with the ownership subquery) still came back complete, so I found no red test within budget. The candidate fix is still `SET LOCAL hnsw.iterative_scan = strict_order` (compose runs pgvector 0.8.1) in the vector query's transaction. Proving it red first needs a larger corpus or an EXPLAIN of the real statement.

## Phase C

- **Status:** Phase C done; Status stays PARTIAL. Left to do: Phase D (recall gate, score calibration, `coverageThreshold`). Phase D also carries the HNSW `iterative_scan` item (see "HNSW filtered scan" above).
- **Branch:** local `build-5.3c` (from `origin/m5/5.3-retrieval-index`, merged with `origin/main` for 5.1, no conflicts), pushed to `m5/5.3-retrieval-index` without force.

### What Phase C delivers

`packages/ingest` can now turn a document into stored, embedded chunks:

- `chunkDocument(doc, { headings })` (`src/chunk/chunker.ts`): 5.1's `ParsedDocument` → `ChunkDraft { ord, text, locator }`. A chunk never crosses a unit, so it keeps the unit's exact locator. A unit splits at lines, then sentences, then words, then (a run with no spaces) characters, packed greedily up to 300 words and 4,000 characters. No overlap. With `headings: true`, the first chunk of each section starts with its heading line.
- `indexDocument(deps, { scope, documentId, source })` (`src/index/indexDocument.ts`): parse (or take an already parsed web page) → chunk → `writer.insertMany` in batches of 500 → `embedder.embed` in batches of 96 → `writer.setEmbeddings`. Returns `{ chunks, embedded, embeddedChunks }`.
- `ChunkWriter`, `ChunkDraft` (`src/index/types.ts`): local structural types. `@edmate/db`'s `chunks` repository fits them as is; ingest does not import db.
- `hashedEmbedding` / `hashedEmbedder` (`src/testing/hashedEmbedder.ts`, exported from `@edmate/ingest/testing`): deterministic 1536-dim hashed-trigram unit vectors, for tests only.

### Acceptance evidence (Phase C)

| Item | Evidence |
|---|---|
| Every draft keeps its unit's locator; never crosses a unit | `test/chunk/chunker.test.ts` "never crosses a unit…", "splits a long unit at paragraphs…" (every draft of a split unit has the unit's locator) |
| No draft over 300 words | paragraph, sentence, no-stop and mixed-document cases assert `words ≤ 300` (exact sizes `[300, 300, 200]`, `[300, 150]`, `[300, 300, 50]`); a no-space run is cut at 4,000 chars |
| No text lost or duplicated | every split case asserts the whitespace-collapsed concatenation equals the input; the heading case asserts the same after removing the heading lines |
| Heading line on the first chunk only | "puts the heading line verbatim on the first chunk of each section only" (real `parseMarkdown` output); none before the first heading, none for page/slide documents, none for an over-long or blank heading |
| Embed batching (97 → 2 calls) | `test/index/indexDocument.test.ts` "embeds in batches of 96: 97 chunks are 2 calls (ScriptedGateway)" → calls `[96, 1]` |
| Embed failure → NULL embeddings, `embedded: false`, nothing thrown | seven cases (rejects, throws, scripted gateway runs out, too few vectors, non-array, wrong dimension, NaN) → `{ embedded: false, embeddedChunks: 0 }`, no `setEmbeddings`, callback gets `embed_failed` / `embed_malformed`, no `console.*` call; a later batch failing keeps the earlier 96 |
| Writer rejection propagates with a fixed code | `insertMany` rejects, `setEmbeddings` rejects, wrong id count → `IngestError('provider_error', retryable false, "ingest: the chunks could not be stored")`, no `cause`, the serialised error has none of the cause's text |
| No real model calls | `ScriptedGateway` (with `manualClock`) and the hashed embedder only |
| No contracts change | `git diff origin/main -- packages/contracts` is empty |

```
$ corepack pnpm turbo run typecheck lint test --filter=...@edmate/ingest --filter=...@edmate/db --force --concurrency=1
@edmate/ingest:test:  Test Files  16 passed (16)
@edmate/ingest:test:       Tests  243 passed (243)      (35 new)
@edmate/ingest:test: All files          |     100 |    98.45 |     100 |     100 |
@edmate/ingest:test:   chunker.ts       |     100 |      100 |     100 |     100 |
@edmate/ingest:test:   indexDocument.ts |     100 |    95.45 |     100 |     100 |
@edmate/ingest:test:   hashedEmbedder.ts|     100 |      100 |     100 |     100 |
@edmate/db:test:       Tests  564 passed (564)
@edmate/worker:test:   Tests  121 passed | 10 skipped (131)
@edmate/web:test:      Tests  132 passed (132)
 Tasks:    17 successful, 17 total

$ python3 .githooks/secret-scan.py --all
(exit 0)
```

### Changes (Phase C)

- `packages/ingest/package.json`: `@edmate/contracts` dependency (the `ModelGateway` type); `@edmate/harness` devDependency (`ScriptedGateway`, `manualClock`). `pnpm-lock.yaml` updated.
- New: `src/chunk/chunker.ts`, `src/index/indexDocument.ts`, `src/index/types.ts`, `src/testing/hashedEmbedder.ts`; tests `test/chunk/chunker.test.ts`, `test/index/indexDocument.test.ts`, `test/testing/hashedEmbedder.test.ts`.
- `src/index.ts` and `src/testing/index.ts` export the new names.

### Deviations (Phase C)

1. **5.1's units do not contain their heading.** `SectionBuilder` puts the heading in the locator only. So "keeps its heading line verbatim" became: with `headings: true` the chunker puts the locator's last step (the section's own heading) in front of the section's first chunk, as its own line. The heading counts toward the 300 words. `indexDocument` turns it on for Markdown and DOCX; a web page passes `{ kind: 'parsed', headings: true }`.
2. **`indexDocument` also takes a parsed document** (`{ kind: 'parsed', document, headings }`), because a web link is fetched and parsed by `parseWebLink`, not `parseDocument`.
3. **Added beyond the plan:** a 4,000-character cap per chunk, a 500-character locator cap, a 10,000-chunk cap per document, insert batches of 500, `embeddedChunks` in the result, an `onEmbedFailed` callback, a check that each batch's vectors are well formed, and a validation error for a document that chunks to nothing.
4. **The document row is not created here.** `indexDocument` takes the id of a document the caller has already filed (`documents.create`, 8.x upload centre).

## Phase D

- **Status:** done, except the B-24 assertion. Built on local `build-5.3d` (from `origin/m5/5.3-retrieval-index` plus `origin/main`) and pushed to `m5/5.3-retrieval-index` without force. Worktree: `.claude/worktrees/agent-a15e955d06d5fcb2b`.
- The one gap: the "hybrid with recorded model vectors" recall run skips with a clear message until the human records `packages/db/test/fixtures/demo-embeddings.json` (Q2 fallback).

### What Phase D delivers

- **Recall set (Q1).** `content/demo-teacher/qa-recall.yaml` holds 30 in-course items with heading-level gold (`expectedModuleId`, `expectedHeadings` with one or two notes headings) and 8 out-of-course items (`outOfCourse: true`). Every item is new or changed, so every item has `reviewed_by: pending` for the lead to sign.
- **Schema and rule 6** (`packages/content`). `QaRecallItemSchema` is a union of in-course and out-of-course items, and both carry `reviewed_by`. Rule 6 also checks that each expected heading is a real heading in that module's `notes.md`.
- **Recall gate** (`packages/db/test/recall.int.test.ts`). It loads the demo course, indexes the notes through `@edmate/ingest`'s `indexDocument` and the real repositories, and searches each question through the production `retrievalIndexFor` with k = 5 over all demo modules. It prints a per-item table and asserts recall@5 ≥ 0.8 for full text and for hybrid with the hashed test embedder. The recorded-vector run skips until B-24.
- **Score calibration** (`retrieval.ts`):
  - The full-text score is now the IDF-weighted share of the query's terms that a chunk contains (`termCoverage`), multiplied by the old `raw / (raw + 0.05)`.
  - `pivotScale` then maps `TEXT_PIVOT` = 0.30 to 0.5.
  - Query terms get a light suffix strip (`stemTerm`) and a short list of question-filler stop words.
  - `PROBE_FLOOR` and `NOTE_MATCH_FLOOR` now import the harness's `DEFAULT_COVERAGE_THRESHOLD`.
  - RRF ranking is unchanged.
- **coverageThreshold (Q3).** It stays 0.5 and is now documented as calibrated. The score scale moved to meet the threshold.
- **HNSW.** The vector query runs in a transaction with `SET LOCAL hnsw.iterative_scan = strict_order`. A new guard test, `retrieval-hnsw.int.test.ts`, uses 1,000 locked chunks nearest the query and 30 allowed ones, and asserts 20 allowed vector results.
- **ChunkWriter type check** (`packages/db/test/chunk-writer.test.ts`). `Repositories['chunks']` must extend ingest's `ChunkWriter`.
- **Recording script** (`packages/db/scripts/record-demo-embeddings.ts`): see below.

### Recall and calibration (measured)

| Run | recall@5, heading level | recall@5, module level | misses |
|---|---|---|---|
| Full text only | 28/30 = **0.933** | 30/30 = 1.000 | qr-10, qr-17 |
| Hybrid, hashed test embedder (plumbing only) | 26/30 = **0.867** | 30/30 = 1.000 | qr-07, qr-10, qr-19, qr-25 |
| Hybrid, recorded model vectors | skipped (B-24) | — | — |

Calibration uses the full-text best score in the top 5, on the final scale (0.5 = `DEFAULT_COVERAGE_THRESHOLD`):

| Set | Range | At or above 0.5 |
|---|---|---|
| 30 in-course | 0.448 – 0.98 (below 0.5: qr-05 0.448, qr-02 0.449, qr-16 0.470) | 27/30 = 0.90 |
| 8 out-of-course | 0 – 0.513 (CSV 0.513; then 0.431, 0.391, 0.354, 0.227, then three at 0) | 1/8 = 0.125 |

- **Raw strength before the pivot:** in-course 0.269–0.983 and out-of-course 0–0.318, so `TEXT_PIVOT` = 0.30.
- **Phase A score for comparison:** with `raw / (raw + 0.05)` alone, 5 of 8 out-of-course questions cleared 0.5. The test now asserts in-course covered ≥ 0.8 and out-of-course covered ≤ 0.25.
- **Constants:** `TEXT_PIVOT` 0.30, `TEXT_HALF` 0.05, `VECTOR_ZERO` 0 (provisional until B-24). The threshold, `PROBE_FLOOR` and `NOTE_MATCH_FLOOR` are all 0.5.

### Recording the real vectors (B-24, for the human)

The script never runs in tests or CI. Run it from the repo root with your own key in the environment only:

```bash
source ~/.nvm/nvm.sh && corepack pnpm turbo run build --filter=@edmate/db...
EDMATE_OPENAI_API_KEY=<your key> node packages/db/scripts/record-demo-embeddings.ts --live
```

- **Safeguards.** It refuses without `--live` and without the key (exit 2); both refusals were run here, with no network call. It reads the key only through the gateway's `envKeySource`.
- **What it does.** It embeds every demo chunk and question in batches of 96 and writes `packages/db/test/fixtures/demo-embeddings.json` in the form `{ model, dimension, entries: [{ text, vector }] }`, rounded to 6 decimals.
- **After it runs.** Commit the file, and the recorded run stops skipping. Then check the separation and, if needed, set `VECTOR_ZERO`.

### Acceptance evidence (Phase D)

| Item | Command → trimmed output |
|---|---|
| Gate | `corepack pnpm turbo run typecheck lint test --filter=...@edmate/db --filter=...@edmate/ingest --filter=...@edmate/harness --filter=@edmate/content --force --concurrency=1` → `Tasks: 38 successful, 38 total`; db `590 passed, 3 skipped` |
| Recall, full text | `recall.int.test.ts` → heading 28/30 = 0.933, module 30/30 |
| Recall, hashed hybrid | → heading 26/30 = 0.867, module 30/30 |
| Recall, recorded vectors | skipped: `(SKIPPED until test/fixtures/demo-embeddings.json is recorded: B-24, Q2)` |
| Coverage (stmts / branch / funcs / lines) | `retrieval.ts` 100 / 97.77 / 100 / 100; harness `coverage.ts` 100; content `rules.ts` 100 / 97.46 / 100 / 100 |
| Secret scan | `python3 .githooks/secret-scan.py --all` → exit 0 |
| No contracts change | `git diff origin/main -- packages/contracts` → empty |

### HNSW iterative scan: applied, but no test can fail without it

I ran EXPLAIN with sequential scans, sorts and bitmap scans turned off (pgvector 0.8.1):
- `ORDER BY embedding <=> v` on its own uses the HNSW index scan.
- The repository orders by `(embedding <=> v)::float8, id`, and that is always a sequential scan plus a sort.

So today's vector search is an exact scan, and the filtered-scan gap cannot happen. The `SET LOCAL` is in place for when the query becomes index-ordered (a performance follow-up), and the guard test pins the 20-candidate property for that day.

### Changes (Phase D)

- `content/demo-teacher/qa-recall.yaml`, plus `packages/content/src/{schema,rules}.ts` with their tests and fixtures.
- `packages/db/src/repositories/retrieval.ts`.
- New db tests:
  - `packages/db/test/{recall.int,retrieval-hnsw.int,retrieval-score,chunk-writer}.test.ts`
  - `packages/db/test/recall-corpus.ts`
- `packages/db/scripts/record-demo-embeddings.ts`.
- `packages/db/package.json`: ingest and gateway added as devDependencies.
- `packages/db/tsconfig.json`: includes `scripts`, and sets `allowImportingTsExtensions` (noEmit).
- `packages/harness/src/pedagogy/coverage.ts` (comment only) and its test name.

### Deviations (Phase D)

1. **coverageThreshold stays 0.5.** I mapped the score scale to it instead of moving the threshold. Lowering the threshold to 0.3 would flip the lead-signed grounding eval fixtures, which mark scores of 0.30–0.35 as uncovered.
2. **The full-text score changed shape, not just its constants.** No setting of the constants alone separated in-course from out-of-course questions.
3. **`expectedHeadings` is a list**, where the plan said a single locator. Some questions are answered by two sections.
4. **Each search runs two more small queries** (term document frequencies and the chunk count), in parallel with the text and vector queries.
5. **The HNSW test is a guard, not a red-then-green test** (see above).

### Left to do

- B-24: the human records the real vectors, then checks `VECTOR_ZERO`.
- Lead: sign the 38 recall items (change `reviewed_by: pending` to the lead's name).
- Performance follow-up: make the vector query index-ordered for large teachers.

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

### 20 Oct 2026 · 5.3 Production leakCheck per ADR-0007, cache keyed by material revision · decided by tdd-guide · risk: high
Decided: leakCheck checks the scope and candidates before any SQL and reads the revision. It then takes or builds the locked index for (teacher, revision, sorted allowed ids), using the shared lockedIndex from @edmate/harness over the teacher's own material (new guarded method retrieval.material). The call races leakTimeoutMs (100 ms), and a timeout or any error gives { hit: true }. A cold build keeps running in the background.
Why: ADR-0007 points 1–7 and the acceptance line. This is a new read path for locked teacher material, so security-reviewer and code-reviewer are required (risk group "access filter").

### 20 Oct 2026 · 5.3 The cache key keeps the allowed ids as given, not only the owned ones · decided by tdd-guide · risk: medium
Decided: the key is teacherId, revision and the sorted, deduplicated allowedModuleIds. The material query enforces ownership instead.
Why: filtering to owned ids first costs an extra query per call. A foreign id matches none of the teacher's chunks, so it can only split the cache and never widens the allowed set (a contract case shows this).

### 20 Oct 2026 · 5.3 Fail-closed injections live in the db suite; the shared contract covers ADR-0007 points 1–4 · decided by tdd-guide · risk: low
Decided: the contract list has no database-failure cases. retrieval-leak.int.test.ts injects repositories that throw, hang or sit on a closed pool.
Why: only a real adapter has a database to break. When the in-memory double is configured to reject, the harness already treats that as closed.

### 20 Oct 2026 · 5.3 leakBuildTimeoutMs (30 s) and onLeakFallback added to retrievalIndexFor · decided by tdd-guide · risk: low
Decided: a background build is dropped after 30 s, so a hung query can't pin a key. Each fail-closed answer reports leak_timeout or leak_failed to an optional callback, never a candidate or the error.
Why: without a build deadline, one hung query would keep every later call on that key failing closed. The callback mirrors onEmbedFallback, so ops can count fallbacks without logging.

### 20 Oct 2026 · 5.3 HNSW iterative scan left for Phase D · decided by tdd-guide · risk: low
Decided: Phase B makes no change to the vector query. The lead's MEDIUM stays open under Phase D.
Why: at test sizes Postgres picks an exact scan, so no red test could be made within budget. The gap affects recall, not leakage.

### 20 Oct 2026 · 5.3 The section heading leads the first chunk, taken from the locator · decided by tdd-guide · risk: low
Decided: 5.1's units carry their heading only in the locator, so the chunker (with `headings: true`) puts the locator's last step on its own line at the start of a section's first chunk. It adds none to text located by the source title, none to page or slide documents, and none for a heading over 30 words. A heading that itself contains " > " keeps only its last part.
Why: the plan wants the heading on the first chunk for full-text recall, and the heading is still source text, so the module text leakCheck joins stays true to the source. Changing 5.1's unit text instead would alter its locator contract.

### 20 Oct 2026 · 5.3 Chunk size caps: 300 words, 4,000 characters, 500-character locator, 10,000 chunks per document · decided by tdd-guide · risk: low
Decided: a chunk holds at most 300 words and 4,000 characters (a run with no spaces is cut by characters). A locator over 500 characters keeps its last 499 characters after an ellipsis. A document that chunks to more than 10,000 pieces is `IngestError('input_too_large')` before anything is written.
Why: 4,000 characters keeps any chunk inside the embedding model's input limit, even for long URLs or formulas. The db's locator column takes 500 characters and chunk ids hold a 4-digit ord.

### 20 Oct 2026 · 5.3 Storage failure is a fixed, non-retryable IngestError; embedding failure is not an error · decided by tdd-guide · risk: medium
Decided: any `insertMany` or `setEmbeddings` rejection, or a wrong id count, becomes `IngestError('provider_error', false, 'the chunks could not be stored')` with no cause. An embedding failure (a throw or rejection, or malformed vectors) stops embedding, keeps the batches already written, reports `embed_failed` or `embed_malformed` to an optional callback and resolves with `embedded: false`.
Why: a db error can quote teacher material, so nothing of it is kept. It is not marked retryable because earlier insert batches may already be stored, and re-running would hit the repeated-ord `invalid` error; re-indexing needs the delete path (8.x). Full text still finds unembedded chunks, so a missing embedding should not fail the upload.

### 20 Oct 2026 · 5.3 @edmate/ingest depends on @edmate/contracts, with @edmate/harness as a devDependency · decided by tdd-guide · risk: low
Decided: ingest now imports the `ModelGateway` type from contracts and uses harness's `ScriptedGateway` in tests only. No contracts change.
Why: the plan's Phase C file list. `Pick<ModelGateway, 'embed'>` keeps the embedder swappable without ingest importing the gateway package.

### 20 Oct 2026 · 5.3 coverageThreshold stays 0.5, now calibrated; the score scale is mapped to it · decided by tdd-guide · risk: high
Decided: `DEFAULT_COVERAGE_THRESHOLD` stays 0.5 and is no longer provisional. The index maps its full-text score so that 27 of 30 in-course demo questions score at or above 0.5 and 1 of 8 out-of-course questions does. `PROBE_FLOOR` and `NOTE_MATCH_FLOOR` use the same constant. Reviewer: code-reviewer (Q3).
Why: the threshold and the score scale are one choice. Moving the scale keeps every consumer and the lead-signed grounding eval fixtures valid. The vector side stays provisional until B-24.

### 20 Oct 2026 · 5.3 The full-text score is IDF-weighted term coverage times match strength · decided by tdd-guide · risk: high
Decided: a chunk's text score is the IDF-weighted share of the query's terms it contains, times `raw / (raw + 0.05)`, then mapped by `pivotScale` with pivot 0.30. IDF is counted over the chunks being searched, using two small extra queries inside the same teacher and module filter.
Why: with the old score any single matching word gave about 0.9, so 5 of 8 out-of-course questions looked covered.

### 20 Oct 2026 · 5.3 A light suffix strip and question fillers in the full-text terms · decided by tdd-guide · risk: medium
Decided: a query term drops one ending (ies, ing, ed, es or s) when at least four letters remain. Words ending in ss, is or us, and numbers, keep their ending. Fourteen question fillers join the stop list. The 'simple' tsvector config is unchanged.
Why: 'simple' has no stemming, so "dividing" missed "divide". Fillers counted as rare missing words under IDF. Both changes are general, not tuned to single items.

### 20 Oct 2026 · 5.3 Recall gold is a list of headings; out-of-course items have no gold · decided by tdd-guide · risk: low
Decided: in-course items carry `expectedModuleId` and `expectedHeadings`, which rule 6 checks. Out-of-course items carry `outOfCourse: true`. Every item has `reviewed_by: pending` until the lead signs it.
Why: Q1 asked for heading-level gold. Some questions are answered by two sections.

### 20 Oct 2026 · 5.3 The recall test uses the Q2 fallback for embeddings · decided by tdd-guide · risk: medium
Decided: the hybrid recall run uses the hashed test embedder, which only tests the plumbing. The recorded-vector run skips until the human runs `record-demo-embeddings.ts --live` once (B-24). The script reads the key only from the environment and never runs in tests or CI.
Why: Q2 is still open with the human. This is the lead's fallback.

### 20 Oct 2026 · 5.3 HNSW iterative scan is set, though the query stays an exact scan · decided by tdd-guide · risk: low
Decided: the vector query sets `hnsw.iterative_scan = strict_order` in its own transaction and keeps its distance-then-id order, which the planner serves with an exact scan.
Why: EXPLAIN shows the feared gap cannot happen with this statement, so no failing test is possible. The setting is ready for an index-ordered query later, and a guard test is in place.

### 20 Oct 2026 · 5.3 db takes ingest and gateway as devDependencies; the script imports .ts directly · decided by tdd-guide · risk: low
Decided: `@edmate/ingest` (for the recall test and the type check) and `@edmate/gateway` (for the script) are db devDependencies. The db tsconfig allows `.ts` imports (noEmit), so Node 22 runs the script without a build step of its own.
Why: the plan's Phase D file list, and the recording script must reuse the test's corpus so the texts match exactly.

## CI fix (leak SLO test)

CI run 39451742293's node job failed `retrieval-leak.int.test.ts`'s SLO (ADR-0007 point 6): p95 measured
72.568 ms against the 50 ms budget. Every other test (589) passed.

Root cause: `lockedIndexFor` reads the teacher's material revision (a real Postgres round trip) on
every `leakCheck` call, even when the locked-index itself is served warm from the LRU cache — the
adapter's warm path is never free of the database, by design (point 7's cache key needs a fresh
revision read to invalidate correctly). `@edmate/db`'s vitest config ran its ~17 integration test
files across parallel workers, each opening its own Postgres pool; under CI's shared runner that
contention stretched the revision round trip past the 50/100 ms budget on a warm run, the same
class of flake task 4.4 found and fixed in `apps/worker` (`fileParallelism: false`). It is
contention, not new work on the warm path: locally, isolated, the same call measures low single
digit milliseconds.

Fix: `packages/db/vitest.config.ts` now sets `fileParallelism: false`, so this package's test files
run one at a time instead of racing each other and the rest of the turbo run for CPU and Postgres
connections. `leakCheck`'s behaviour and the 50/100 ms SLO are unchanged.

Verified locally (infra up via `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres redis`):
- `turbo run typecheck lint test --filter=@edmate/db --force --concurrency=1`: 34 files, 590
  passed, 3 skipped. `leakCheck SLO: p95 3.8 ms, p99 4.8 ms`.
- Same command at default turbo concurrency (mimics CI): also 8/8 tasks green.
- `python3 .githooks/secret-scan.py --all`: clean.

## Sync with main (20 Oct)

Merged `origin/main` (4.4 #47, 0.11 #65, 0.13 #63, plus board/decision-log commits) into
`m5/5.3-retrieval-index` at `6565154` (merged over branch head `3560690`).

- `packages/db/src/repositories/index.ts`: additive conflict only — HEAD added the
  `retrieval.js` import and `retrieval: guardAll(...)` entry/export block, main added
  `safety-events.js`'s `safetyEventsRepo` import and `safetyEvents: guardAll(...)` entry. Kept
  both sides, no behaviour change.
- `docs/board/tasks.yaml`, `docs/decisions/log.md`: no conflict markers after the merge; main's
  state came through as-is (nothing from this branch to re-apply here).
- `packages/db/vitest.config.ts`, `apps/worker/vitest.config.ts`: no conflict; both still set
  `fileParallelism: false` after the merge.
- `pnpm-lock.yaml`: no conflict and no diff from the merge; `corepack pnpm install` reported the
  lockfile already up to date, so it was left as-is.
- `packages/harness`: no conflicting files; merged clean.

Gate after the merge (infra up via
`docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres redis`):
`turbo run typecheck lint test --filter=...@edmate/db --filter=...@edmate/harness --filter=@edmate/ingest --force --concurrency=1`
→ 38/38 tasks successful. `python3 .githooks/secret-scan.py --all`: clean.

Pushed `sync-5.3` to `origin/m5/5.3-retrieval-index` (no force) at `6565154`.
