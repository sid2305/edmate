# 11.4b handoff: studio API, class recordings and the fail-fast cap (11.4 Phase B, apps/web)

Branch: m11/11.4b-recording-api (local `work-114b`)
Worktree: .claude/worktrees/agent-a9e6ddca2c35b1a06
Plan: docs/tasks/11.4/plan.md, "Phase B"
Status: DONE

## Summary
- `apps/web/src/studio/files.ts`: `media()` now takes a `splittable` flag. `audio/mpeg` and
  `audio/wav` keep `MAX_MEDIA_UPLOAD_BYTES` (500 MB). `audio/mp4`, `video/mp4` and `video/webm` now
  cap at the new `MAX_UNSPLIT_MEDIA_BYTES = 24 * 1024 * 1024`, imported as `WHISPER_MAX_UPLOAD_BYTES`
  from `@edmate/gateway` (apps/web already depends on that package), so the two caps can never
  drift apart; a test pins the raw number too. Added `isRecordingType(type)`, true exactly for the
  transcript-kind rows (captions, audio, video).
- `apps/web/src/studio/routes.ts`: `CreateSchema` gains `liveClassId: Id.optional()`. With
  `liveClassId` set, a type that isn't a recording type is refused 400 (`MSG.type`) before anything
  is signed or written. The id is passed through to `b.documents.create`; a repo `not_found`
  (foreign class, not yet started, or missing -- 11.4a's own check) is already mapped to 404 by the
  existing handler wrapper, confirmed by a new test (no upload URL signed, nothing written).
  `newFile` now returns the new fixed `MSG.mediaTooLarge` message ("Videos and M4A audio over 24 MB
  can't be transcribed yet. Upload the audio as MP3, or the class transcript (.vtt or .srt).") when
  the exceeded cap is the unsplit-media one, and the ordinary `MSG.tooLarge` otherwise. `complete`
  is unchanged; a new test confirms a class recording still enqueues at once with the existing job
  shape (no `delay`, no extra options).
- `apps/web/src/studio/uploadClient.ts`: `createDocument`'s input gains optional `liveClassId`,
  sent only when given. Exported `RECORDING_UPLOAD_EXTS` (vtt, srt, mp3, wav, m4a, mp4, webm) and
  `RECORDING_ACCEPT` (the same `accept` shape as `ACCEPT`, restricted to those types). Exported
  `UNSPLIT_MEDIA_MAX_BYTES` (client mirror of the server cap, pinned equal by a test) and
  `needsSmallerFile(file, contentType)`, true only for an m4a/mp4/webm file over that cap -- for
  Phase C's client-side pre-check.
- `apps/web/messages/en.json`: **not touched**. The upload centre's client (`UploadsView.tsx`)
  keys its error banner and failure-reason words off the server's error **code**
  (`input_too_large`), never the message text, and `tooLarge()` still returns that same code for
  the new case -- only the message string differs. So the plan's condition ("only if the upload
  centre's client maps the 413 to a key") does not hold yet; the existing `uploads.errors.
  input_too_large` key already covers it on that page. Phase C's `RecordingUpload` form reads the
  server's `message` field directly (the same pattern `addLink`'s `LINK_REFUSAL_MESSAGE` already
  uses), so the fixed words above reach the teacher there without a new message key.

## Files
- apps/web/src/studio/files.ts, files.test.ts
- apps/web/src/studio/routes.ts, routes.test.ts
- apps/web/src/studio/uploadClient.ts, uploadClient.test.ts

## Tests
Written red first against the existing suites (new `describe` blocks and cases), then green.
- `corepack pnpm --filter @edmate/web exec vitest run src/studio/files.test.ts src/studio/routes.test.ts src/studio/uploadClient.test.ts`
  → `Test Files 3 passed (3)`, `Tests 103 passed (103)`.
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` → `Tasks: 34 successful, 34 total`.
- `python3 .githooks/secret-scan.py --all` → clean (no output).
- What the new tests show:
  - `files.test.ts`: `MAX_UNSPLIT_MEDIA_BYTES` pinned to 24 MB; mp3/wav keep the 500 MB cap, m4a/
    mp4/webm get the 24 MB cap; `isRecordingType` matches `chunkKind === 'transcript'` exactly for
    every table entry, including PDF (false) and vtt/mp3/mp4 (true).
  - `routes.test.ts`: a caption file with `liveClassId` gives 201 and the repo call carries it; a
    plain document type (PDF) with `liveClassId` is 400 and nothing is written; a repo `not_found`
    for `liveClassId` is 404 with no `createUploadUrl` call and no row; a 30 MB `video/mp4` is 413
    with the new words, with or without `liveClassId`; a 30 MB `audio/mpeg` is 201 (the splittable
    cap); `complete` on a class recording enqueues once with the existing job shape. The existing
    "refuses a file over its cap with 413, per type" test (video/mp4 at 20 MB+1 → 201, at 500 MB+1
    → 413) still holds unchanged under the new 24 MB cap, since both bounds sit either side of it.
  - `uploadClient.test.ts`: `RECORDING_UPLOAD_EXTS` is a subset of `CLIENT_UPLOAD_TYPES`, and each
    one's server type has `chunkKind: 'transcript'`; `RECORDING_ACCEPT` holds the recording
    extensions and types only (no `.pdf`); `UNSPLIT_MEDIA_MAX_BYTES` equals the server's
    `MAX_UNSPLIT_MEDIA_BYTES`; `needsSmallerFile` flags only an oversized m4a/mp4/webm, never mp3 or
    a type outside the table; `createDocument` sends `liveClassId` only when given.

## Deviations
- None from the plan's file list. `apps/web/messages/en.json` was deliberately left untouched (see
  Summary) because its stated condition for a new key does not hold; this is recorded here rather
  than silently skipped.

## Decisions
### 22 Oct 2026 · 11.4b builder ran over the Phase B budget · decided by lead · risk: low
- Decided: accept 78 tool calls against a 50-call brief budget.
- Why: three reviewers found no CRITICAL, HIGH or blocking issue; re-running would cost more than it saves.
- risk: low

### 22 Oct 2026 · 11.4b unsplittable media (m4a/mp4/webm) capped at 24 MB at upload · decided by builder · risk: medium
- Decided: `audio/mp4`, `video/mp4` and `video/webm` now cap at `MAX_UNSPLIT_MEDIA_BYTES`, equal to
  `@edmate/gateway`'s `WHISPER_MAX_UPLOAD_BYTES` (24 MB), refused at `create` with a fixed message
  pointing to MP3 or a transcript file. `audio/mpeg` and `audio/wav` keep the 500 MB media cap.
  Only transcript-kind uploads (captions, audio, video) may carry `liveClassId`; a plain document
  with `liveClassId` is refused 400 before anything is written.
- Why: plan Phase B (Q3) and lead answers; the worker's Whisper transcriber has no chunker for
  anything but WAV/MP3, so an oversized M4A/MP4/WebM uploads today and fails minutes later as
  `input_too_large`. Refusing it up front saves the wasted upload and points to a working path. A
  real ffmpeg-chunker fix is board task 11.4d (M13; needs an ADR).
- risk: medium

### 22 Oct 2026 · 11.4b no new en.json key; the recording-too-large message reaches the teacher through the response body, not a translation key · decided by builder · risk: low
- Decided: `apps/web/messages/en.json` is not edited in this phase. The upload centre
  (`UploadsView.tsx`) keys error words off the server's fixed error code, not its message text, and
  the new case still returns the existing `input_too_large` code -- only the message differs, and
  that page doesn't show it. Phase C's `RecordingUpload` form is expected to show the server's
  `message` field directly (the `addLink` precedent), so the fixed English text added to
  `routes.ts`'s `MSG.mediaTooLarge` reaches the teacher there without touching the shared,
  append-only translation file in this phase.
- Why: the plan's instruction was conditional ("only if ... the client maps the 413 to a key");
  the condition doesn't hold today, and leaving the shared file untouched avoids a merge collision
  with any other builder editing it in parallel.
- risk: low

## Left to do
- None for Phase B. Phase C (11.4c) can start: `RecordingUpload.tsx` should read the create
  response's `message` field for the 24 MB case (mirroring `addLink`'s `LINK_REFUSAL_MESSAGE`
  pattern) rather than expect a translation key, and should use `needsSmallerFile` /
  `RECORDING_ACCEPT` / `RECORDING_UPLOAD_EXTS` / `UNSPLIT_MEDIA_MAX_BYTES` from `uploadClient.ts`
  for its client-side pre-check and file picker.

Tool calls used: 78 (harness count; the builder reported 44)
