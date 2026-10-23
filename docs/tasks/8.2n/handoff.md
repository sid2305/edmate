# 8.2n handoff: 8.2l review follow-ups in apps/web/src/studio

**Status:** DONE
Branch: `m13/8.2n-studio-followups` (built as `work-82n`)
Worktree: `.claude/worktrees/agent-a576a551a78ee5be3` (under the repo root)

## What changed
Tests first, then the smallest code that makes them pass. All five items from the board title:

1. `apps/web/src/studio/routes.test.ts`: the YouTube refusal test now asserts the exact
   `LINK_REFUSAL_MESSAGE.youtube_unsupported` string with `toBe`, so a revert to the old words
   fails it (8.2l MEDIUM).
2. `apps/web/src/studio/uploadClient.test.ts`: the refused-link fixture and its expectation use
   the new words (8.2l LOW).
3. `apps/web/src/studio/routes.test.ts`: a `complete` test for `application/x-subrip` -- the key
   ends `.srt`, 202, row `processing`, job `{ fileKind: 'srt' }` with no `mimeType` (8.2l LOW).
4. `apps/web/app/teacher/uploads/UploadsView.test.tsx`: the `as HTMLInputElement` cast on the
   file picker is an `instanceof` guard that throws a plain error if the element is not an input
   (8.2l LOW).
5. Replace updates `documents.kind` (8.2l LOW, pre-existing):
   - `packages/db/src/repositories/chunks.ts` (risky path, minimal): `startReplace` takes an
     optional `kind: 'material' | 'transcript'` and sets the column when given; without it the
     kind is left as it was (every existing caller and test unchanged). `teacher_note` is refused
     as `invalid` by the schema -- a note row has no file to replace. No migration.
   - `apps/web/src/studio/routes.ts` `replace` passes `kind: type.chunkKind`, so a PDF replaced by
     a `.vtt` becomes `transcript` and the reverse becomes `material`.
   - `apps/web/src/studio/files.ts`: `UploadType.chunkKind` is narrowed to a new exported
     `FileChunkKind = Exclude<ChunkKind, 'teacher_note'>` (an uploaded file is never a note), which
     is what lets the route pass it to the repository without a cast.
   - `packages/db/test/documents.int.test.ts`: an int test for both directions, "left alone when
     not given", and the `teacher_note` refusal (nothing written).
   - `apps/web/src/studio/routes.test.ts`: the fake `startReplace` records its input and applies
     `kind`; a route test covers PDF -> .vtt -> PDF.
6. The needs-transcription rule lives on `UploadType` as `transcribe: boolean` (`true` for the
   `media()` rows, `false` for `doc()` and `caption()`); `complete` reads `type.transcribe` instead
   of comparing `fileKind` strings. `apps/web/src/studio/files.test.ts` pins `transcribe` to
   audio/video exactly.

Not touched: apps/web vitest/playwright configs, `apps/web/src/turn/**`, `apps/worker`,
`packages/db` `teacher-profiles.ts`, `takedowns.ts`, `live-classes.ts`, `packages/contracts`.

## Evidence
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web --force` -> `Tasks: 10 successful, 10 total`;
  `Test Files 143 passed | 4 skipped (147)`; `Tests 2166 passed | 25 skipped (2191)`. The 4 skipped
  files are the staff `route.int.test.ts` files (pre-existing, need a dev stack). First run: one
  unrelated file (`app/learn/[agentId]/page.test.tsx`, untouched) timed out at 5000 ms on the loaded
  machine; the full gate re-run was green with no change -- a lone timing flake.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/db --force` -> `Tasks: 8 successful, 8 total`;
  `Test Files 74 passed (74)` (no file skipped); `Tests 1447 passed | 4 skipped (1451)`. The 4
  skipped tests are pre-existing `it.skip`/`skipIf` inside `recall`, `video-ingest` and
  `retrieval-hnsw` int tests, not from this change. `test/documents.int.test.ts`: 42 tests, all
  passed, on the real Postgres at 127.0.0.1:55432.
- `python3 .githooks/secret-scan.py --all` -> clean (rc 0).

## Deviations
None from the brief. `FileChunkKind` (files.ts) was not named in the brief; it is the type narrowing
needed so `replace` can pass `type.chunkKind` to the repository without a cast.

## Decisions

### 22 Oct 2026 · 8.2n: replace updates document kind · decided by builder · risk: high
- Decided: `documents.startReplace` (packages/db/src/repositories/chunks.ts) accepts an optional
  `kind: 'material' | 'transcript'` and writes it in the same transaction as the new storage key;
  the studio `replace` route always passes the new file's `chunkKind`. Without `kind` the column is
  untouched, so no other caller changes behaviour. `teacher_note` is refused (`invalid`).
- Why: a PDF replaced by a `.vtt` stayed `material`, so its chunks (which copy `d.kind` on insert)
  would cite as a document instead of a recording with a timestamp; the reverse was wrong too
  (8.2l LOW, architect and typescript-reviewer). The optional field is the smallest change that
  fixes it with no migration.
- risk: high (`packages/db/src/repositories/**` is a risky path). Required reviewers: database-reviewer,
  typescript-reviewer.

### 22 Oct 2026 · 8.2n: the transcription rule is a flag on UploadType · decided by builder · risk: low
- Decided: `UploadType.transcribe: boolean`, true only for the audio/video rows; `complete` uses it
  to decide whether the ingest job carries `mimeType`. `UploadType.chunkKind` is narrowed to
  `FileChunkKind` (no `teacher_note`).
- Why: the board title asks for it; one table now states each type's whole behaviour, and a future
  caption-like type can't be mis-classified by a string comparison in the route. The narrowing
  matches reality (no upload is a note) and lets the route pass the kind to the repository safely.
- risk: low

Tool calls used: 19
