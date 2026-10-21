# 8.2 handoff: Upload centre (thin slice)

Status: DONE (Phases 1-4; the manual dev-stack run is left, see Left to do)
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
- the stale-replace race, now through the real `Queue`/`Worker` (fixed in this pass, see below):
  gate the "old" job's `storage.getObjectBytes` open, enqueue it (`oldKey`), let it start, call
  `documents.startReplace` while it's still in flight, enqueue the replacement (`newKey`) — this
  enqueue call returns immediately, proving the fix — then release the gate; the old job finishes
  `stale_skipped` and writes nothing, the new job reaches `ready` with only the new file's chunks,
  and nothing hangs (`it(..., 20_000)` timeout; the suite runs in under 1 s).
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/queue... --filter=@edmate/worker...`
  → `Tasks: 34 successful, 34 total`; `@edmate/worker` `test/ingest.int.test.ts` 4 tests, 842ms.
  `python3 .githooks/secret-scan.py --all` → clean (no output).

### Phase 2 int test bug fix (8.2d, 20 Oct 2026)
The Phase 2 int test's replace-race case (above) originally called `ingestProcessor` directly
because driving it through the real `Queue`/`Worker` hung: `enqueueIngest`'s
`jobId.ingest(documentId)` was the same id for the original upload and its replacement, and
BullMQ's `Queue.add()` with an id that is still `active` (not `waiting`/`delayed`) blocks
indefinitely rather than erroring or queueing a second attempt. Fixed by keying the ingest job id
on the document id **plus a short hash of `storageKey`**
(`packages/queue/src/queues.ts`'s `jobId.ingest(documentId, storageKey)`): a retry of the same
file still dedupes to the same id (idempotent), but a replace's new `storageKey` gets its own id
and no longer collides with a still-active old job. `enqueueIngest` (`packages/queue/src/index.ts`)
now takes `storageKey` as a third argument to compute that id; the processor is unchanged — it
never trusted the job payload's `storageKey` (there isn't one; see the Phase 2 Deviations above)
and still re-reads the row itself, so the existing stale-replace guard (the `ChunkWriter`'s
re-check right before `chunks.insertMany`) is still the backstop that drops the stale write. The
int test's replace-race case now goes through the real `Queue`/`Worker`, enqueuing both the old
and new jobs while the old one is gated in flight, and asserts the second `enqueueIngest` call
resolves without hanging.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/queue... --filter=@edmate/worker...`
  → `Tasks: 34 successful, 34 total`.
- `python3 .githooks/secret-scan.py --all` → clean (no output).

### Changes (8.2d)
- `packages/queue/src/queues.ts`: `jobId.ingest(documentId, storageKey)` (was `(documentId)`) —
  `${documentId}.ingest.${sha256(storageKey).slice(0,12)}`.
- `packages/queue/src/index.ts`: `enqueueIngest(queue, job, storageKey)` (new third argument),
  passed through to `jobId.ingest`.
- `packages/queue/test/queues.test.ts`: updated `jobId.ingest`/`enqueueIngest` cases (stable per
  document+key, differs on a new key, no `:`, not a plain integer, replace gets a distinct id).
- `apps/worker/test/ingest.int.test.ts`: the three unaffected cases now pass `storageKey` as
  `enqueueIngest`'s third argument; the replace-race case rewritten to run through the real
  `Queue`/`Worker` instead of calling `ingestProcessor` directly.

### Decisions (Phase 2 int test)

#### 20 Oct 2026 · 8.2d ingest job id is now keyed by storageKey, fixing the replace-enqueue hang · decided by tdd-guide
Decided (fixed, 8.2d): `jobId.ingest` now takes `(documentId, storageKey)` and hashes `storageKey` into the id (`packages/queue/src/queues.ts`), and `enqueueIngest` takes `storageKey` as a third argument (`packages/queue/src/index.ts`). A retry of the *same* file still dedupes to the same job id (idempotent); a replace's new `storageKey` gets a distinct id, so it no longer collides with (and block behind) a still-active old job. The processor's existing re-read-before-write guard (the `ChunkWriter`'s `storageKey` check right before `chunks.insertMany`) is unchanged and still drops the stale old job's write; `apps/worker/test/ingest.int.test.ts`'s replace-race case now drives this end to end through the real `Queue`/`Worker` and asserts the second enqueue resolves without hanging.
Why: the previous pass found that BullMQ's job-id dedupe only replaces a job still `waiting`/`delayed`, not one already `active`, so reusing `jobId.ingest(documentId)` across a replace while the old job was still processing blocked `Queue.add()` indefinitely. Keying on `storageKey` (the file actually being enqueued) rather than just the document avoids the collision without changing the processor or the job schema.
risk: medium

## Fix round (Phases 1–2 review)

Branch `m8/8.2-upload-centre` (pushed from `work-8.2e`), worktree `.claude/worktrees/agent-a2c84ab794ea9831b`.

1. **[MEDIUM, database-reviewer] storageKey check and chunk write were two round trips.**
   - New `chunks.insertManyIfStorageKey(scope, documentId, storageKey, drafts)` in `packages/db/src/repositories/chunks.ts`. It runs the existing teacher-scoped `INSERT ... SELECT` with `and d.storage_key = $key for share of d` added, so the key check and teacher scoping sit in the write statement itself. A replace or delete holding the row `FOR UPDATE` makes the insert wait; once it commits, Postgres re-checks the key against the new row version, and nothing is written.
   - 0 rows written: one read in the same transaction sorts the outcome. If the scope's document still exists the result is `{ stale: true }`; if it is missing, deleted, or another teacher's, the result is `not_found`. The revision is bumped only when rows were written. `insertMany` and the keyed method share one `insertChunkRows` helper.
   - `apps/worker/src/ingest/processor.ts` `buildWriter` now calls only `insertManyIfStorageKey`. `{ stale: true }` and `not_found` both set the stale flag. The per-batch `documents.get` read is gone (the security-reviewer LOW).
   - Tests: `documents.int.test.ts` covers a matching key (writes and bumps the revision), a key changed by `startReplace` (stale, 0 rows, no revision bump), another teacher's or a missing doc (`not_found`), **a replace committing while the insert waits on the row lock** (stale, 0 rows), a delete committing mid-wait (`not_found`), and a bad key (`invalid`). Removing `for share of d` makes the lock-wait race test fail, so it guards the fix. `repositories.int.test.ts` adds the method to the isolation grid with a new `keyDoc` per teacher, and `scope.test.ts` picks it up automatically. New worker unit tests: one `documents.get` per job, a delete mid-flight means `stale_skipped`, and a `failed` repo error is not taken for stale.
2. **[MEDIUM, security-reviewer] whole S3 object buffered before the size cap.**
   - `StorageClient.getObjectBytes(key, maxBytes)` now streams the body (an async-iterable Node Readable) with a running byte count. It refuses a `ContentLength` over the cap before reading, and stops at the first chunk past the cap when `ContentLength` is missing or wrong, destroying the stream in both cases. It throws `ObjectTooLargeError`, whose message names only the cap, never the key or bucket.
   - The processor passes `MAX_DOCUMENT_BYTES` and maps `ObjectTooLargeError` to `IngestError('input_too_large', false)`: the same code `parseDocument` uses, so the document lands in `failed` / `input_too_large` and the job fails permanently.
   - Unit tests use fake async-iterable bodies, with no S3. They cover a multi-part join at exactly the cap, `ContentLength` over the cap (0 parts pulled, stream destroyed), running past the cap with no or a lying `ContentLength` (stops after 2 parts), no key or bucket in the message, and a non-stream body.

Evidence:
- `TEST_DATABASE_URL=... TEST_REDIS_URL=redis://127.0.0.1:56379 corepack pnpm turbo run typecheck lint test --filter=@edmate/db... --filter=@edmate/worker...` gives `Tasks: 34 successful, 34 total`: db 45 files passed (repositories at 100% coverage) and worker 20 files passed, including the int tests.
- `python3 .githooks/secret-scan.py --all` is clean.

## Phase 3

apps/web: the studio document API (list, create + presigned upload, complete, replace, delete).
Branch `m8/8.2-upload-centre` (pushed from `work-8.2f`), worktree
`.claude/worktrees/agent-ad42dcb5907a138ef`. `origin/main` (9.1) was merged in first with a
normal merge commit; no conflicts.

### Acceptance evidence
- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run
  typecheck lint test build --filter=@edmate/web...` → `Tasks: 35 successful, 35 total`.
- `@edmate/web`: `Tests 430 passed | 4 skipped`; coverage all files 99.18 / 98.84 / 98.32 / 99.51;
  `src/storage/presign.ts`, `src/studio/files.ts`, `src/studio/runtime.ts` 100%;
  `src/studio/routes.ts` 98.77 / 98.79 / 95.83 / 100; the `src/auth/**` thresholds still pass.
- `src/studio/routes.test.ts` (46 tests, memory backend, no S3/Redis/DB): every route has a
  cross-teacher case (Ben on Asha's document → 404 `not_found`; nothing written, deleted, signed or
  enqueued); complete calls `updateStatus('processing')` **before** `enqueue` (asserted by call
  order) and passes the row's `storageKey`; a missing object is 409; an oversized or length-less
  object is 413, `failed/input_too_large`, object deleted; a type mismatch is 400,
  `failed/unsupported_type`; an enqueue failure is 503, `failed/enqueue_failed`, and a retry then
  succeeds; replace deletes `previousStorageKey`; the body cap is 413 on both a declared and a read
  oversize body; client-sent `teacherId`/`storageKey`/`kind` are refused (strict schema); a
  `teacherId` in the list query is ignored. Through the **real** `createGuard` + `ROUTE_POLICY`:
  anonymous 401, student/staff 403, cross-origin DELETE 403, Ben's DELETE of Asha's doc 404.
- `src/storage/presign.test.ts`: a real `S3Client` with placeholder credentials signs locally
  (no network): `X-Amz-SignedHeaders` contains `content-length`, `content-type`, `host`; expiry
  ≤ 15 min; a length outside 1..n is refused before signing; HEAD/DELETE over a fake `send`.
- `src/auth/route-coverage.test.ts` picks up the four new route files (all
  `withRole(['teacher'])`, agreeing with policy); the guard's role×route matrix now prints
  `DELETE /api/studio/x/y anonymous=401 student=403 teacher=200 staff=403`.
- `python3 .githooks/secret-scan.py --all` → clean (no output).

### Changes
- `apps/web/src/auth/policy.ts`: `'DELETE'` added to the `/api/studio/**` row (one line).
- `apps/web/src/auth/guard.test.ts`: the old `DELETE /api/studio/packages → null` assertion is now
  `DELETE /api/studio/documents/doc_1 → ['teacher']`, plus `DELETE /api/studio` and
  `/api/staff/reports` still null. (The plan named `policy.test.ts`, which doesn't exist; the
  policy assertions live in `guard.test.ts`.)
- `apps/web/src/storage/presign.ts` (+ test): `storageConfigFromEnv` (duplicated from apps/worker;
  its errors no longer echo the value) and `s3StudioStorage(client, bucket)` with
  `createUploadUrl({ key, contentType, contentLength })`, `head(key)`, `deleteObject(key)`.
- `apps/web/src/studio/files.ts` (+ test): the upload-type allowlist (content type → file kind,
  chunk kind, cap, extension), `newStorageKey`, `uploadTypeOfKey`.
- `apps/web/src/studio/routes.ts` (+ test): `createStudioHandlers(backend, log)` → `list`,
  `create`, `complete`, `replace`, `remove`; a capped JSON body reader (same shape as 9.4's).
- `apps/web/src/studio/runtime.ts` (+ test): the lazy backend (its own `openDatabase` pool, an
  `S3Client`, the ingest queue on `REDIS_URL`); a failed build is not cached.
- `apps/web/src/studio/index.ts`: `studioHandlers` over the real hooks.
- `apps/web/app/api/studio/documents/route.ts` (GET, POST), `[id]/route.ts` (DELETE),
  `[id]/complete/route.ts` (POST), `[id]/replace/route.ts` (POST).
- `apps/web/package.json` (+ lockfile): `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`
  `3.1152.0` (the versions apps/worker already uses).

### API for Phase 4
```
GET    /api/studio/documents[?moduleId=]  → 200 { documents: [{ id, moduleId, kind, sourceTitle,
                                             status, failureReason?, createdAt, updatedAt }] }
POST   /api/studio/documents  { moduleId, sourceTitle, contentType, byteSize }
                              → 201 { documentId, uploadUrl, uploadHeaders: { 'content-type' } }
PUT    <uploadUrl>  (browser → bucket) with exactly uploadHeaders and exactly byteSize bytes
POST   /api/studio/documents/:id/complete → 202 { documentId, status: 'processing' }
                              | 200 (already ready) | 409 (not uploaded yet) | 413 | 400 | 503
POST   /api/studio/documents/:id/replace  { contentType, byteSize } → 200 (same body as create);
                              then PUT and complete again
DELETE /api/studio/documents/:id → 204
```
Allowed `contentType`s: `application/pdf`, the docx and pptx OOXML types, `text/markdown`,
`audio/mpeg`, `audio/wav`, `audio/mp4`, `video/mp4`, `video/webm`. Caps: 20 MB documents,
500 MB audio/video. Errors are the usual `{ error: { code, message, retryable } }`.

### Deviations
- **The create body is `{ moduleId, sourceTitle, contentType, byteSize }`, not `{ moduleId, kind,
  sourceTitle }`.** The document's retrieval `kind` is derived on the server from the content
  type (audio/video → `transcript`, everything else → `material`); the presign needs the type
  and exact size anyway. See Decisions.
- **No `apps/web/src/auth/index.ts` change.** The studio backend opens its own `openDatabase`
  pool instead of reusing the auth runtime's (9.4's open branch adds a `serverDatabase()` export
  there; touching the same file now would conflict and widen the risky-path diff). Once 9.4
  merges, a follow-up can switch `realHooks.repos` to `serverDatabase().repos`.
- **A narrow complete/replace race is left open.** Complete reads the row's `storageKey`, HEADs
  it, then writes `processing`. A replace landing between that read and the write leaves the row
  `processing` with the *new* key and a job enqueued for the old key's file kind; the worker reads
  the new key (not uploaded yet), retries, then dead-letters. The teacher's own `complete` for the
  new upload then moves it on (`processing → processing` is allowed and the new key gets its own
  job id), so it heals itself. A key-conditional `updateStatus` would close it, but that is a
  packages/db change, outside this phase.

## Fix round (Phase 3 review)

Branch `m8/8.2-upload-centre` (pushed from `work-8.2g`), worktree
`.claude/worktrees/agent-a0e02f32c20b1e10d`. `origin/main` (9.4) merged in first with a normal
merge commit, no conflicts. Tests written first, red, then green.
- **(a) No dev fallback in production.** `storageConfigFromEnv` (`src/storage/presign.ts`) under
  `NODE_ENV=production` throws `StorageConfigError` (a `code` naming the setting, never its value)
  when `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` or `S3_BUCKET` is missing or
  blank (`<NAME>_missing`), or the endpoint isn't https (`S3_ENDPOINT_not_https`). The studio
  runtime turns it into `StudioUnavailableError(code)`: the routes answer 503 and log
  `studio.unavailable reason=<code>` only. Dev and test defaults are unchanged. The compose stack
  runs the web image with `NODE_ENV=production` against `http://minio:9000`, so it opts out with
  an explicit `S3_ALLOW_HTTP: 'true'` (see Decisions).
- **(b) Sign before replace.** `replace` now checks the document is the teacher's (`get`), signs
  the new upload URL, and only then calls `startReplace`. A signing failure is a logged 500 with
  the row, its key and the old file untouched; another teacher's id still gets nothing signed.
- **(c) One pool.** `realHooks.repos` is `serverDatabase().repos` from `src/auth/index.ts` (9.4);
  `src/studio/runtime.ts` no longer imports `openDatabase`. No `src/auth/**` file changed.

### Acceptance evidence
- `src/storage/presign.test.ts` (17): every missing/blank production setting throws its code; an
  http endpoint throws `S3_ENDPOINT_not_https` and the message doesn't quote the host; the
  `S3_ALLOW_HTTP=true` opt-in (only the exact `'true'`); `NODE_ENV=development|test` keep the
  defaults.
- `src/studio/runtime.test.ts`: a production gap rejects with `StudioUnavailableError` reason
  `S3_ACCESS_KEY_ID_missing` / `S3_ENDPOINT_not_https` before any repo is opened;
  `realHooks.repos()` returns the (mocked) `serverDatabase().repos`.
- `src/studio/routes.test.ts`: "a signing failure commits nothing" (500; row deep-equal to before;
  no object deleted).

## Phase 4

apps/web: the teacher upload centre at `/teacher/uploads`.

### Acceptance evidence
- `TEST_DATABASE_URL=postgres://edmate:edmate-dev@127.0.0.1:55432/edmate corepack pnpm turbo run
  typecheck lint test build --filter=@edmate/web...` → `Tasks: 35 successful, 35 total`;
  `@edmate/web` `Tests 699 passed | 4 skipped (703)`; coverage all files 98.51 / 98.35 / 96.25 /
  99.22; `presign.ts` 100%; `uploadClient.ts` 100 / 94.44 / 100 / 100; studio `runtime.ts`
  100 / 88.88 / 100 / 100.
- `app/teacher/uploads/UploadsView.test.tsx` (14; RTL; fetch stubbed with an in-memory studio API;
  the PUT injected): status words incl. failure reasons and an unknown code; empty state; no
  upload control without a module; create sends exactly `{ moduleId, sourceTitle, contentType,
  byteSize }` (Markdown with an empty browser type → `text/markdown`; the exact `file.size`); the
  PUT gets exactly `uploadHeaders`; complete runs after the PUT; a failed PUT never calls complete;
  409 → "hasn't arrived yet" + Try again; 503 → words; `enqueue_failed` rows get Try again;
  413 → "too big"; an unsupported file is refused before any POST; module picker; replace via the
  hidden picker then complete; delete only after confirm (Cancel keeps it); list 401 → alert;
  **fake timers: one list call per 4 s tick while processing, the row flips to Ready, and polling
  stops once nothing is moving**; a `<b>` title renders as text; **jest-axe: zero violations**
  (files, retry, module select and an open delete confirm).
- `src/studio/uploadClient.test.ts` (9): the client type table equals `UPLOAD_TYPES`; error
  bodies → `{ status, code }`, non-JSON/network → `provider_error`; ids URL-escaped; `putFile`
  (fake XHR) sends PUT + exactly the headers + the file, reports progress, rejects on 4xx, error
  and abort.
- `app/teacher/uploads/page.test.tsx`: `requireRole(['teacher'])` runs before the module read,
  which uses the session's `userId`; a refused guard reads nothing. `app/teacher/view.test.tsx`:
  the "Uploads" nav link.
- `src/chat/no-raw-html.test.ts` now also scans `app/teacher` and `src/studio`: clean.
- MinIO CORS (`docker compose up -d minio`, preflight `OPTIONS` for a PUT with `content-type`):
  origin `http://localhost:8080` → `204`, `Access-Control-Allow-Origin: http://localhost:8080`,
  `Access-Control-Allow-Methods: PUT`; origin `http://evil.test` → `204` with **no** CORS headers.
- `python3 .githooks/secret-scan.py --all` → clean (no output).
- **Not done:** the plan's manual dev-stack run (browser upload of a PDF and an audio clip through
  MinIO and the worker, then delete + retrieval miss). See Left to do.

### Changes
- `app/teacher/uploads/page.tsx` (new): teacher guard, the teacher's module ids from
  `serverDatabase().repos.modules.ids`, `AppShell` with Studio/Uploads nav, only the `uploads`
  strings sent to the client.
- `app/teacher/uploads/UploadsView.tsx` (new, client): file picker (`accept` = allowed types),
  progress %, the status list with ~4 s polling (one timeout per list change while any row is
  `uploading`/`processing`), Try again (complete) on 409/5xx and `enqueue_failed`, replace via a
  hidden picker, delete with an inline confirm; errors in a `role="alert"` paragraph.
- `app/teacher/uploads/uploads.css` (new): mobile-first (stacked rows, 44 px targets).
- `src/studio/uploadClient.ts` (new, client-safe): the API calls, `contentTypeFor`, `ACCEPT`,
  `putFile` (XHR for progress; never sets `content-length`: the browser sends `file.size`, which
  is the signed `byteSize`).
- `app/teacher/view.tsx`: Studio + Uploads nav. `messages/en.json`: `teacher.nav`,
  `teacher.uploadsLink`, the `uploads` namespace (words for `input_too_large`,
  `unsupported_type`, `enqueue_failed`, `unsupported`, `validation`, `provider_error`, and a
  fallback for any other reason code).
- `src/storage/presign.ts`: `StorageConfigError`, the production rules, `S3_ALLOW_HTTP`,
  `S3_PUBLIC_ENDPOINT` (`publicEndpoint`), `s3StudioStorage(client, bucket, signer?)`.
  `src/studio/runtime.ts`: the code-only 503, `serverDatabase()`, a second S3 client for signing
  only when a public endpoint is set.
- `docker/compose.yaml`: MinIO `MINIO_API_CORS_ALLOW_ORIGIN` = `${AUTH_URL}` and
  `http://localhost:3000`; web `S3_PUBLIC_ENDPOINT=http://localhost:${EDMATE_S3_PORT}` and
  `S3_ALLOW_HTTP='true'`. `docker/env.example`: notes.

### Deviations
- `S3_PUBLIC_ENDPOINT` was not in the plan. Without it the compose web app signs upload URLs for
  `http://minio:9000`, which a browser can't reach, so the CORS rule alone wouldn't make browser
  uploads work on the dev stack.
- The CORS rule is MinIO's server-wide `MINIO_API_CORS_ALLOW_ORIGIN`, not a per-bucket rule (env
  config, no setup script). MinIO always answers `Allow-Credentials: true` for an allowed origin;
  the origin list is never `*`, and `putFile` sends no credentials.
- The fetch/PUT helpers live in `src/studio/uploadClient.ts` (not inside `UploadsView.tsx`) so
  they are unit-tested apart from React.

## Left to do
- **Manual dev-stack run** (plan § Evidence 3): `docker compose up` (web, worker, MinIO), sign in
  as a teacher with a module, upload a small synthetic PDF and a short synthetic audio clip, watch
  them reach Ready, delete one and confirm a retrieval search misses it; paste timestamps here.
  Check the MinIO bucket exists first.
- Reviews: security-reviewer on the fix round (production config, compose `S3_ALLOW_HTTP`, CORS);
  code-reviewer on the page.
- Follow-ups (not blocking): apps/worker's `storageConfigFromEnv` has the same dev fallback under
  production; a key-conditional `updateStatus('processing')` in packages/db to close the
  complete/replace race; module names in the picker once a modules repo returns titles;
  web-link/YouTube ingestion (deferred).

## Decisions

### 20 Oct 2026 · 8.2 fix round: production S3 config is refused, not defaulted; the dev stack opts out of https explicitly · decided by tdd-guide
Decided: under `NODE_ENV=production` the web's storage config needs `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_BUCKET` set and an https endpoint; otherwise the studio routes answer 503 and log only a code such as `S3_ENDPOINT_not_https`. `S3_BUCKET` is required too (the review named credentials and endpoint; uploading production files into the dev bucket name is the same mistake). Because the local compose stack runs the web image with `NODE_ENV=production` against `http://minio:9000`, compose sets `S3_ALLOW_HTTP: 'true'`; only the exact string `true` opts out.
Why: a silent fallback to the dev key pair or plain http in production is the review's finding; an explicit, greppable opt-in keeps the local stack working without weakening the default.
risk: medium

### 20 Oct 2026 · 8.2 Phase 4: upload URLs are signed for S3_PUBLIC_ENDPOINT when set · decided by tdd-guide
Decided: a new optional `S3_PUBLIC_ENDPOINT` (same http/https rules) makes the studio sign upload URLs with a second S3 client on that host, while HEAD and DELETE keep the internal endpoint. Compose sets it to MinIO's published port.
Why: the browser can't reach `minio:9000`; without this no browser upload works on the dev stack. A production deployment with one public S3 endpoint leaves it unset.
risk: low

### 20 Oct 2026 · 8.2 Phase 4: MinIO CORS by server env, web origins only · decided by tdd-guide
Decided: `MINIO_API_CORS_ALLOW_ORIGIN` on the dev MinIO lists `${AUTH_URL:-http://localhost:8080}` and `http://localhost:3000` (next dev). Checked by preflight: the web origin gets `Allow-Origin` for PUT; any other origin gets no CORS headers.
Why: it is the dev image's CORS switch (env only, no setup script) and replaces MinIO's default `*`. MinIO always adds `Allow-Credentials: true` for an allowed origin, so the list must never be `*`; presigned PUTs send no cookies. Dev only; production bucket CORS belongs to deployment.
risk: low

### 20 Oct 2026 · 8.2 Phase 4: the studio backend reuses serverDatabase() · decided by tdd-guide
Decided: supersedes "studio backend opens its own database pool" below. With 9.4 merged, `realHooks.repos` is `serverDatabase().repos`; no `src/auth/**` change.
Why: one pool per web process, as the Phase 3 review asked.
risk: low

### 20 Oct 2026 · 8.2 Phase 4: upload centre behaviour · decided by tdd-guide
Decided: the page lists all of the teacher's documents (no module filter); uploads go to the first module, with a "Module n" picker only when the teacher has several (the modules repo returns ids, not titles; MVP is one course per teacher). Polling is one list call 4 s after each list change while anything is `uploading`/`processing`, so an abandoned upload keeps polling while the page is open. On a 409 or 5xx from complete the row offers Try again (complete only, no re-upload); a failed PUT asks the teacher to replace the file. Delete needs an inline confirm. The client takes the browser's content type, else the extension's (Markdown often reports none).
Why: the plan's thin slice plus the Phase 3 handoff notes (exact headers and size, complete after the PUT, 409 = not landed, words for each reason code), with no new dependency.
risk: low

### 20 Oct 2026 · 8.2 Phase 4: web-link ingestion deferred · decided by team lead (per plan)
Decided: web-link and YouTube ingestion stay out of 8.2; the upload centre takes files only.
Why: plan § Scope; logged on Phase 4's merge as the plan asked. The open question to the human stands.
risk: low

### 20 Oct 2026 · 8.2 Phase 3: DELETE on /api/studio/** in ROUTE_POLICY · decided by tdd-guide · risk: high
Decided: the `/api/studio/**` row in `apps/web/src/auth/policy.ts` gains `'DELETE'` (one line, as the plan said), so teachers can call `DELETE /api/studio/documents/:id`. Students, staff and anonymous callers are still refused; the guard test's role×route matrix and policy assertions cover it.
Why: the upload centre must be able to delete a file. The row stays teacher-only, and every handler scopes to the session's teacher, so no one gains reach beyond their own documents. Risky path (`apps/web/src/auth/**`): needs security-reviewer; the lead finalises.
risk: high

### 20 Oct 2026 · 8.2 Phase 3: browser uploads by presigned PUT with signed type and exact length · decided by tdd-guide
Decided: the plan's storage design, as built. The browser PUTs straight to the bucket with a 15-minute presigned URL. `content-type` and `content-length` are signed headers, so the bucket refuses any other type or size, and the length must be within the type's cap (20 MB documents, 500 MB audio/video). The key is `teachers/<teacherId>/documents/<documentId>/<uuid>.<ext>`, built only on the server. Complete learns the file type from that key's extension and checks size and type again with HEAD before it enqueues. The S3 code is lightly duplicated from apps/worker: no shared package, no contracts port.
Why: a presigned PUT can't carry a POST policy's `content-length-range`, so the exact declared size is signed instead, and HEAD on complete is the second check. Taking nothing about the key or type from the client means one teacher's upload can't land anywhere else.
risk: medium

### 20 Oct 2026 · 8.2 Phase 3: create takes contentType and byteSize; the retrieval kind is derived · decided by tdd-guide
Decided: `POST /api/studio/documents` takes `{ moduleId, sourceTitle, contentType, byteSize }` (strict). The document's `kind` is `transcript` for audio/video and `material` otherwise; clients can't choose it (`teacher_note` isn't an upload).
Why: the plan listed `{ moduleId, kind, sourceTitle }`, but the presign needs the type and size, and letting the client pick `kind` would let any upload pose as a teacher note.
risk: low

### 20 Oct 2026 · 8.2 Phase 3: how complete handles failures · decided by tdd-guide
Decided: complete returns 409 while the object isn't there yet, and writes nothing. An object over its cap or with no length becomes `failed/input_too_large`, the object is deleted, and the answer is 413; a type mismatch becomes `failed/unsupported_type` (400). An enqueue failure marks the document `failed/enqueue_failed` and answers 503 (retryable); calling complete again works (`failed → processing`). A document already `ready` answers 200 and enqueues nothing.
Why: the row must never sit in `processing` with no job behind it, and a teacher must be able to retry without uploading again.
risk: low

### 20 Oct 2026 · 8.2 Phase 3: studio backend opens its own database pool · decided by tdd-guide
Decided: `src/studio/runtime.ts` lazily opens its own `openDatabase` pool, an S3 client and an ingest queue on `REDIS_URL`, rather than adding a `serverDatabase()` export to `src/auth/index.ts`. A failed build is not cached: the routes answer 503 and the next request tries again.
Why: 9.4 adds that export on its open branch; adding it here too would conflict and widen this PR's risky-path diff beyond the one policy line. One extra small pool per web process is fine for the pilot; switch once 9.4 merges.
risk: low

### 20 Oct 2026 · 8.2 Phase 3: studio body cap 16 KB · decided by tdd-guide
Decided: studio routes read at most 16 KB of JSON (`MAX_BODY_BYTES`). A declared content-length over it, or bytes read past it, is refused with 413. The reader is the same as 9.4's turn routes (copied, since 9.4 isn't merged).
Why: the bodies hold a title, a module id, a type and a size; files never pass through the web server.
risk: low

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

### 20 Oct 2026 · 8.2 keyed chunk insert: stale vs not_found · decided by tdd-guide
Decided: `chunks.insertManyIfStorageKey` returns `{ stale: true }` when the scope's document exists but its storage key moved on, and throws `not_found` when the document is missing or belongs to another teacher. The worker treats both as a stale drop. The guard is one `INSERT ... SELECT ... for share of d` statement; a read in the same transaction runs only after 0 rows, and only to pick between the two outcomes.
Why: the isolation grid needs a write to another teacher's document to fail closed with `not_found`, and a share lock in the insert makes Postgres re-check the key after a concurrent replace commits.
risk: high (packages/db/src/repositories is a risky path)

### 20 Oct 2026 · 8.2 worker download cap · decided by tdd-guide
Decided: `getObjectBytes` takes a required `maxBytes` and streams with a running count. An oversized object becomes `input_too_large`, the code the parser already uses.
Why: security review; an upload far over 20 MB must never be held in memory whole.
risk: low
