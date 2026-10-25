# 11.4f handoff

Status: DONE

## What changed
- `apps/web/src/studio/files.ts`: added `splittable: boolean` to the `UploadType` interface
  (JSDoc explains it is only meaningful when `transcribe` is true). `doc()` and `caption()` now
  set `splittable: false`. `media()`'s last parameter changed from a positional boolean to an
  options object `{ splittable: boolean }`; `maxBytes` is still derived from it exactly as
  before (500 MB splittable, 24 MB otherwise). Updated the five `media(...)` call sites in
  `UPLOAD_TYPES` (mp3, wav → `{ splittable: true }`; m4a, mp4, webm → `{ splittable: false }`).
- `apps/web/src/studio/routes.ts`: `newFile` now picks `MSG.mediaTooLarge` when
  `type.transcribe && !type.splittable`, otherwise `MSG.tooLarge`, instead of comparing
  `type.maxBytes === MAX_UNSPLIT_MEDIA_BYTES`. Dropped the now-unused `MAX_UNSPLIT_MEDIA_BYTES`
  import. No behaviour change for any current type.
- `apps/web/src/studio/files.test.ts`: added a test asserting `splittable` is `true` only for
  `audio/mpeg` and `audio/wav`, `false` for every other `UPLOAD_TYPES` entry.
- `apps/web/src/studio/routes.test.ts`: added a test that spies on `uploadTypeFor` to return a
  document type whose `maxBytes` equals `MAX_UNSPLIT_MEDIA_BYTES` with `transcribe: false,
  splittable: false`, and asserts an over-cap request gets the exact `MSG.tooLarge` text, not
  `MSG.mediaTooLarge` — this fails before the `routes.ts` change (message picked by byte
  comparison) and passes after.

## Decisions
None.

## Left to do
None.

## Evidence
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web`: all 10 tasks successful
  (typecheck, lint, test for `@edmate/web` and its dependencies); `apps/web` test suite 94/94
  passing in `files.test.ts` + `routes.test.ts`, full web suite green.
- `python3 .githooks/secret-scan.py --all`: clean (no output, exit 0).

## Budget
Tool calls used: 19
