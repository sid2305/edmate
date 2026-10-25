# 11.4f plan — the 413 message follows a splittable flag, not a byte size

Status: READY (lead-written, 25 Oct 2026)
Budget: 25 tool calls.

## Goal
Two 11.4b review LOWs in apps/web/src/studio:
1. `newFile` in apps/web/src/studio/routes.ts picks the "media too large" message by comparing `type.maxBytes === MAX_UNSPLIT_MEDIA_BYTES`. If a document cap ever equalled 24 MB, a document would get the media wording. Pick the message from an explicit flag instead.
2. `media()` in apps/web/src/studio/files.ts takes a positional boolean (`media('audio/mpeg', 'mp3', 'audio', true)`), which reads badly at the call sites.

## Changes (apps/web only)
- apps/web/src/studio/files.ts: add `splittable: boolean` to the exported `UploadType` (JSDoc: whether the worker's Whisper transcriber can split a large file of this type; only meaningful when `transcribe` is true). `doc()` and `caption()` set `splittable: false`. `media()` takes an options object as its last argument, `{ splittable: boolean }`, and stores it on the type; `maxBytes` is still derived from it exactly as today (500 MB splittable, 24 MB otherwise). Update the five call sites (mp3 and wav splittable; m4a, mp4 and webm not).
- apps/web/src/studio/routes.ts `newFile`: over the cap, return `MSG.mediaTooLarge` when `type.transcribe && !type.splittable`, otherwise `MSG.tooLarge`. Drop the `MAX_UNSPLIT_MEDIA_BYTES` import if it becomes unused. Keep the existing comment's intent.
- No behaviour change for any current type: the same files get the same status and words.

## Tests first
- apps/web/src/studio/files.test.ts: each UPLOAD_TYPES entry has the expected `splittable` (mp3, wav true; m4a, mp4, webm, every document and caption false).
- apps/web/src/studio/routes.test.ts: a test that fails if the message is chosen by size. Use the routes' existing test seam if one lets you pass a type list or mock `uploadTypeFor`; if not, `vi.mock('./files', ...)` with a partial mock that returns a document type whose `maxBytes` equals `MAX_UNSPLIT_MEDIA_BYTES` and `splittable: false, transcribe: false`, and assert an over-cap request gets `MSG.tooLarge`, not `MSG.mediaTooLarge`. Keep the existing 413 tests green.

## Gate
`corepack pnpm turbo run typecheck lint test --filter=@edmate/web` green; `python3 .githooks/secret-scan.py --all` clean. `UploadType` is used only inside apps/web, so no dependents filter is needed.

## Risk paths
None (apps/web/src/studio/** is not in risk-paths.txt).

## Reviewers
code-reviewer, typescript-reviewer.

## Open questions
None.
