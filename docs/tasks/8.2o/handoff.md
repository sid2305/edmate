# 8.2o handoff: 8.2n review follow-ups (replace guards)

**Status:** DONE
Branch: `m13/8.2o-replace-guards` (built as `work-82o`)
Worktree: `.claude/worktrees/agent-a0e33210ffcd4f79a` (under the repo root)

A first builder stopped at the usage limit after 22 tool calls; its uncommitted WIP (tests
written, implementation and db schema work mostly in place) was committed on this branch as
"8.2o: builder WIP (stopped at the usage limit; not gated)". This session read that diff,
verified it against the brief, and ran the gate -- no code changes were needed beyond what was
already there.

## What changed

1. `packages/db/src/repositories/chunks.ts`: `startReplace` refuses (`invalid`, nothing written)
   when the existing row has a `liveClassId` and the new file's `kind` would be `material` -- a
   class recording/transcript stays a recording; another transcript-kind file (caption, audio,
   video) is still allowed and keeps the link. `lockDocument` now returns `{ storageKey, kind,
   liveClassId }` (was `storageKey` alone) so `startReplace` can read what it needs under the same
   row lock.
2. Same file: `startReplace` also refuses a `teacher_note` row (`invalid`) -- a note has no file.
   `apps/web/src/studio/routes.ts`'s `replace` additionally checks `existing.kind ===
   'teacher_note'` directly (its `DocumentRow` already carries `kind`) and returns the 409 before
   signing anything; the repository guard is the second line of defense for any other caller.
3. `apps/web/src/studio/routes.ts`: `replace` catches `RepositoryError` with `kind: 'invalid'` from
   `startReplace` and turns it into a 409 with the new `REPLACE_REFUSAL_MESSAGE.recording`
   (plain teacher-facing message, same style as create's task-11.4 guard); the signed upload URL
   is never returned, so nothing is uploaded under the new key.
4. `apps/web/src/studio/files.test.ts`: a test that every `UPLOAD_TYPES` row's `transcribe` flag
   agrees with `@edmate/queue`'s `IngestJobSchema` (`mimeType` required exactly when `transcribe`
   is true) -- pins the two to each other so a future row can't drift silently into
   `enqueue_failed`.
5. `packages/db/src/repositories/chunks.ts`: the upload-file retrieval kind (`'material' |
   'transcript'`) is named once as `FileChunkKindSchema` / `FileChunkKind`, derived from the
   schema and used in `startReplace`'s signature. Exported from `packages/db/src/index.ts`.
   `apps/web/src/studio/files.ts`'s `FileChunkKind` is now a re-export of the db package's type
   instead of its own `Exclude<ChunkKind, 'teacher_note'>`.
6. `apps/web/src/studio/routes.ts`: the link-refusal message map (`LINK_REFUSAL_MESSAGE`) and the
   new replace-refusal messages (`REPLACE_REFUSAL_MESSAGE.note`, `.recording`) are both exported
   and reused from `routes.test.ts` and `uploadClient.test.ts` instead of literal string copies.
7. Tests: `apps/web/src/studio/routes.test.ts` (replace refuses a class-linked row turning
   `material`, 409, row unchanged, nothing deleted, another recording type still allowed; replace
   refuses a note, 409, nothing signed/replaced/deleted) and
   `packages/db/test/documents.int.test.ts` (same two cases against real Postgres, plus the
   revision counter unchanged and the live-class link kept across the allowed recording-to-
   recording replace).

## Evidence

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db`: 8/8 tasks successful (typecheck,
  lint, test for db and its deps). 16 int test files ran (not skipped): `repositories.int.test.ts`,
  `publish.int.test.ts`, `identity.int.test.ts`, `teacher-question-answer.int.test.ts`,
  `documents.int.test.ts` (44 tests), `takedowns.int.test.ts`, `migrate.int.test.ts`,
  `retrieval.int.test.ts`, `insights.int.test.ts`, `packages.int.test.ts`,
  `profile-store.int.test.ts`, `outline.int.test.ts`, `retrieval-leak.int.test.ts`,
  `usage-ledger.int.test.ts`, plus two more in the full run (unit test files unaffected). Coverage
  on `chunks.ts`: 100/100/100/100.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/queue`: 5/5 tasks successful, 7 test
  files / 104 tests passed, 100% coverage.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web`: 10/10 tasks successful, all
  test files passed (`routes.ts` 98.52% stmts / 98.29% branch).
- `python3 .githooks/secret-scan.py --all`: clean, no output.

## Decisions

### 23 Oct 2026 · 8.2o: replace refuses class-linked material and notes in apps/web/src/studio/routes.ts and packages/db/src/repositories/chunks.ts · decided by builder · risk: high
- Decided: `documents.startReplace` refuses (`invalid`, nothing written) a class-linked row
  (`liveClassId` set) given `kind: 'material'`, and refuses any replace of a `teacher_note` row,
  under the same `FOR UPDATE` lock already taken for the write; the route turns the first into a
  409 with a fixed teacher-facing message and checks the note case itself (it already has
  `existing.kind`) so it can refuse before signing an upload URL.
- Why: a class recording/transcript becoming a generic material document would silently break
  the "this is the class's own recording" citation path (task 11.4's create-time guard already
  refuses this at creation; replace needed the same rule). A note row has no `storageKey` column
  to replace, so allowing it through would write a storage key the row can never use.
- risk: high (packages/db/src/repositories/** is a risk path; the guard sits inside the same
  transaction as every other document write).

### 23 Oct 2026 · 8.2o: FileChunkKind named once in packages/db, apps/web re-exports it · decided by builder · risk: low
- Decided: the upload-file retrieval kind (`'material' | 'transcript'`) is a zod enum in
  `packages/db/src/repositories/chunks.ts`, exported as `FileChunkKind`; `apps/web/src/studio/
  files.ts`'s own type of the same name is now `export type { FileChunkKind }` from `@edmate/db`
  instead of its own `Exclude<ChunkKind, 'teacher_note'>`.
- Why: two independently-written unions for the same two-value set can drift (that drift is what
  item 3's test below guards against for `transcribe`); naming it once in the package that owns
  the document schema removes the chance.
- risk: low, reversible by reverting the re-export.

## Left to do

None.

Tool calls used: 22 (first builder) + 16 (this session)
