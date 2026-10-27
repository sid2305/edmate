# Handoff: 11.4i
Status: DONE

## Summary
Lifted `apps/web`'s 24 MB fail-fast cap for `audio/mp4`, `video/mp4` and `video/webm` now that
11.4d's ffmpeg chunker splits every media type before Whisper transcription. All five media
types (mp3, wav, m4a, mp4, webm) now get `splittable: true` and `maxBytes: MAX_MEDIA_UPLOAD_BYTES`
(500 MB), matching the treatment mp3/wav already had.

Changes, all in `apps/web`:
- `src/studio/files.ts`: removed `MAX_UNSPLIT_MEDIA_BYTES` and the `WHISPER_MAX_UPLOAD_BYTES`
  import; rewrote its doc comment to say the gap (11.4 Phase B, Q3) is closed by 11.4d + 11.4i.
  Simplified `media()` to hardcode `splittable: true, maxBytes: MAX_MEDIA_UPLOAD_BYTES`, dropping
  the second argument from all five call sites. Updated `UploadType.splittable`'s doc comment.
- `src/studio/files.test.ts`: deleted the "pins MAX_UNSPLIT_MEDIA_BYTES to 24 MB" test; changed
  "sets splittable per type" to expect `true` for every `transcribe` type, `false` otherwise;
  changed the cap test to expect `MAX_MEDIA_UPLOAD_BYTES` for all five media types; renamed the
  `describe` block. Added a new test pinning `WHISPER_MAX_UPLOAD_BYTES` (from `@edmate/gateway`)
  to 24 MB, next to the existing `MAX_MEDIA_UPLOAD_BYTES < 600_000_000` pin -- both constants the
  Budget re-check below depends on.
- `src/studio/uploadClient.ts`: removed `UNSPLIT_MEDIA_MAX_BYTES`, `UNSPLIT_EXTS` and
  `needsSmallerFile` (dead: no recording type is capped below the ordinary 500 MB cap any more).
- `src/studio/uploadClient.test.ts`: removed the `MAX_UNSPLIT_MEDIA_BYTES` import and the two
  tests pinning the old constant and `needsSmallerFile`'s behaviour.
- `src/studio/routes.test.ts`: removed the `MAX_UNSPLIT_MEDIA_BYTES` import; the synthetic-type
  test ("picks the message from the splittable flag") now uses a plain `1_000_000` literal cap
  instead of the real constant; rewrote "a 30 MB video/mp4 is 413" to expect 201 (with and without
  `liveClassId`), matching the accept line directly.
- `app/teacher/live-classes/RecordingUpload.tsx`: removed the `needsSmallerFile` import and the
  pre-upload size check; removed `'media_too_large'` from the `ErrorKey` union; updated the top
  comment to drop the client pre-check mention. A file still over the (now 500 MB) cap is refused
  by the server at `create`, already handled by the existing `!created.ok` branch.
- `app/teacher/live-classes/RecordingUpload.test.tsx`: replaced the "shows the 24 MB message"
  test with a success-path assertion -- a 30 MB `.mp4` now completes create -> put -> complete
  with no alert shown.
- `messages/en.json`: removed the now-unreachable `errors.media_too_large` string.

### Red/green evidence
Each test file's new/changed expectations were written against the unmodified source first (per
the plan's "Tests first" section) and confirmed red (TypeScript import errors for the removed
`MAX_UNSPLIT_MEDIA_BYTES`/`needsSmallerFile` exports, and literal assertion mismatches -- 413 vs
201, the 24 MB-message `/alert/` text vs none) before the matching source edit landed. After every
source edit, `corepack pnpm --filter @edmate/web test` was green:
`Test Files  170 passed | 4 skipped (174)` / `Tests  2752 passed | 31 skipped (2783)`.

### 15-minute searchable budget re-check (plan's "Budget re-check")
Carried forward, unchanged in substance from the plan:
- Raising `audio/mp4`/`video/mp4`/`video/webm`'s cap from 24 MB to 500 MB lets a teacher upload a
  much longer recording of these types. It does not change any timeout or the chunker itself --
  11.4d's `ffmpegChunker.ts` and `@edmate/gateway`'s `whisper.ts` are both unchanged.
- `ffmpegChunker.ts`'s one ffmpeg process is capped at `DEFAULT_TIMEOUT_MS` (10 minutes
  wall-clock, ADR-0016); past that it fails closed as a retryable `provider_error` rather than
  running long and silently blowing the budget. This ceiling does not grow with the new cap; a
  larger input makes hitting it more likely, not the ceiling itself larger.
- `audio/mpeg`/`audio/wav` have had this exact 500 MB cap and 24 MB-per-piece Whisper split since
  before this task. 11.4's own plan (Q5) already flagged the queue's one-job-at-a-time, 10-minute
  per-piece timeout tail as an accepted risk needing a media queue "only if the pilot shows it's
  needed." This task extends that identical, already-accepted exposure to mp4/webm/m4a -- it is
  not a new class of risk.
- Typical case: each Whisper piece covers about
  `(WHISPER_MAX_UPLOAD_BYTES - header slack) / (16 kHz * 1 ch * 2 bytes)` ~= 786 s (~13 minutes)
  of the chunker's fixed 16 kHz mono 16-bit output. A 2-hour recording is about 10 pieces,
  transcribed one after another (ingest concurrency 1); a 2-hour recording is expected to land
  comfortably inside 15 minutes in the happy path. A much longer recording (several hours) pushes
  the happy-path total closer to or past 15 minutes even with no single call timing out -- a real,
  size-driven effect of lifting the cap, distinct from the timeout tail above.
- Recommendation (no action needed to merge): carry 11.4's Q5 recommendation forward unchanged --
  add a media queue or job priority only if the pilot shows real recordings need it. Q5's
  real-audio timing (lead or human times one real 60-minute MP3/MP4 during the 9.0 try-it run)
  still answers whether the happy-path number above is realistic; this task does not attempt that
  measurement (rule 4: no real model calls in tests).
- `files.test.ts` pins `WHISPER_MAX_UPLOAD_BYTES` to 24 MB next to the existing
  `MAX_MEDIA_UPLOAD_BYTES < 600_000_000` pin, so if either constant moves, the test fails and
  flags this reasoning stale rather than silently wrong.

### Human steps (not done by the builder)
Per the plan and lead answers, the builder never runs docker. The ffmpeg licence check (building
the worker image once and reading `ffmpeg -version` for GPL vs LGPL, ADR-0016 Q3) is **pending
human (blockers.md)**. It does not block this PR: the cap lift is safe to merge and ship whichever
licence the built image turns out to have.

## Decisions
None.

## Gate
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` -- green (34/34 tasks
  successful). One unrelated flake on the first run: `@edmate/queue`'s
  `test/turnLimits.int.test.ts` > "slides: each take expires windowMs after it was made" failed
  under machine load (a real-clock timing assertion unrelated to this change); re-ran that file
  alone once and it passed (`14 passed (14)`). Full gate re-run after that was green end to end.
- `corepack pnpm --filter @edmate/web test` -- `Test Files 170 passed | 4 skipped (174)`,
  `Tests 2752 passed | 31 skipped (2783)`.
- `corepack pnpm exec prettier --check` on the eight changed files -- found formatting drift in 5
  files (whitespace only, from the edits), fixed with `--write`, re-checked clean: "All matched
  files use Prettier code style!". Re-ran `@edmate/web` tests after formatting: still
  170 passed | 4 skipped, 2752 passed | 31 skipped.
- `python3 .githooks/secret-scan.py --all` -- clean, no output.

## Budget
Tool calls used: 29
