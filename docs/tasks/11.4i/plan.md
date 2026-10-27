# 11.4i plan: lift apps/web's 24 MB media cap now that the worker's ffmpeg chunker splits it (M13)

Board: 11.4i (M13), deps 11.4d (done). Planned 27 Oct 2026.

Status: **READY.**

## Acceptance (verbatim)
Board 11.4i: "After 11.4d: lift apps/web's 24 MB cap (MAX_UNSPLIT_MEDIA_BYTES) for audio/mp4,
video/mp4 and video/webm now that the worker chunks them with ffmpeg; re-check the 15-minute
searchable budget for a long video; a human builds the worker image once and records whether its
ffmpeg is a GPL or LGPL build (swap to the ADR's LGPL-only fallback if needed)." *Accept:* "a
teacher can upload an MP4, WebM or M4A over 24 MB and it becomes searchable; the ffmpeg build's
licence is recorded in the handoff; web tests green."

### How it will be shown
1. **The cap is lifted.** `apps/web/src/studio/files.ts`'s `UploadType` table marks `audio/mp4`,
   `video/mp4` and `video/webm` `splittable: true` with `maxBytes: MAX_MEDIA_UPLOAD_BYTES` (500 MB)
   — the same treatment `audio/mpeg`/`audio/wav` already get, now that 11.4d's ffmpeg chunker
   splits these three types too. `MAX_UNSPLIT_MEDIA_BYTES` (the 24 MB fail-fast cap) is removed:
   nothing needs it once no type is capped below the ordinary media cap.
2. **A unit test proves it:** `routes.test.ts`'s create-document test for a file over 24 MB but
   under 500 MB now expects 201, not 413 (the literal "a teacher can upload an MP4 ... over 24 MB"
   behaviour, at the API layer the real upload form calls). `files.test.ts` and
   `uploadClient.test.ts` pin the new per-type caps and drop the now-nonexistent constants.
   "Ingests" itself (splits + transcribes) is already proven by 11.4d's own fixture tests
   (`ffmpegChunker.test.ts`'s opt-in real-ffmpeg block); this task does not re-prove that.
3. **The 15-minute budget is re-checked, in writing** (see "Budget re-check" below), with one
   scripted-fixture test that pins the constants the reasoning depends on, so a later change to
   either number is caught instead of silently invalidating the reasoning. No real Whisper or
   ffmpeg timing is measured (rule 4; Q5 of 11.4's own plan already says tests can't call Whisper).
4. **The licence check is a human step** (see "Human steps" below) — it does not block this PR.
5. `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` is green; secret scan
   clean.

## Files to create/modify
All in `apps/web` (one package, one phase):
1. `apps/web/src/studio/files.ts` — remove the `WHISPER_MAX_UPLOAD_BYTES` import and the
   `MAX_UNSPLIT_MEDIA_BYTES` export (and its doc comment, lines ~12-25, which described the gap
   11.4d and this task close — rewrite it to say the gap is closed, citing 11.4d and 11.4i).
   Simplify the private `media()` factory: it no longer takes a `{ splittable }` option (every
   caller now passes the same value) — hardcode `splittable: true, maxBytes:
   MAX_MEDIA_UPLOAD_BYTES` inside it, and drop the second argument from all five call sites
   (`audio/mpeg`, `audio/wav`, `audio/mp4`, `video/mp4`, `video/webm`). `doc()` and `caption()` are
   unchanged (`splittable: false` stays hardcoded there, as today). Update `UploadType.splittable`'s
   doc comment: it is now `true` for every `transcribe` type and `false` otherwise; kept as its own
   field (not merged into `transcribe`) because `routes.ts`'s message selection already reads it,
   and a future format that genuinely can't be split would set it back to `false`.
2. `apps/web/src/studio/files.test.ts` — in the `describe('the fail-fast cap for media the worker
   cannot split ...')` block: delete the "pins MAX_UNSPLIT_MEDIA_BYTES to 24 MB" test and the now
   dead import; change "sets splittable per type" to expect `true` for every type with
   `transcribe === true` (mp3, wav, m4a, mp4, webm) and `false` otherwise; change "keeps the
   mp3/wav cap at 500 MB; m4a/mp4/webm get the 24 MB cap" to assert `MAX_MEDIA_UPLOAD_BYTES` for
   all five media types; rename the `describe` block (e.g. "every audio/video type is now
   splittable at the ordinary media cap (11.4d, 11.4i)"). Add one new small test (see "Budget
   re-check") that imports `WHISPER_MAX_UPLOAD_BYTES` from `@edmate/gateway` and pins it to 24 MB,
   next to the existing `MAX_MEDIA_UPLOAD_BYTES < 600_000_000` pin at line 80 — both constants the
   written reasoning below depends on.
3. `apps/web/src/studio/uploadClient.ts` — remove `UNSPLIT_MEDIA_MAX_BYTES`, the `UNSPLIT_EXTS`
   set and `needsSmallerFile` (dead now: no recording type is capped below the ordinary 500 MB
   cap, the same as mp3/wav already weren't). Remove their doc comments (lines ~79-97).
4. `apps/web/src/studio/uploadClient.test.ts` — remove the `MAX_UNSPLIT_MEDIA_BYTES` import and
   the two tests at lines ~95-114 ("pins UNSPLIT_MEDIA_MAX_BYTES ...", "needsSmallerFile flags
   only m4a/mp4/webm over the cap").
5. `apps/web/src/studio/routes.test.ts` — remove the `MAX_UNSPLIT_MEDIA_BYTES` import. In the
   synthetic-type test at ~501-525 ("picks the message from the splittable flag, not from the byte
   cap"), replace the `MAX_UNSPLIT_MEDIA_BYTES` references with a plain literal (e.g.
   `1_000_000`) — that test only needs some fake cap value, never the real constant. Rewrite the
   test at ~479-499 ("a 30 MB video/mp4 is 413 with the new words, with or without liveClassId"):
   a 30 MB `video/mp4` now gets 201 (with and without `liveClassId`), matching the accept line
   directly; the existing test at ~343-369 ("refuses a file over its cap with 413, per type")
   already exercises the 500 MB boundary for `video/mp4` (`MAX_MEDIA_UPLOAD_BYTES + 1` → 413) and
   needs no change.
6. `apps/web/app/teacher/live-classes/RecordingUpload.tsx` — remove the `needsSmallerFile` import
   and the pre-upload size check (lines ~112-115); remove `'media_too_large'` from the `ErrorKey`
   union (line 45); update the top comment (line 5) to drop "client pre-check (`needsSmallerFile`)".
   A file that is still over the (now 500 MB) cap is refused by the server at `create`, already
   handled by the existing `!created.ok` branch, which shows the server's own fixed message.
7. `apps/web/app/teacher/live-classes/RecordingUpload.test.tsx` — replace the test at ~145-151 ("a
   30 MB .mp4 shows the 24 MB message and makes no create call") with a success-path assertion: a
   30 MB `.mp4` now completes create → put → complete (mirror an existing successful-upload test
   in this file for the pattern), and no alert is shown.
8. `apps/web/messages/en.json` — remove the now-unreachable `errors.media_too_large` string (line
   ~741), since nothing sets that `ErrorKey` any more after file 6's edit.

No change to `apps/worker/**`, `packages/gateway/**`, `packages/contracts/**`, `docs/adr/**`, or
`routes.ts` itself (its `type.transcribe && !type.splittable ? MSG.mediaTooLarge : MSG.tooLarge`
ternary is untouched and correctly reused — the false branch is simply unreachable for every real
type today, same as it already was for mp3/wav).

## Files out of bounds
- `apps/web/e2e/**` and any Playwright config — another builder (0.20h) is working there.
- `apps/worker/**`, `packages/gateway/**` — 11.4d's chunker and timeouts are correct as shipped;
  this task only changes what `apps/web` is willing to accept at upload.
- `packages/contracts/**`, `docs/adr/**` — no contracts or tech-stack change here.
- `packages/db/**`, `apps/web/src/auth/**`, `apps/web/app/api/staff/**`, `apps/web/app/staff/**`,
  `apps/web/app/api/webhooks/**`, `apps/web/app/api/auth/**` — untouched by this change.
- Any real recording, transcript or caption file (rule 5); every test byte is synthetic.

## Tests first
Each file's test edit lands and is run red against the current code before the matching source
edit, per the house TDD convention:
1. `files.test.ts` (new expectations: all five media types `splittable: true` at
   `MAX_MEDIA_UPLOAD_BYTES`) — red until `files.ts` changes.
2. `uploadClient.test.ts` (deleted tests; file still imports `needsSmallerFile`/
   `UNSPLIT_MEDIA_MAX_BYTES` until step 3's source edit — delete the test file's imports and the
   source file's exports in the same small step, there is no meaningful red state for a pure
   deletion).
3. `routes.test.ts` (30 MB video/mp4 now 201) — red until `files.ts` changes (routes.ts itself is
   unchanged).
4. `RecordingUpload.test.tsx` (30 MB mp4 now succeeds) — red until `RecordingUpload.tsx` drops the
   `needsSmallerFile` check.

## 15-minute searchable time re-check (long video)
Written reasoning, carried into the handoff verbatim (no code change required by this section
alone):
- **What changes.** Raising `audio/mp4`/`video/mp4`/`video/webm`'s cap from 24 MB to 500 MB lets a
  teacher upload a much longer recording of these types than before. It does **not** change any
  timeout or the chunker itself — those are 11.4d's `ffmpegChunker.ts` and `@edmate/gateway`'s
  `whisper.ts`, both out of bounds here and both unchanged.
- **The new ffmpeg step has its own hard ceiling.** `ffmpegChunker.ts`'s one ffmpeg process
  (transcode + split) is capped at `DEFAULT_TIMEOUT_MS` (10 minutes wall-clock, ADR-0016); past
  that it is SIGTERM'd then SIGKILL'd and the job fails closed as a retryable `provider_error` —
  it does not silently run long and blow the budget, it fails fast instead. This ceiling does not
  grow with the new 500 MB cap; a much larger input makes hitting that ceiling more likely (more
  bytes to demux, even with `-vn` skipping video decode), not the ceiling itself larger.
- **The pre-existing, already-accepted tail risk now covers three more formats, not a new one.**
  `audio/mpeg`/`audio/wav` have had this exact 500 MB cap and 24 MB-per-piece Whisper split since
  before this task. 11.4's own plan (Q5) already flagged: "the queue runs one job at a time across
  all teachers, and each Whisper piece has a 10-minute timeout, so a hung piece plus a retry can
  pass 15 minutes" — and recommended a media queue or job priority "only if the pilot shows it's
  needed." This task extends the identical, already-accepted exposure to mp4/webm/m4a; it does not
  introduce a new class of risk.
- **Typical case (not the timeout tail).** Each Whisper piece covers about
  `(WHISPER_MAX_UPLOAD_BYTES - header slack) / (16 kHz * 1 ch * 2 bytes)` ≈ 786 s (~13 minutes) of
  the chunker's fixed 16 kHz mono 16-bit output. A 2-hour recording is therefore about 10 pieces,
  transcribed one after another (ingest queue concurrency is 1); real Whisper calls normally take
  well under their own 10-minute timeout, so a 2-hour recording is expected to land comfortably
  inside 15 minutes in the happy path. A much longer recording (several hours) pushes the
  happy-path total closer to or past 15 minutes even with no single call timing out — this is a
  real, size-driven effect of lifting the cap, distinct from the timeout tail above.
- **Recommendation (no action needed to merge this task):** carry 11.4's own Q5 recommendation
  forward unchanged — add a media queue or job priority only if the pilot shows real recordings
  need it. Q5's real-audio timing (lead or human times one real 60-minute MP3/MP4 during the 9.0
  try-it run) still answers whether the happy-path number above is realistic; this task does not
  attempt that measurement (rule 4: no real model calls).
- **Scripted-fixture test (files.test.ts):** pins `WHISPER_MAX_UPLOAD_BYTES` (from `@edmate/gateway`)
  to 24 MB next to the existing `MAX_MEDIA_UPLOAD_BYTES < 600_000_000` pin, so if either constant
  ever moves, the test fails and this reasoning is flagged stale rather than silently wrong.

## Human steps (do not block merging the code)
1. After this PR merges, build the worker image once: `docker build -f apps/worker/Dockerfile .`
   (a human or the lead; builders never run docker).
2. Run the built image's `ffmpeg -version` and read its first lines for "GPL" vs "LGPL".
3. Record the result in this task's handoff (or a short follow-up note) per ADR-0016 Q3. If GPL,
   swap the Dockerfile's `RUN apk add --no-cache ffmpeg` line for the ADR's documented fallback (a
   pinned, checksum-verified LGPL-only static build) in a small follow-up PR — Edmate only needs
   audio decode and a WAV encode, no GPL-only codec.
4. This step is independent of the apps/web cap lift: the cap lift is safe to merge and ship
   whichever licence the built image turns out to have, since the licence only affects how the
   image is built, not whether the chunker or the cap work.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
None. Every file in scope (`apps/web/src/studio/files.ts`, `files.test.ts`, `uploadClient.ts`,
`uploadClient.test.ts`, `routes.test.ts`, `apps/web/app/teacher/live-classes/RecordingUpload.tsx`,
`RecordingUpload.test.tsx`, `apps/web/messages/en.json`) was checked against every glob in
`risk-paths.txt`: none match `packages/harness/**`, `content/**`, `evals/suites/safety|locked/**`,
`apps/worker/src/alerts/**`, `packages/harness/src/access/**`, `packages/payments/**`,
`apps/web/app/api/webhooks/**`, `apps/web/src/auth/**`, `apps/web/app/api/auth/**`,
`apps/web/app/api/staff/**`, `apps/web/app/staff/**`, `packages/db/src/identity/**`,
`packages/gateway/src/keys/**`, `packages/db/src/repositories/**`, `packages/contracts/**`,
`docs/adr/**`, `.claude/**`, `.github/**`, or `.githooks/**`. Required reviewer: code-reviewer
(always required). Recommended: typescript-reviewer, given the `media()` signature simplification
in `files.ts`. No `risk: high` decision is needed (no contracts/tech-stack change, no risky path).

## Open questions (each has a recommendation; none blocks the build)
- **Q1, should the new cap differ between audio-only (m4a) and video (mp4/webm), since an
  audio-only container of the same byte size can hold far more hours of actual audio (no video
  track taking up bytes) and so produces more Whisper pieces for the same upload size?**
  Recommend: no, keep one uniform 500 MB cap for all three, matching the existing mp3/wav
  treatment and `apps/web`'s per-upload storage cost, which doesn't distinguish by container
  either. Splitting the cap by format adds a second number to maintain for a difference the 15-
  minute re-check above already treats as an accepted, pre-existing exposure (Q5), not a new
  one this task should uniquely solve for m4a.
- **Q2, does removing `needsSmallerFile` fully retire the "media_too_large" concept, or should a
  smaller, friendlier client-side warning survive for a very large file (e.g. close to 500 MB) so
  a teacher isn't surprised by a slow upload that is then refused?** Recommend: no new client
  check in this task — `createDocument`'s existing `!created.ok` branch already shows the
  server's fixed message if a file is still refused, and 500 MB is the same cap mp3/wav uploads
  have always had with no such warning. A client-side "this may take a while" hint for any large
  media file (not specific to the three types this task touches) is a separate, future UX task if
  the pilot shows teachers are confused, not a blocker here.

## Budget
Budget: 45 tool calls (1 phase, apps/web only)

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash. Bash is limited to:
- `corepack pnpm` install, typecheck, lint and test for `@edmate/web` (and its dependency filter);
- `python3 .githooks/secret-scan.py`;
- `corepack pnpm exec prettier --check` on changed files;
- git on this task's own branch (no rebase, no force push).
No docker, no psql, no real network or model call, and no `apps/web/e2e/**` or Playwright config
edit or run.

## Exit conditions
- **DONE:**
  - All eight listed files are edited as described; no file outside that list changes (in
    particular, nothing under `apps/web/e2e/**`, `apps/worker/**`, `packages/gateway/**`,
    `packages/contracts/**` or `docs/adr/**`).
  - `corepack pnpm turbo run typecheck lint test --filter=@edmate/web...` is green; secret scan
    clean.
  - The handoff restates the "Budget re-check" reasoning above (or an improved version of it) and
    records that the human licence-check step is separate and pending, not done by the builder.
- **PARTIAL (stop and hand off):**
  - Past about 40 tool calls with files still failing.
  - A file outside the eight listed needs changes (notably any `apps/web/e2e/**` file, or anything
    under `apps/worker/**`/`packages/gateway/**` — a sign the cap lift needs a worker-side change
    this plan didn't anticipate).
  - The gate fails twice for the same cause.

## Lead answers (27 Oct 2026)
- Q1: No. One uniform 500 MB cap (MAX_MEDIA_UPLOAD_BYTES) for all media types, as the plan proposes.
- Q2: No new client-side warning in this task.
- Human steps: the builder never runs docker. The handoff records the ffmpeg licence as "pending human (blockers.md)". The lead tracks the image build and licence check in .claude/blockers.md, and it does not block the merge.
