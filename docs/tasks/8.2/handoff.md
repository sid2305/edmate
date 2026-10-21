# 8.2 handoff: Upload centre (thin slice)

Status: PARTIAL (Phase 2 of 4 done)
Branch: `m8/8.2-upload-centre` (built on `work-8.2a`)
Worktree: `.claude/worktrees/agent-a898e7ac11d68d181`

## Phase 1

packages/db: document status, and get / list / update status / delete / replace.

### Acceptance evidence
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` →
  `Tasks: 26 successful, 26 total`; `@edmate/db: Tests 781 passed | 4 skipped`;
  coverage `chunks.ts 100 | 100 | 100 | 100`, `map.ts 100 | 100 | 100 | 100`.
- `test/documents.int.test.ts` (Postgres 16, 21 tests): status moves uploading → processing →
  ready / failed; a delete removes chunks and row, bumps the revision by 1, and **the very next**
  `retrieval.search` returns no chunk of the deleted document (another document's chunk still
  hits); replace clears old chunks, resets status and key; every cross-teacher and missing case is
  `not_found` with nothing written; a chunk insert racing a delete leaves zero chunks.
- Isolation grid (`test/repositories.int.test.ts`): `documents.get 24 cases leaks=0`,
  `documents.listForTeacher 24 leaks=0`, `documents.updateStatus 6`, `documents.delete 4`,
  `documents.startReplace 6`, all fail closed.
- `test/document-status-migration.int.test.ts`: a row written before 0017 becomes `ready`; a row
  written after starts `uploading`.
- `python3 .githooks/secret-scan.py --all` → clean (no output).

### Changes
- `src/schema/_shared.ts`, `schema/index.ts`: `document_status` enum.
- `src/schema/content.ts`: `documents.status` (not null, default `uploading`),
  `documents.failure_reason` (nullable) and CHECK `documents_failure_reason_only_when_failed`.
- `migrations/0017_document_status.sql` (+ snapshot, journal): generated, then hand-edited so the
  column is added with `DEFAULT 'ready'` (backfills existing rows) and then set to default
  `'uploading'` for new rows.
- `src/repositories/chunks.ts`: `documents.get`, `listForTeacher`, `updateStatus`, `delete`,
  `startReplace`; private `lockDocument` (`FOR UPDATE`) and `removeChunks`.
- `src/repositories/map.ts`: `DocumentRow`, `DOCUMENT_STATUSES`, `DocumentStatus`, `toDocumentRow`.
- `src/repositories/index.ts`: exports `DOCUMENT_LIST_MAX`, `DocumentListOptions`, `DocumentRow`,
  `DocumentStatus`, `DOCUMENT_STATUSES`.
- `src/repositories/README.md`: rules 7 and 8 now allow deletes in `chunks.ts` only; new
  § Documents.
- Tests: `test/documents.int.test.ts` and `test/document-status-migration.int.test.ts` (new);
  `test/repositories.int.test.ts` (5 new `CASES` + seed docs), `test/schema.test.ts` (enum, columns,
  CHECK), `test/scope.test.ts` (the no-deletes guard narrowed and pinned, see Decisions).

### API for later phases
```ts
documents.get(scope, id): Promise<DocumentRow | null>
documents.listForTeacher(scope, { moduleId? }?): Promise<DocumentRow[]>  // newest first, max 500
documents.updateStatus(scope, id, 'processing' | 'ready' | 'failed', failureReason?): Promise<void>
documents.delete(scope, id): Promise<{ storageKey: string | null }>
documents.startReplace(scope, id, { storageKey }): Promise<{ previousStorageKey: string | null }>
```
`failureReason` is required with `failed` and refused otherwise; it must match
`^[a-z][a-z0-9_]{0,63}$` (an `IngestErrorCode` such as `provider_error` fits).

### Deviations
- `startReplace` returns `{ previousStorageKey }` (the plan didn't name a return value) so Phase 3
  can delete the old object.
- `updateStatus` checks the previous state (see Decisions); the plan only named the signature.

## Phase 2

packages/queue + apps/worker: ingest queue, job schema, storage client, ingest processor and
worker.

### Acceptance evidence
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/queue... --filter=@edmate/worker...`
  → `Tasks: 34 successful, 34 total`.
- `@edmate/queue` tests: 13 new (`IngestJobSchema`, `jobId.ingest`, `createIngestQueue` /
  `enqueueIngest`) alongside the existing suite, all passing; coverage 100/100/100/100 (its global
  threshold).
- `@edmate/worker` tests: 159 passed (19 files), including the new
  `src/ingest/{gateway,processor}.test.ts`, `src/storage/client.test.ts` and a `deadLetter.test.ts`
  addition; `src/ingest` coverage 79.74/70/66.66/78.37 (pulled down by the untested
  `src/ingest/workers.ts` wiring, see Deviations) but the package's overall thresholds (80%,
  excluding `src/index.ts`/`src/scripts/**`) still passed.
- `apps/worker/src/ingest/processor.test.ts` (12 cases, fakes only — rule 4): indexes a markdown
  document to `ready`; transcribes a video through a signed URL; a malformed payload, a missing
  document, a document with no `storageKey`, a non-retryable `IngestError` (→ `failed` +
  `PermanentJobError`) and a retryable one (→ rethrown, document stays `processing`); **the stale-
  replace race from Phase 1's notes, both when the replace lands before the chunk write and when
  it lands after indexing but before the `ready` write** — both drop the work with outcome
  `stale_skipped` and write nothing; an unexpected storage failure retries; a `RepositoryError`
  on the initial read is classified `failed` (retry) vs `scope` (permanent).
- `python3 .githooks/secret-scan.py --all` → clean (no output).

### Changes
- `packages/queue/src/queues.ts`: `INGEST_QUEUE`, `JOB.ingestProcess`, `jobId.ingest`,
  `IngestFileKindSchema`, `IngestJobSchema` (teacherId, documentId, fileKind, and `mimeType`
  required exactly for `video`/`audio`).
- `packages/queue/src/index.ts`: `createIngestQueue`, `enqueueIngest`.
- `apps/worker/src/storage/client.ts`: `StorageClient` (`getObjectBytes`, `getSignedDownloadUrl`,
  `deleteObject`) over `@aws-sdk/client-s3`; signing is local (no network call) via an injected
  `getSignedUrl`.
- `apps/worker/src/ingest/gateway.ts`: `createIngestGateway(env)` — loads the OpenAI key via
  `@edmate/gateway`'s `loadProviderKeys`/`envKeySource`, builds the embedder
  (`createEmbeddingAdapter`) and the Whisper transcriber (`createWhisperTranscriber`), allowlisting
  only the configured S3 host (ADR-0005).
- `apps/worker/src/ingest/processor.ts`: `ingestProcessor(deps, log)` — loads the document, builds
  a `DocumentInput`/`VideoSource` from storage, runs `@edmate/ingest`'s `indexDocument`, and moves
  the row to `ready` or `failed`. The stale-replace guard (see Deviations) lives in a `ChunkWriter`
  wrapper this file builds, not in `packages/db` or `packages/ingest`.
- `apps/worker/src/ingest/workers.ts`: `createIngestWorker` — a BullMQ `Worker` on `edmate-ingest`,
  concurrency 1, wired through the existing `permanentToUnrecoverable` / `onJobFailed` dead-letter
  path from task 3.8.
- `apps/worker/src/ingest/index.ts`: barrel export.
- `apps/worker/src/index.ts`: builds the gateway, an `S3Client` from `storageConfigFromEnv`, and
  starts `createIngestWorker`; if the OpenAI key isn't configured (a dev box with no provider keys)
  it logs `ingest.worker_disabled` and skips the worker rather than crashing the process.
- `apps/worker/src/commit/deadLetter.ts`: `deadLetterRefs` now also keeps `documentId` (alongside
  the existing `teacherId`) so a dead-lettered ingest job keeps both.
- `apps/worker/package.json`: added `@aws-sdk/s3-request-presigner`, `@edmate/gateway`,
  `@edmate/ingest`.

### API for later phases
```ts
enqueueIngest(queue, { teacherId, documentId, fileKind, mimeType? }): Promise<void>
// fileKind: 'pdf' | 'docx' | 'pptx' | 'markdown' | 'video' | 'audio'
// mimeType required exactly when fileKind is 'video' or 'audio'
```
Phase 3's upload-complete route should call `documents.updateStatus(scope, id, 'processing')`
*then* `enqueueIngest`, in that order — the worker's own `updateStatus('ready')` refuses
`uploading → ready`, so the row must already be `processing` before the job can succeed.

### Deviations
- The plan's `IngestJobSchema` didn't name a file-kind field, but `documents` has no file-format
  column (its `kind` is the chunk-retrieval category, not pdf/docx/etc.), so the job itself carries
  `fileKind` (and `mimeType` for video/audio) — there's nowhere else for the worker to learn it.
- **The Phase 1 stale-replace race is fixed, but not the way its note suggested.** The job does
  *not* carry the `storageKey` it was enqueued for; instead the processor re-reads the row once at
  the start and compares that `storageKey` against a fresh read right before `chunks.insertMany`
  writes, inside a `ChunkWriter` wrapper. That wrapper can't signal staleness by throwing, though:
  `@edmate/ingest`'s `indexDocument` catches every error its `ChunkWriter` throws and replaces it
  with one fixed, non-retryable `IngestError('provider_error', ...)` (deliberately, so a cause that
  might carry teacher material never reaches a log line) — out of this phase's scope to change. So
  the wrapper instead closes over a mutable `stale` flag: on a stale read it writes nothing and
  returns empty placeholder ids (and `setEmbeddings` becomes a no-op), and the processor checks
  that flag itself, both in `indexDocument`'s catch block and right after a "successful" call,
  before ever writing a status. `updateStatus('ready')`'s own `not_found` (the row's `storageKey`
  moved and its status is back at `uploading`) is still the backstop for a replace landing *after*
  indexing finishes — that path was already correct in Phase 1's design, just not yet exercised by
  a test; it has one now.
- `apps/worker/test/ingest.int.test.ts` (real Postgres/Redis, a fixture through the whole
  queue → worker → `ready` path plus a scripted-gateway failure path) named in the plan's Phase 2
  "Tests first" section was **not written in this phase** — the unit tests above exercise the same
  logic (processor + storage + gateway, all faked per rule 4) and the full
  `typecheck lint test --filter=@edmate/queue... --filter=@edmate/worker...` run is green, but
  nothing yet runs the real BullMQ `Worker` against a real queue end to end. Left for Phase 3 or a
  follow-up, whichever builder has budget: wire `createIngestWorker` + `enqueueIngest` against the
  `TEST_DATABASE_URL`/`TEST_REDIS_URL` compose stack and assert a document reaches `ready`.
- `src/ingest/workers.ts` (the BullMQ `Worker` construction itself) has no direct unit test — it's
  a thin wire-up of already-tested pieces (`ingestProcessor`, `permanentToUnrecoverable`,
  `onJobFailed`) and mirrors the untested-by-design pattern of the existing turn-queue workers in
  `src/commit/workers.ts`. The integration test above would cover it if added.

## Phase 2 int test

`apps/worker/test/ingest.int.test.ts` (deferred above) is now written: real Postgres and Redis
(`docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml -f
apps/worker/test/compose.port.yaml up -d postgres redis`), a fake in-memory `StorageClient` and a
scripted embedder double (no real model/S3/network calls, rule 4). Four cases, all through real
`documentsRepo`/`chunksRepo`/`retrievalRepo`:
- enqueue (`createIngestQueue`/`enqueueIngest`) → the real `createIngestWorker` processes it → the
  document reaches `ready` with chunk rows, and `retrievalRepo.search` finds them.
- an empty-bytes markdown file (a stand-in "corrupt" file; `parseDocument`'s own validation
  rejects it before any parser runs) → `failed` with `failureReason: 'validation'`, zero chunks.
- a job for a document deleted before the worker runs it → the processor's own `documents.get`
  returns null, so it throws a permanent error and the job lands in the dead-letter queue after one
  attempt; nothing is written, `documents.get` still returns null afterwards.
- the stale-replace race: calling `ingestProcessor` directly (not through the queue) lets the test
  gate the "old" job's `storage.getObjectBytes` open, call `documents.startReplace` while it's
  still in flight, then release it — the old job returns `stale_skipped` and writes no chunks; a
  second, ungated call for the new `storageKey` reaches `ready` with only the new file's chunks.
  **Deviation from a literal reading of the task:** this one case does not go through BullMQ's
  `Queue`/`Worker` — a quick spike (`node -e ...` against the compose Redis) showed `Queue.add()`
  with the *same* `jobId` as a still-active job blocks indefinitely rather than erroring or
  queueing a second attempt, because `jobId.ingest(documentId)` is the same for both the original
  and the replacement job. Driving the race through the real queue would have hung the test (and,
  more importantly, flags a latent issue in Phase 2's enqueue design for a real replace-while-
  processing flow — see Decisions below). Calling the processor function directly against the same
  real Postgres rows exercises the identical lock/stale-check logic without that block; the other
  three cases in this file do go through the full queue → worker path, so Redis is still exercised
  end to end by the suite.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...` → `Tasks: 34 successful,
  34 total`; `python3 .githooks/secret-scan.py --all` → clean (no output).

### Decisions (Phase 2 int test)

#### 20 Oct 2026 · 8.2c ingest's replace-enqueue reuses the in-flight job's id · decided by tdd-guide
Decided: not fixed in this pass; flagged for a follow-up. `enqueueIngest`'s `jobId.ingest(documentId)` is the same id Phase 3's replace flow would reuse to re-enqueue the new file. A spike against the real Redis showed BullMQ's `Queue.add()` with that id while the original job is still *active* (not yet completed/failed) blocks the call indefinitely rather than erroring or superseding it, because BullMQ's job-id dedupe only replaces a job still in `waiting`/`delayed`, not one already running.
Why: Phase 1/2 only exercised this race at the repository layer (`ChunkWriter`'s stale check) and in `processor.test.ts` by calling the processor directly, never through a real queue two-enqueue sequence, so the hang wasn't visible until this int test's spike. Phase 3's complete/replace routes (not yet built) should not call `enqueueIngest` synchronously inside the request that triggers a replace while an old job could still be active; worth either a distinct per-attempt job id (not just per-document) or confirming BullMQ's behaviour differs once the old job's attempt has failed/completed. Left to Phase 3 or a follow-up task, not fixed here (out of this task's scope and budget).
risk: medium

## Left to do
- **Phase 3** (apps/web): studio document API routes, presign, `policy.ts` DELETE line, and the
  `updateStatus('processing')` → `enqueueIngest` sequencing on the complete route (see API above).
  `apps/worker/test/ingest.int.test.ts` is now done (§ Phase 2 int test); Phase 3's replace route
  should account for the job-id-blocks-on-active-job decision logged there.
- **Phase 4** (apps/web): upload-centre page with polling, nav link, strings, manual dev-stack run.

## Decisions

### 20 Oct 2026 · 8.2 stale-replace guard lives in the worker's ChunkWriter, signalled by a flag · decided by tdd-guide
Decided: the ingest processor re-reads the document's `storageKey` right before `chunks.insertMany` writes (inside a `ChunkWriter` wrapper it builds), comparing it to the key read at the start of the job. On a mismatch it writes nothing and signals staleness through a mutable flag the wrapper closes over, not a thrown error — `@edmate/ingest`'s `indexDocument` replaces every error its `ChunkWriter` throws with one fixed, non-retryable `IngestError` (by design, so a cause can't carry teacher material into a log), which would erase a dedicated error's identity. The job payload does not carry the `storageKey` it was enqueued for.
Why: Phase 1's note suggested the job carry its `storageKey`, but the processor's own initial `documents.get` already establishes it, and a thrown error can't survive the trip through `indexDocument` unchanged. A closure flag the processor checks itself (in `indexDocument`'s catch block, and again after a "successful" call) works without touching `packages/ingest`, which is out of this phase's scope.
risk: medium

### 20 Oct 2026 · 8.2 ingest job payload carries fileKind and mimeType · decided by tdd-guide
Decided: `IngestJobSchema` (packages/queue) carries `teacherId`, `documentId`, `fileKind` (pdf/docx/pptx/markdown/video/audio) and `mimeType` (required exactly for video/audio).
Why: `documents.kind` is the chunk-retrieval category, not the uploaded file's format — there is no other place for the worker to learn how to parse the stored object. Not named explicitly in the plan's schema sketch.
risk: low

### 20 Oct 2026 · 8.2 ingest.int.test.ts deferred to Phase 3 · decided by tdd-guide
Decided: the plan's Phase 2 "Tests first" named a real-Postgres/Redis integration test running the whole queue → worker → `ready` path; it was not written in this phase. Unit tests (fakes per rule 4) cover the processor, storage client and gateway, and the full typecheck/lint/test run for both packages is green.
Why: token-budget discipline (stay-within-subscription); the remaining work was diagnosing and fixing the stale-replace race itself, which the unit tests exercise directly. Left as an explicit line in Left to do for Phase 3 or a follow-up task.
risk: low

### 20 Oct 2026 · 8.2 document delete and replace in packages/db/src/repositories · decided by team lead · risk: high
Decided: `documentsRepo` gains `get`, `listForTeacher`, `updateStatus`, `delete` and `startReplace`. `delete` and `startReplace` are the first deletes in `repositories/`: in one transaction they lock the scope's document `FOR UPDATE`, delete its chunks, delete (or reset) the row and bump `teacher_material_revisions`. README rules 7 and 8 and `test/scope.test.ts` now allow Drizzle `.delete(` in `chunks.ts` only, on `chunks` and `documents` only, each with `eq(<table>.teacherId, teacherId)` in the same statement; `delete from` text is still banned everywhere.
Why: the accept line needs a deleted file to leave retrieval within a minute; deleting chunks and bumping the revision in the same transaction makes the next search and leakCheck miss it at once. The guard test is narrowed, not dropped, and pins exactly two scoped delete statements. Needs security-reviewer on this risky path; the lead finalises.
risk: high

### 20 Oct 2026 · 8.2 status transitions checked in the UPDATE · decided by tdd-guide
Decided: `updateStatus` only moves a document along its lifecycle (`processing` from uploading / processing / failed, `ready` from processing, `failed` from uploading / processing; `uploading` only via create and replace), checked in the same UPDATE's WHERE clause; any other state is `not_found`.
Why: a worker still processing the old file after a replace must not mark the new upload `ready`. One atomic statement, no extra round trip. Allowing processing → processing and failed → processing keeps retries working.
risk: medium

### 20 Oct 2026 · 8.2 failure reason is a fixed code, enforced twice · decided by tdd-guide
Decided: `failureReason` must match `^[a-z][a-z0-9_]{0,63}$` and is required exactly when `status` is `failed`; a database CHECK (`documents_failure_reason_only_when_failed`) keeps it null otherwise.
Why: the plan said "a short fixed IngestErrorCode-shaped string, never raw error text"; the pattern rejects anything that could carry a URL, host or message text.
risk: low

### 20 Oct 2026 · 8.2 migration 0017 backfills existing documents as ready · decided by tdd-guide
Decided: the generated migration was hand-edited to add `status` with `DEFAULT 'ready'` (backfilling every existing row) and then set the go-forward default to `'uploading'`. A migration int test checks both.
Why: as the plan required, rows ingested before this change must not show as still uploading.
risk: low

### 20 Oct 2026 · 8.2 document list cap and order · decided by tdd-guide
Decided: `listForTeacher` returns at most `DOCUMENT_LIST_MAX` (500) rows, newest first (`created_at desc, id desc`), with no paging yet. `DocumentRow` leaves out `rightsDeclaredAt`.
Why: the plan named no limit; an unbounded list is a slow-query risk, and 500 is far above a pilot teacher's upload count. Paging can come with the full studio (M13).
risk: low
