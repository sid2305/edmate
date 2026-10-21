# 8.2 handoff: Upload centre (thin slice)

Status: PARTIAL (Phase 1 of 4 done)
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

## Left to do
- **Phase 2** (packages/queue + apps/worker): ingest queue, job schema, storage client, ingest
  processor and worker. Notes for that builder:
  - `updateStatus` refuses `uploading → ready`; the worker should go through `processing`
    (Phase 3's `complete` route sets it before enqueueing). `processing → processing` is allowed so
    a BullMQ retry can re-run.
  - A stale worker that finishes after `startReplace` gets `not_found` from `updateStatus('ready')`
    (row is back at `uploading`), but its `chunks.insertMany` would still land under the same
    document id. The processor should re-check the row's `storageKey` before writing chunks, or the
    job should carry the key it was enqueued for. Not solved in Phase 1.
  - Rows from `documents.create` now start `uploading`; the seed and scripts that create documents
    and ingest them straight away (if any) leave them `uploading` unless they call
    `updateStatus('processing')` then `('ready')`. Display only, never a retrieval gate.
- **Phase 3** (apps/web): studio document API routes, presign, `policy.ts` DELETE line.
- **Phase 4** (apps/web): upload-centre page with polling, nav link, strings, manual dev-stack run.

## Decisions

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
