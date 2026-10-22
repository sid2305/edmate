# 11.4a handoff: link a document to its live class (11.4 Phase A, packages/db)

Status: DONE
Branch: m11/11.4a-recording-link (local `work-114a`)
Worktree: .claude/worktrees/agent-ade7a5191c37bc067
Plan: docs/tasks/11.4/plan.md, "Phase A"
Tool calls used: 56

## Summary
- Migration `0024_document_live_class`: `documents.live_class_id text` (nullable, no backfill), FK to `live_classes(id) ON DELETE SET NULL` added `NOT VALID` and validated by a new post-migrate step (`src/migrate.ts` `POST_MIGRATE_STEPS`, the 0009/0023 pattern), and the partial index `documents_live_class_id_idx … WHERE live_class_id IS NOT NULL`. Additive only: nothing dropped, deleted or rewritten.
- `documents.create` takes an optional `liveClassId`. The existing `INSERT … SELECT FROM modules` also requires `EXISTS (live_classes where id = $lc and teacher_id = scope and starts_at <= now())`. Another teacher's class, a future class and a missing class are all `not_found`, with no row and no revision bump. `get`, `listForTeacher`, `startReplace` and `DocumentRow` are unchanged; a replace keeps the link.
- `liveClasses.listRecordingsForTeacher(scope)`: one query (the scope's documents joined to the scope's own classes), `{ liveClassId, documentId, sourceTitle, status, failureReason? }`, newest first, capped at `RECORDING_LIST_MAX = 500`. `TeacherLiveClassRow` is unchanged.
- Exports (append-only): `LiveClassRecording`, `RECORDING_LIST_MAX`. README section "Live-class recordings (task 11.4)".
- No `packages/contracts`, `apps/web` or `apps/worker` change.

## Files
- packages/db/migrations/0024_document_live_class.sql (new, hand-edited: NOT VALID plus comments), migrations/meta/0024_snapshot.json (new), migrations/meta/_journal.json
- packages/db/src/schema/content.ts (`documents.liveClassId`, FK thunk to `liveClasses`, partial index; the import of `operations.ts` caused no lint or runtime cycle problem, so the FK is in the schema too)
- packages/db/src/migrate.ts (one appended `validateConstraint` step)
- packages/db/src/repositories/chunks.ts, live-classes.ts, index.ts, README.md
- packages/db/test/documents.int.test.ts, document-live-class-migration.int.test.ts (new), repositories.int.test.ts (fixture plus `CASES` entry), migrate.test.ts

## Tests
Written red first (9 failing in documents.int, migration test failing on the missing journal entry), then green.
- `TEST_DATABASE_URL=…127.0.0.1:55491… corepack pnpm vitest run --coverage` (packages/db, own throwaway pgvector container) → `Test Files 74 passed (74)`, `Tests 1438 passed | 4 skipped (1442)`, all files 99.84 % statements / 98.01 % branches.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db...` → `Tasks: 26 successful, 26 total`.
- `python3 .githooks/secret-scan.py --all` → clean (no output).
- What the tests show: own started class stores the link; RB's class, a future class and a missing id are `not_found` with no row and no revision bump; malformed ids are `invalid`; no `liveClassId` leaves null; `startReplace` keeps the link; a linked transcript's chunks (written by `insertManyIfStorageKey`, locator `00:12:05`) come back from the scoped search for its module and not for another module or teacher; `listRecordingsForTeacher` returns status and failure reason after `updateStatus`, newest first, never the other teacher's rows; bad scope throws `scope` before SQL (also `scope.test.ts` sweep and the isolation grid `CASES`); migration keeps pre-existing rows with null, builds the partial index, validates the FK (`confdeltype = 'n'`) and unlinks recordings when a class is deleted.

## Deviations
- The searchable-chunks test is in `documents.int.test.ts` (it already has the retrieval seed and search helper) rather than `retrieval.int.test.ts` / `video-ingest.int.test.ts`.
- `src/migrate.ts` and `test/migrate.test.ts` are touched (not listed in the plan) because the plan's "NOT VALID then VALIDATE" is done by the repo's post-migrate step, not inside the migration file (drizzle runs migrations in one transaction).

## Decisions

### 22 Oct 2026 · 11.4a documents.create links only an own started live class; new listRecordingsForTeacher · decided by builder · risk: high
- Decided: `documents.create` accepts `liveClassId` only for one of the scope's own classes with `starts_at <= now()`, checked in the same `INSERT … SELECT` as the module. Another teacher's class, a future class and a missing class all give `not_found` and write nothing, so class ids can't be probed. `liveClasses.listRecordingsForTeacher` reads only the scope's documents joined to the scope's own classes (`teacher_id` on both sides), so no cross-teacher read is possible. Risky path `packages/db/src/repositories/**`; required reviewer: security-reviewer. Recommended: database-reviewer, code-reviewer, typescript-reviewer.
- Why: plan Phase A and lead answers Q1/Q6; the same `not_found` shape as a foreign module keeps the existing no-probe rule.
- risk: high

### 22 Oct 2026 · 11.4a migration 0024 adds documents.live_class_id (additive only) · decided by builder · risk: medium
- Decided: nullable `live_class_id`, no backfill; FK `ON DELETE SET NULL` added `NOT VALID` and validated by an appended post-migrate step (pattern of 0009/0023, since drizzle runs migration files in one transaction); a plain (not concurrent) partial index `WHERE live_class_id IS NOT NULL`, because every existing row is null and the table is small. Reviewer: database-reviewer.
- Why: additive only, so 11.1d's later delete of a class never blocks or strands its recordings; the validation scan stays out of the migration's lock.
- risk: medium

### 22 Oct 2026 · 11.4a recordings list cap and shape · decided by builder · risk: low
- Decided: `RECORDING_LIST_MAX = 500` (the `DOCUMENT_LIST_MAX` precedent), ordered by `created_at desc, id desc`; `failureReason` is omitted unless set.
- Why: matches the documents list conventions the upload centre already uses.
- risk: low

## Left to do
- None for Phase A. Phase B (11.4b) waits on 8.2l and 12.3c merging.
