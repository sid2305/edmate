# 8.2 plan: Upload centre with live processing status, delete and replace

Part of the human-approved thin slice (decision log, 20 Oct 2026). Depends on GATE (waived for
this build, same as 9.1/8.1), 1.3, 5.1, 5.2, 8.1 (all DONE).

## Acceptance (verbatim)
"status updates live; a deleted file leaves retrieval within 1 minute."

### How it's shown
1. **Deterministic, every PR (int tests over real Postgres/Redis/MinIO, no live model calls):**
   - A document moves `uploading` → `processing` → `ready` (or `failed`) as
     `documentsRepo`/the ingest worker drive it; asserted directly on the row.
   - A delete removes the document's chunk rows and the document row in one transaction and
     bumps `teacher_material_revisions` (existing ADR-0007 cache key) — so a `retrievalRepo`
     search for that teacher sees zero hits from the deleted document on the very next call, not
     after any TTL wait. This clears the 1-minute bar with margin; the int test asserts it's
     immediate, not just "within a minute".
2. **"Live" = short-interval polling, not a new real-time transport.** The upload-centre page
   polls `GET /api/studio/documents?moduleId=` every ~4s while any row is `uploading`/
   `processing`, and stops polling once every row is `ready`/`failed`. This meets the accept line
   (status changes reach the screen without a manual refresh) without adding SSE/WebSockets,
   which would be scope creep for a thin slice and arguably a tech-stack question of its own.
   A component test (fetch stubbed, fake timers) proves the view re-renders after a poll tick.
3. **One manual evidence step per phase-4 handoff (not CI-wired, mirrors 9.1's Lighthouse step):**
   upload a small fixture PDF and a short fixture audio/video clip through the dev stack
   (docker compose: Postgres, Redis, MinIO, the worker), watch status flip to `ready`, then
   delete it and confirm a retrieval search returns nothing from it. Timestamps pasted into the
   handoff.

## How files are stored in this thin slice (no storage port exists yet)
- **Tech is already decided — no new ADR.** ADR-0001 already names "S3-compatible object
  storage (MinIO locally), signed URLs only." `apps/worker/src/storage/roundtrip.ts` already
  proves the bucket round-trips; 8.2 is the first task to actually put teacher files through it.
- **Browser uploads straight to the bucket** with a presigned PUT URL apps/web generates
  (`@aws-sdk/s3-request-presigner`, same SDK family already a dependency, so — like 9.1 adding
  next-intl — not a tech-stack ADR under rule 2, just an implementation detail). This avoids
  proxying large video files through the Next.js server and matches "signed URLs only."
- **The worker touches the bucket with its own real credentials** (not a signed URL — it isn't
  browser-facing): `GetObjectCommand` to fetch bytes for PDF/DOCX/PPTX/Markdown (capped at
  ingest's existing `MAX_DOCUMENT_BYTES`, 20 MB), and a short-lived signed GET URL handed to the
  existing `Transcriber` port for video/audio (this is exactly what `TranscribeInputSchema`'s doc
  comment already describes: "an https signed URL to Edmate's own storage").
- **No shared `packages/storage` and no `packages/contracts` port.** The S3 client code is a
  small plain module duplicated (lightly) between `apps/web` (presign PUT, delete) and
  `apps/worker` (get, presign GET, delete) — apps don't import each other in this repo, and
  packages/harness's "ports only" rule (rule 3) doesn't bind apps/web or apps/worker. **Flagging,
  not blocking:** if the human would rather this live in a shared package from the start, say so;
  otherwise the plan proceeds as above (no ADR is actually required either way, since
  `packages/contracts` is untouched).
- **Retrieval is unchanged.** Chunks are full-text searchable as soon as `chunksRepo.insertMany`
  writes them (5.3's existing behaviour, embeddings arrive later) — a document's `status` is a
  studio-facing display field only, never a retrieval gate. `retrieval.ts` is out of bounds.

## Scope kept minimal (decision, not a blocker)
File uploads only this task: PDF, DOCX, PPTX, Markdown and video/audio (reusing 5.1/5.2's exact
kinds). **Web-link ingestion (PRD T2's "links and YouTube videos") is deferred** — the accept line
doesn't name it, and `parseWebLink` has no `storageKey`/delete/replace shape to reuse, so folding
it in now would roughly double this task. Logged as a decision; a follow-up board task, not a
missing requirement.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- Phase 1 — `packages/db/src/repositories/**` (documents/chunks changes) → **security-reviewer**.
- Phase 2 — none. `packages/queue/**` and `apps/worker/**` outside `apps/worker/src/alerts/**`
  match no glob.
- Phase 3 — `apps/web/src/auth/**` (one line in `policy.ts`) → **security-reviewer**. The new
  `apps/web/app/api/studio/**` route files match no glob on their own but are reviewed in the same
  PR as the risky file, same precedent as 9.1 Phase B.
- Phase 4 — none.
- No phase touches `packages/contracts/**` or `docs/adr/**` — no architect/typescript-reviewer
  trigger, no ADR.
- Every risky phase above plans a `risk: high` decision entry on merge.

## Phase 1 — packages/db: document status, get/list/delete/replace
Non-web, first. No dependency on 9.1. ~10-12 files.

### Files to create/modify
- `packages/db/src/schema/_shared.ts` — add `documentStatus = pgEnum('document_status',
  ['uploading', 'processing', 'ready', 'failed'])`, same precedent as 8.1's
  `teacherVerificationStatus`.
- `packages/db/src/schema/content.ts` — `documents.status` (not null), `documents.failureReason`
  (nullable text, a short fixed `IngestErrorCode`-shaped string, never raw error text — same
  "fixed code, never text" convention `errors.ts`/the ingest package already follow).
- `packages/db/src/schema/index.ts` — export `documentStatus`.
- Generated migration (`db:generate`) + its `meta/*_snapshot.json` + `meta/_journal.json`.
  **Hand-check required** (like 8.1's handoff flagged for its enum column): the generated
  `ADD COLUMN status ... DEFAULT 'uploading'` would wrongly mark every already-ingested row
  (fixtures/tests only — no real production rows exist pre-pilot) as still uploading. The
  migration must backfill existing rows to `'ready'` and only then set the column's **go-forward**
  default to `'uploading'` (two statements, same column) — mirrors 8.1's exact concern.
- `packages/db/src/repositories/chunks.ts` — `documentsRepo` gains `get(scope, id)`,
  `listForTeacher(scope, { moduleId? })`, `updateStatus(scope, id, status, failureReason?)`,
  `delete(scope, id)` (one transaction: delete the document's chunks, delete the document row,
  bump the revision; returns the `storageKey` so the caller can delete the S3 object),
  `startReplace(scope, id, { storageKey })` (same transaction shape as `delete`, but resets
  `status` to `uploading` and the row's `storageKey` instead of removing the row). A missing or
  another teacher's document is `not_found` throughout, consistent with `create`.
- `packages/db/src/repositories/index.ts` — export the new types (`DocumentRow`, `DocumentStatus`,
  whatever `map.ts` needs).
- `packages/db/src/repositories/map.ts` (edit, if a `DocumentRow` mapper is added).
- Tests: `test/schema.test.ts` (new enum), `test/chunk-writer.test.ts` and
  `test/repositories.int.test.ts` (new isolation `CASES` for every new method),
  new `test/documents.int.test.ts` (status transitions, delete removes chunks + bumps revision and
  a subsequent `retrieval` search misses, replace clears old chunks and resets status, every
  not_found/scope case).

### Tests first
Isolation cases and `documents.int.test.ts` written red before the repository methods exist.

### State after this phase
`documentsRepo`/`chunksRepo` can drive a document through its whole lifecycle; nothing calls them
yet. `pnpm turbo run typecheck lint test --filter=@edmate/db...` green; secret scan clean.

## Phase 2 — packages/queue + apps/worker: the ingest queue and worker
Non-web, second; depends on Phase 1 merged. ~12-15 files.

### Files to create/modify
- `packages/queue/src/queues.ts` — `INGEST_QUEUE = 'edmate-ingest'`, `JOB.ingestProcess`, an
  `IngestJobSchema` (`{ teacherId, documentId }`, strict), a `jobId.ingest(documentId)` helper,
  `jobOptions`-style retry/TTL constants (reuse `RETRY`/`FAILED_JOB_TTL_SECONDS`).
- `packages/queue/src/index.ts` — export the above; a small `queuedIngestTrigger`-style producer
  if that reads cleaner than calling `queue.add` directly from apps/web (builder's call).
- `packages/queue/test/queues.test.ts` — the new schema/job-id tests.
- `apps/worker/src/storage/client.ts` (new) — thin wrapper over `@aws-sdk/client-s3` for
  `getObjectBytes(key)`, `getSignedDownloadUrl(key, ttl)` (for the video/audio case) and
  `deleteObject(key)`, built on the existing `storageConfigFromEnv`/`S3Like` from
  `storage/roundtrip.ts` (reused, not duplicated).
- `apps/worker/src/ingest/gateway.ts` (new) — composes the real embedder and transcriber once at
  process start, reusing **existing** `@edmate/gateway` exports exactly as
  `packages/db/scripts/record-demo-embeddings.ts` already does:
  `loadProviderKeys({ source: envKeySource(env), required: ['openai'] })`,
  `createEmbeddingAdapter(keys.get('openai'))`, `createWhisperTranscriber({ allowedHosts: [...] })`
  (allowlist = the configured S3 host only, per ADR-0005). No new provider wiring invented here.
- `apps/worker/src/ingest/processor.ts` (new) — `ingestProcessor(repos, storage, deps, log)`:
  loads the document row (`documentsRepo.get`), builds a `ChunkWriter` inline from
  `repos.chunks`/`repos.documents` scoped to the job's teacher, builds the right
  `IndexDocumentInput` source per `kind` (bytes for pdf/docx/pptx/markdown via
  `storage.getObjectBytes`; a `VideoSource` with a signed GET url for video/audio), calls
  `@edmate/ingest`'s `indexDocument`, then `updateStatus('ready')` or, on a thrown `IngestError`,
  `updateStatus('failed', error.code)`. A malformed job payload is a `PermanentJobError` (same
  pattern as `commit/processors.ts`).
- `apps/worker/src/ingest/workers.ts` (new) — the BullMQ `Worker` for `INGEST_QUEUE`, concurrency
  1 (documents aren't latency-sensitive the way turns are), `permanentToUnrecoverable` reused from
  `commit/workers.ts`, failures to the existing dead-letter queue.
- `apps/worker/src/ingest/index.ts` (new) — barrel export.
- `apps/worker/src/index.ts` (edit) — wire the ingest worker into the process, same shape as the
  existing `turn`/`costAlarm`/`alert` wiring; add it to `workers` (shutdown) and its `error`
  listener.
- `apps/worker/package.json` (edit) — add `@edmate/ingest`, `@edmate/gateway`,
  `@aws-sdk/s3-request-presigner` (dependencies); these are existing in-repo packages / the
  existing AWS SDK family, not a new tech choice (ADR-0001 already names S3; rule 2 doesn't apply,
  same precedent as 1.4 adding nodemailer/ioredis without one).
- Tests: `apps/worker/src/storage/client.test.ts`, `apps/worker/src/ingest/processor.test.ts`
  (fake `ChunkWriter`/embedder/transcriber, no real provider/network calls — rule 4), new
  `apps/worker/test/ingest.int.test.ts` (real Postgres/Redis, a fixture PDF through the whole
  queue → worker → `ready` path; an embed/transcribe failure path with a scripted gateway double
  → `failed` with a fixed code).

### Tests first
`processor.test.ts`'s success/failure branches and `queues.test.ts`'s schema cases written red
before the processor/queue code.

### State after this phase
A document enqueued on `INGEST_QUEUE` is fully processed by the worker with no apps/web change
yet. `pnpm turbo run typecheck lint test --filter=@edmate/queue... --filter=@edmate/worker...`
green; no real model/storage calls in the test suite; secret scan clean.

## Phase 3 — apps/web: the studio document API
Starts after **both** 9.1 merges (lead's sequencing call, to keep one builder at a time in
apps/web) **and** Phase 2 merges (needs the queue to enqueue into). ~12-13 files.

### Files to create/modify
- `apps/web/src/auth/policy.ts` (edit) — add `'DELETE'` to the existing
  `{ pattern: '/api/studio/**', methods: [...], access: ['teacher'] }` row's `methods`. One line.
- `apps/web/src/auth/policy.test.ts` (edit) — the new method/pattern case.
- `apps/web/src/storage/presign.ts` (new) — `createUploadUrl({ key, contentType, maxBytes })` via
  `@aws-sdk/s3-request-presigner`'s `getSignedUrl` + `PutObjectCommand`, and `deleteObject(key)`;
  config read the same way `storageConfigFromEnv` does in apps/worker (small, deliberately
  duplicated — see "how files are stored" above).
- `apps/web/src/storage/presign.test.ts` (new).
- `apps/web/app/api/studio/documents/route.ts` (new) — `GET` (`withRole(['teacher'])`): list the
  signed-in teacher's documents, optionally filtered by `moduleId` (always from the session's
  principal, never from the query string, per the acting-user-id rule). `POST`: validates
  `{ moduleId, kind, sourceTitle }`, creates the document row (`status: 'uploading'`) and returns
  `{ documentId, uploadUrl }`.
- `apps/web/app/api/studio/documents/route.test.ts` (new).
- `apps/web/app/api/studio/documents/[id]/route.ts` (new) — `DELETE`: deletes chunks + document
  row (teacher-scoped via the session, not the URL alone — `documentsRepo.delete` re-checks
  ownership), then best-effort `deleteObject` on the returned storage key (logged on failure, not
  retried — the DB delete alone already satisfies the accept line).
- `apps/web/app/api/studio/documents/[id]/route.test.ts` (new).
- `apps/web/app/api/studio/documents/[id]/complete/route.ts` (new) — `POST`: `HeadObjectCommand`
  to confirm the browser's PUT landed and is within the size cap, sets `status: 'processing'`,
  enqueues the ingest job.
- `apps/web/app/api/studio/documents/[id]/complete/route.test.ts` (new).
- `apps/web/app/api/studio/documents/[id]/replace/route.ts` (new) — `POST`: `startReplace`, new
  storage key, returns a fresh `uploadUrl` (teacher then calls `complete` again).
- `apps/web/app/api/studio/documents/[id]/replace/route.test.ts` (new).

### Tests first
Every route's `.test.ts` red (stubbed `withRole`/repos/queue/S3) before its handler; the
acting-user-id rule gets an explicit test per route (another teacher's id in the URL is
`not_found`, never leaks whether the document exists).

### State after this phase
A teacher can create/list/complete/replace/delete document rows and trigger ingestion entirely
through the API, with no UI yet. `pnpm turbo run typecheck lint test --filter=@edmate/web...`
green; `route-coverage.test.ts` passes (every new handler wrapped in `withRole`); secret scan
clean.

## Phase 4 — apps/web: the upload-centre page
Depends on Phase 3 merged. ~6-8 files.

### Files to create/modify
- `apps/web/app/teacher/uploads/page.tsx` (new) — `requireRole(['teacher'])`, renders
  `<UploadsView>`.
- `apps/web/app/teacher/uploads/UploadsView.tsx` (new, client component) — file picker, a list of
  documents with status, delete and replace buttons; polls `GET /api/studio/documents` every ~4s
  while any row is `uploading`/`processing`; wrapped in 9.1's `AppShell`.
- `apps/web/app/teacher/uploads/UploadsView.test.tsx` (new) — RTL + axe; fetch stubbed; fake
  timers prove a poll tick updates a row's displayed status.
- `apps/web/app/teacher/view.tsx` (edit) — add an "Uploads" link into the `nav` the placeholder
  already renders via `AppShell`.
- `apps/web/app/teacher/view.test.tsx` (edit) — the new nav link.
- `apps/web/messages/en.json` (edit) — the upload-centre strings, same file 9.1/8.1 already share.

### Tests first
`UploadsView.test.tsx` red before the component; the polling-updates-the-row assertion written
against the red component first.

### State after this phase (task done)
A signed-in teacher uploads a file, watches it go `uploading` → `processing` → `ready`/`failed`,
and can delete or replace it, end to end. Evidence in the handoff: the int tests from Phases 1-3,
the component test here, and the one manual dev-stack run described above. Secret scan clean; no
real teacher files in any fixture (a tiny public-domain or synthetic PDF/audio clip only).

## Files out of bounds (every phase)
`packages/contracts/**` (no contracts change planned — flag to the human if this changes),
`packages/harness/**`, `content/**`, `packages/db/src/repositories/retrieval.ts` (no retrieval
behaviour change — status is not a retrieval gate), `apps/web/app/home/**`, `apps/web/app/sign-in/**`
(9.1's, not touched), `docs/adr/**`.

## Open question for the human (non-blocking)
Web-link/YouTube ingestion is deferred out of this task (see Scope above) — flagging in case the
pilot's first teacher needs it sooner than 8.2's natural follow-up slot; otherwise proceeding.

## Decisions to log on merge (per phase)
- Phase 1 and Phase 3: `risk: high` (`packages/db/src/repositories/**` and
  `apps/web/src/auth/**` respectively).
- The storage design above (presigned PUT from the browser, no shared package, no contracts port)
  is logged as a decision on Phase 3's merge, not sent to the human as a blocker.
- Web-link ingestion deferred: logged as a decision on Phase 4's merge.
