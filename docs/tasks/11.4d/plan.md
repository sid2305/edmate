# 11.4d plan: an ffmpeg chunker in the worker, for MP4/WebM/M4A recordings of any length (M13)

Board: 11.4d (M13), deps 11.4b (done). Planned 27 Oct 2026.

Status: **READY.** No open question blocks Phase A. Q3 (ffmpeg licence banner) is a lead/human
check after the builder writes the Dockerfile line, not a build blocker.

## Acceptance (verbatim)
Board 11.4d: "ffmpeg chunker in the worker so MP4, WebM and M4A recordings of any length can be
transcribed (needs an ADR: new system binary)." *Accept:* "ADR reviewed by architect,
security-reviewer and typescript-reviewer; a long MP4 fixture splits and ingests; worker
typecheck, lint and test green."

### How it will be shown
1. **The ADR** (`docs/adr/0016-ffmpeg-chunker.md`) exists, passes `python3 docs/adr/check-headings.py`,
   and is reviewed and approved by architect, security-reviewer and typescript-reviewer (review.md
   names all three; the merge handoff logs `risk: high`, per rule 2 and `risk-paths.txt`'s
   `docs/adr/**` group).
2. **The chunker splits**, proven two ways:
   - **Always (no ffmpeg needed):** unit tests inject a fake process runner, so the argument
     list, the no-shell invocation, the timeout-and-kill path, the total-output-size guard and
     temp-directory cleanup are all tested deterministically and run in CI every time.
   - **Opt-in (real ffmpeg):** one test block, skipped unless `ffmpeg` is on PATH, generates a
     *synthetic* MP4 with ffmpeg itself (`-f lavfi -i anullsrc=...`, silence, no recording, no
     personal data, never committed) and feeds it to the chunker with an artificially small
     `maxBytes` so even a short, cheap clip is forced into several pieces — proving the "any
     length" claim without a large fixture.
3. **It ingests:** a second opt-in test (same ffmpeg-on-PATH gate) runs that synthetic MP4
   through `createWhisperTranscriber` with the new chunker wired in and a **fake** `fetch`
   standing in for Whisper (rule 4: no real model call), and checks the pieces are transcribed in
   order and stitched into one transcript. This is the acceptance's "splits and ingests" line.
4. `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...` is green (opt-in
   tests skip, not fail, where ffmpeg is absent). The secret scan is clean.
5. The Dockerfile line is written by the builder; the actual image build (`docker build -f
   apps/worker/Dockerfile .`) is **not** run by the builder (builders never run docker per plan
   convention and this task's Allowed tools) — the lead or a human runs it once before this merges
   and before the licence check in Q3 can be answered. The handoff says this plainly so no one
   assumes the image was built.

## What already exists (reused, not rebuilt)
- `packages/gateway/src/transcriber/chunking.ts`'s `defaultChunker` (WAV/MP3, byte-exact, already
  tested) and the `AudioChunker`/`AudioChunk` types it exports — the port this task's chunker also
  implements.
- `packages/gateway/src/transcriber/whisper.ts`'s `createWhisperTranscriber`, which already takes
  an optional `chunker` and already enforces `maxUploadBytes`, timeouts and chunk-order checks
  (`checkChunks`) around whatever a chunker returns — this task supplies a chunker, not new
  plumbing in `whisper.ts`.
- `DEFAULT_MAX_DOWNLOAD_BYTES` (600 MB) and `TranscriberError`, both already exported from
  `@edmate/gateway`.
- `apps/worker/src/ingest/gateway.ts`'s `createIngestGateway`, the one composition root that
  builds `createWhisperTranscriber(openaiKeys, { allowedHosts: [s3Host] })` today, with no chunker
  — the one call site this task edits.
- `apps/web/src/studio/files.ts`'s `UploadType` table, which already names the exact three types
  this task must handle: `audio/mp4` (.m4a), `video/mp4` (.mp4), `video/webm` (.webm) — each
  currently `splittable: false` (task 11.4f) and capped at `MAX_UNSPLIT_MEDIA_BYTES` (24 MB) at
  upload. **This task does not touch that table or that cap** (apps/web is out of bounds); lifting
  it is a follow-up (Q5).
- **No change** to `packages/contracts`, `packages/harness`, `packages/ingest`, `packages/queue`,
  `packages/gateway`, `packages/db` or `apps/web`. `packages/gateway` in particular stays
  untouched: everything this task needs from it is already exported.

**Why this needs an ADR.** `apps/worker`'s Docker image gains a system binary (`ffmpeg`) it did
not have before — a tech-stack change (rule 2), reviewed by architect, security-reviewer and
typescript-reviewer, approved by the lead with a `risk: high` decision.

## Files out of bounds (both phases)
- `packages/contracts/**`, `packages/harness/**`, `packages/ingest/**`, `packages/queue/**`,
  `packages/db/**`, `apps/web/**` (including `MAX_UNSPLIT_MEDIA_BYTES`, `UploadType.splittable`
  and the 24 MB upload cap — Q5, a separate follow-up)
- `packages/gateway/**` (every symbol this task needs is already exported; if a phase finds it
  truly needs a new gateway export, that's a PARTIAL, not a silent scope add)
- `content/**`, `.claude/**`, `.github/**`, `.githooks/**`
- Any real recording, transcript or caption file (rule 5). Every fixture is synthetic audio
  (silence) generated at test time, never committed.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `docs/adr/**` — **Required: architect, security-reviewer, typescript-reviewer** (the ADR itself).
  The merge handoff logs a `risk: high` decision (rule 2's own requirement, independent of this
  file).
- `apps/worker/src/ingest/**`, `apps/worker/Dockerfile` — match no glob in `risk-paths.txt`
  (`apps/worker/src/alerts/**` is listed; `apps/worker/src/ingest/**` is not). **No required
  reviewer from that file.** Given the board's own `risk: high` label and the new system binary,
  the plan still recommends code-reviewer and typescript-reviewer review the chunker code itself
  (normal PR review, not a `risk-paths.txt` requirement) for the subprocess-handling and
  resource-limit logic described below.
- `.claude/**`, `.github/**`, `.githooks/**` are not touched by either phase.

## ADR (docs/adr/0016-ffmpeg-chunker.md, next after 0015)
The architect drafts this text in review (per the handoff format: architect's words, builder's
file); the builder copies it into the file with the template's exact headings (`check-headings.py`
enforces order: Status, Date, Context, Decision, Alternatives, Consequences, Reviewers).

**Context:** the gap found while planning 11.4 (see `docs/tasks/11.4/plan.md`, "Gap this task
closes"): `createWhisperTranscriber`'s `defaultChunker` only splits WAV and MP3; an M4A, MP4 or
WebM over 24 MB uploads (apps/web's 500 MB media cap) and then fails downstream as
`input_too_large`. 11.4b (done) refused those files at upload with a fixed message pointing to MP3
or a transcript file, as a stopgap, and filed this task as the real fix.

**Decision** (what the builder's Phase A implements — the ADR states this, it doesn't re-derive
it):
1. **Where it lives.** A new `AudioChunker` (the existing port type, unchanged) in
   `apps/worker/src/ingest/ffmpegChunker.ts`. Not in `packages/gateway`: the binary is specific to
   this one deployable image, and `packages/gateway` already exports every type and constant the
   new code needs. Composed only at `apps/worker/src/ingest/gateway.ts`'s `createIngestGateway`.
2. **Scope.** Exactly the three types `apps/web`'s `UploadType` table already names as
   recordings the worker can't split today: `audio/mp4`, `video/mp4`, `video/webm` (Q1 in Open
   questions below). `audio/mpeg` and `audio/wav` keep going through the existing, already-tested
   `defaultChunker` (byte-exact, no re-encoding). Anything else keeps `defaultChunker`'s existing
   refusal (`input_too_large`, "configure a chunker") unchanged.
3. **How it splits.** Audio only, always re-encoded to a fixed, known format — 16 kHz mono 16-bit
   PCM WAV — so byte-rate math is exact and no general-purpose container parsing is needed on the
   output side. One `ffmpeg` process per call does transcode *and* split in one pass, using the
   `segment` muxer with a `segment_time` computed from `maxBytes` and the fixed 32,000 bytes/second
   rate (`floor((maxBytes - headerSlack) / 32000)` seconds per piece), writing numbered whole WAV
   files (each with its own valid header) to a per-call temp directory. The chunker reads them
   back in filename order, computes each piece's `offsetMs` as the running total of the pieces
   already read (not `index * segment_time`, so the last, shorter piece is exact) and its
   `durationMs` from its own `data` chunk size. `-vn` drops any video stream — only audio is
   decoded or written.
4. **No shell, no argument injection.** `child_process.spawn('ffmpeg', [...fixedArgs], { shell:
   false (the default) })` — every argument is either a literal flag or a path the chunker created
   itself (`fs.mkdtemp` under `os.tmpdir()`), never a string built from the recording's bytes,
   mimeType or any request field. The chunker never uses `exec`/`execSync` or a template string.
5. **Resource limits.**
   - Input size is already capped upstream (`maxDownloadBytes`, 600 MB, enforced by `whisper.ts`
     before the chunker is ever called) — unchanged.
   - A hard wall-clock timeout per ffmpeg process (default matching the existing
     `DEFAULT_CHUNK_TIMEOUT_MS`/`DEFAULT_DOWNLOAD_TIMEOUT_MS` precedent, 10 minutes), using
     `spawn`'s own `signal: AbortSignal.timeout(...)` option so a hung or adversarial input is
     SIGTERM'd (then killed) rather than hanging the (concurrency-1) ingest worker indefinitely. A
     timeout is mapped to a retryable `TranscriberError('provider_error', true, ...)`, matching the
     existing download-timeout convention.
   - A running total of the bytes written across all produced pieces is checked against
     `DEFAULT_MAX_DOWNLOAD_BYTES` (reused, not duplicated) as pieces are read back, in case a small
     input decodes to an implausibly long or loud stream (a decompression-bomb shape); exceeding it
     throws a non-retryable `input_too_large` and stops reading further pieces.
   - `-nostdin` so ffmpeg never blocks waiting for interactive input; stdout/stderr are piped and
     capped in size while read (never logged raw: only the exit code and a fixed message reach any
     log line or error, per the existing "never log the signed URL" convention in
     `source.ts`/`whisper.ts` — the same discipline extends to never logging ffmpeg's stderr, which
     could otherwise be made to contain attacker-chosen bytes from the input file's metadata).
   - **Cleanup.** The per-call temp directory (`fs.mkdtemp`) is removed with `fs.rm({ recursive:
     true, force: true })` in a `finally` block that runs on every exit path: success, a non-zero
     ffmpeg exit code, a timeout kill, or the output-size guard tripping.
   - **Concurrency.** The ingest `Worker` is already `concurrency: 1` per worker process
     (`apps/worker/src/ingest/workers.ts`); this task adds no new concurrency control, and notes in
     Consequences that N worker replicas run up to N ffmpeg processes at once.
6. **Errors.** A non-zero ffmpeg exit is a non-retryable `TranscriberError('validation', false,
   'the recording could not be read by the chunker')` — the same "a chunker never guesses"
   convention `chunking.ts`'s own comment already states. No output pieces (e.g. silence shorter
   than one segment, or a zero-length stream) is the same error, not an empty success.
7. **The Dockerfile.** One line in the `runtime` stage of `apps/worker/Dockerfile`, before `USER
   node`: `RUN apk add --no-cache ffmpeg`. Reproducibility comes from the already-pinned base image
   tag (`node:22.22.3-alpine3.22`), the same way every other dependency in that Dockerfile is
   pinned; `apk` itself has no per-package digest pin, which is a known, accepted gap, not new to
   this task. The builder writes this line and does not run `docker build` (Allowed tools; builders
   never run docker/compose beyond throwaway test containers). The lead or a human runs the actual
   build once and checks `ffmpeg -version`'s licence banner before relying on this in a deployed
   image (Q3).
8. **Licence.** ffmpeg's own code is LGPL 2.1+; a build configured `--enable-gpl` (to add
   GPL-licensed codecs such as libx264/libx265) makes the *resulting binary* GPL as a whole. Edmate
   only needs audio decode (AAC, Opus/Vorbis, the codecs MP4/WebM/M4A commonly carry) and a WAV
   (PCM) encode — no GPL-only codec is required. Whether Alpine's `ffmpeg` apk package in the pinned
   base image is built `--enable-gpl` is not yet verified (Q3); the ADR records the decision to
   default to the distribution package unless that check fails, with a documented fallback (a
   pinned, checksum-verified LGPL-only static build) if it does.
9. **Image size.** The Alpine `ffmpeg` package pulls shared libraries for codecs this task never
   calls (video encoders, subtitle burn-in, etc.); this is accepted for MVP speed. A smaller,
   feature-pruned static build is a size optimisation for later, not blocking this task.

**Alternatives** (the ADR states why each was not chosen):
- **A pure-JS/WASM demuxer-decoder** (e.g. an ffmpeg-to-WASM build, or per-container JS demuxers
  plus JS/WASM AAC/Opus decoders). Not chosen: it is slower, raises the same codec-licence question
  without the benefit of a well-audited OS package, is harder to bound with a process-level
  timeout/kill, and for MP4/WebM/Opus/AAC specifically ends up being "ffmpeg's own decoders,
  recompiled" rather than a genuinely different, lighter dependency.
- **A hosted transcoding/transcription service** (e.g. a cloud media API). Not chosen: a new paid
  vendor (payments are out of scope until M10 per the team-lead's "Payments come last"), recordings
  can carry students' voices and names (11.4's Q2 privacy concern) which would now leave Edmate's
  infrastructure, and the extra network hop works against the 15-minute budget this pipeline is
  already tight on (11.4's Q5).
- **ffmpeg as a separate sidecar/microservice** instead of inside the worker image. Not chosen for
  MVP: a second deployable, a network call and its own auth add real operational cost for one
  binary call per recording; revisit only if image size or process isolation becomes a measured
  problem.
- **ffmpeg's `segment` muxer sized by a fixed duration guess** instead of computed from `maxBytes`
  and the fixed WAV byte rate. Not chosen: a fixed duration can't guarantee pieces stay under
  Whisper's upload cap for every bit depth/channel combination; computing from the byte rate we
  ourselves fix (16 kHz mono 16-bit) keeps the guarantee exact, the same discipline `splitWav` in
  `chunking.ts` already uses.
- **Piping ffmpeg's stdin/stdout instead of temp files.** Not chosen: MP4's index (`moov` atom) can
  sit at the end of the file, which many decoders (including ffmpeg's `mov` demuxer, depending on
  how the file was written) need to seek to read, so a non-seekable stdin pipe doesn't work in
  general; the `segment` muxer's numbered output files are also simplest to read back by name on
  stdout, which piping would complicate rather than simplify.

**Consequences:** stated above (image size, licence check as a human/lead gate, N-worker-replicas
times one ffmpeg process at once, apps/web's upload cap for these three types staying at 24 MB
until a follow-up lifts it — Q5).

**Reviewers:** architect, security-reviewer, typescript-reviewer. The lead approves and logs
`risk: high`.

## Build order and phases
Two phases; each is a fresh builder reading this plan and (Phase B only) Phase A's handoff.

### Phase A: the chunker itself (~70 tool calls)
**Files:**
- `docs/adr/0016-ffmpeg-chunker.md` (new) — the ADR above, written after the architect's review
  text lands in `review.md`.
- `apps/worker/src/ingest/ffmpegChunker.ts` (new): exports `createFfmpegChunker(opts?):
  AudioChunker` (the `AudioChunker` type from `@edmate/gateway`, unchanged). `opts` lets tests
  inject a fake process runner (mirroring how `whisper.ts` already injects `fetch`) and override
  the ffmpeg binary name/path, the timeout and the output-size cap; every default matches the
  Decision section above. Internals: build the fixed `spawn` argv, write the input to a temp file,
  run with a timeout, read pieces back in order with the running-total guard, parse each piece's
  own WAV header for `durationMs` (a small, local, generic RIFF/`data`-chunk reader — written
  fresh here, not imported from `packages/gateway`, since that package stays untouched), always
  clean up in `finally`, map every failure path to the `TranscriberError` codes in the Decision
  section.
- `apps/worker/src/ingest/ffmpegChunker.test.ts` (new):
  - Unit tests with a fake process runner (no real ffmpeg, no `it.skip`): correct argv (no shell,
    fixed flags, our own temp paths only — assert nothing from the input `mimeType` or bytes
    appears in the argv); a non-zero exit becomes a non-retryable `validation` error; a timeout
    (the fake runner never resolves) kills the process and becomes a retryable `provider_error`;
    an oversized total output trips the running-total guard and throws `input_too_large`, reading
    no further pieces; the temp directory is removed in every one of those cases (assert via the
    real `fs`, since the directory itself is real even though the process is faked); a happy path
    with 2–3 fake WAV pieces returns `AudioChunk[]` with correct, monotonically increasing
    `offsetMs` and `durationMs` from each piece's own header.
  - One opt-in block, skipped unless `ffmpeg -version` succeeds on this machine (checked once,
    synchronously, at module load inside the test file — never crashes the suite when absent):
    generates a short synthetic silent MP4 with real ffmpeg (`-f lavfi -i
    anullsrc=r=16000:cl=mono -t <a few minutes> -c:a aac`), feeds it to a *real*
    `createFfmpegChunker()` with an artificially small `maxBytes` (forcing several pieces despite
    the clip's small encoded size), and asserts: more than one piece, each ≤ `maxBytes`, offsets
    monotonic, and the pieces' total duration is close to the source duration (within one segment
    length). No file is committed; everything is generated inside the test and discarded.
  - A second opt-in test (same gate): the synthetic MP4 above, run through
    `createWhisperTranscriber(fakeKeys, { allowedHosts: [...], chunker:
    createFfmpegChunker(), fetch: fakeFetch })` where `fakeFetch` serves the MP4 bytes for the
    download leg and a scripted Whisper-shaped JSON response per piece for the transcription leg
    (rule 4: no real model call) — asserts one stitched `Transcript` with segments covering the
    pieces in order. This is the acceptance's "a long MP4 fixture splits and ingests."

**Tests first:** every case above is written and run red (fake runner not yet implemented, or
`createFfmpegChunker` not yet exported) before `ffmpegChunker.ts` is written, per rule-set
convention.

**State after this phase:** `createFfmpegChunker` exists, is fully unit-tested without needing
ffmpeg installed, and is proven against real ffmpeg when it's on the builder's machine (or in CI,
if CI has it — Q4). Nothing calls it yet: `apps/worker/src/ingest/gateway.ts` is unchanged.
`--filter=@edmate/worker...` is green. The ADR is written and its text is attributed to the
architect's review. The handoff logs the `risk: high` decision (rule 2) even though
`docs/adr/**`'s own required-reviewers line already forces the review.

### Phase B: wire it in, Dockerfile, final gate (~30 tool calls)
**Files:**
- `apps/worker/src/ingest/gateway.ts` (edit): `createIngestGateway` passes `chunker:
  createFfmpegChunker()` as a new field in the options object given to `createWhisperTranscriber`.
  No other line changes.
- `apps/worker/src/ingest/gateway.test.ts` (edit): a direct chunker-wiring test is not possible
  through this module's public surface (`ModelTranscriber` only exposes `model` and `transcribe`,
  per `whisper.ts`); instead, extend the existing "allows only the configured S3 host" test's
  sibling coverage with one assertion that `createIngestGateway`'s returned transcriber still
  rejects a disallowed host the same way after the chunker is wired (proving the edit didn't change
  the allowlist behaviour), and note in the handoff that the chunker's own behaviour is covered by
  Phase A's tests, not re-tested here.
- `apps/worker/Dockerfile` (edit): the one `RUN apk add --no-cache ffmpeg` line in the `runtime`
  stage, per the ADR's Decision §7, plus a one-line comment pointing at the ADR.

**Tests first:** the gateway.test.ts addition (red: today's gateway test doesn't exercise a chunked
path) before the `gateway.ts` edit.

**State after this phase (task done):** the worker's real transcriber composition passes the new
chunker; MP4/WebM/M4A recordings of any length can be transcribed once the image is rebuilt with
ffmpeg. `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...` is green. The
secret scan is clean. The Dockerfile change is written but **not built** by the builder (a lead or
human check, stated plainly in the handoff). The handoff restates the `risk: high` decision from
Phase A (one decision, not two) and records whether the opt-in tests ran or skipped on the
builder's machine.

## Open questions (each has a recommendation; none blocks Phase A)
- **Q1, how wide is the ffmpeg chunker's scope — exactly `audio/mp4`/`video/mp4`/`video/webm`, or
  any type `defaultChunker` doesn't already handle?** Recommend: exactly those three, matching
  `apps/web`'s `UploadType` table today. A generic "ffmpeg handles whatever defaultChunker
  doesn't" would quietly accept types `apps/web` never offers for upload, with no way for a
  teacher to reach them and no test coverage pressure to keep them working. Widening later is a
  one-line change, not an ADR amendment, since the ADR's Decision already names "MP4/WebM/M4A" as
  the scope, not an exhaustive list of excluded types.
- **Q2, temp files vs. piping ffmpeg's stdin/stdout.** Recommend temp files (ADR Alternatives:
  MP4's index can be at the end of the file, so a non-seekable pipe isn't reliable in general, and
  the `segment` muxer's numbered output files are simplest to read back by name).
- **Q3, is the Alpine `ffmpeg` apk package in the pinned base image LGPL-only or
  `--enable-gpl`?** Not verified in this plan (planning has no docker access). Recommend: the lead
  or a human runs `docker build -f apps/worker/Dockerfile .` once after Phase B merges and checks
  `ffmpeg -version`'s first lines for "GPL" vs "LGPL"; if GPL, swap the Dockerfile line for a
  pinned, checksum-verified LGPL-only static build in a small follow-up (Edmate needs decode + WAV
  encode only, never libx264/libx265). This does not block merging Phase B: the ADR already states
  the fallback, and no code depends on which build ships.
- **Q4, does CI have ffmpeg on PATH, so the opt-in tests actually run there (not just skip)?** Not
  verified in this plan (no CI run available while planning). Recommend: the builder's Phase A
  handoff states plainly whether `ffmpeg -version` succeeded on the builder's own machine and,
  separately, whether GitHub's hosted `ubuntu-latest` runner is believed to ship ffmpeg
  preinstalled (commonly documented as part of its default tool list) — without editing
  `.github/workflows/ci.yml` (out of bounds here; `.github/**` needs its own security-reviewer
  review per `risk-paths.txt`). The lead checks the next CI run's log for this test's pass/skip
  line and opens a small follow-up to install ffmpeg in CI only if it's shown to be missing there.
- **Q5, should `apps/web`'s 24 MB cap for `audio/mp4`/`video/mp4`/`video/webm`
  (`MAX_UNSPLIT_MEDIA_BYTES`, `UploadType.splittable`) be lifted once this ships?** Recommend: no,
  not in this task (`apps/web/**` is out of bounds here). Open a follow-up board task once 11.4d
  merges and the Dockerfile is actually built with ffmpeg; that follow-up should also re-check the
  15-minute searchable budget for a long video going through ffmpeg-chunking plus multi-piece
  Whisper transcription (11.4's own Q5 already flags this as unmeasured for real audio).

## Budget
Budget: 100 tool calls (2 phases: A chunker + ADR + tests ~70; B wiring + Dockerfile + gate ~30)

Each phase is a fresh builder that reads this plan and the previous phase's handoff. Board tasks:
reuse 11.4d for Phase A's branch/handoff; open a lettered follow-up (e.g. 11.4d.b, or a fresh id —
the lead's call at hand-off time) for Phase B if the board needs two branches. If the lead instead
runs both phases as one branch under 11.4d, the 100-call budget still applies to the whole task.

## Allowed tools
Read, Grep, Glob, Edit, Write, Bash. Bash is limited to:
- `corepack pnpm` install, typecheck, lint and test for `@edmate/worker` (and its dependency
  filter);
- `ffmpeg -version` and ad hoc local `ffmpeg` invocations the opt-in tests themselves make
  (generating a synthetic silent MP4, probing for its presence) — never a real recording;
- `python3 docs/adr/check-headings.py` and `python3 .githooks/secret-scan.py`;
- git on the phase's own branch (no rebase, no force push).
- **Builders never run `docker` or `docker compose` in this task** (not even for throwaway
  containers) — the Dockerfile line is written, not built, by the builder.

No network calls beyond the package manager, no real model or payment calls, no real recording or
transcript file.

## Exit conditions
- **DONE:**
  - The phase's tests were written red first and now pass (opt-in tests pass or skip, never fail,
    when ffmpeg is absent).
  - `--filter=@edmate/worker...` (typecheck, lint, test) is green and the secret scan is clean.
  - Phase A: `python3 docs/adr/check-headings.py` passes and the ADR names architect,
    security-reviewer and typescript-reviewer as reviewers.
  - The diff touches only the phase's listed files.
  - The handoff has `Status: DONE`, `Tool calls used:`, files, tests, and the `risk: high` decision
    (Phase A), plus whether the opt-in tests ran or skipped on the builder's machine.
- **PARTIAL (stop and hand off):**
  - Phase A passes about 85 tool calls, or Phase B about 40.
  - A file outside the phase's list needs changes, notably anything under `packages/gateway/**`,
    `packages/contracts/**`, `apps/web/**` or `.github/**`.
  - The builder finds it needs to run `docker build` to make progress (it should not: the chunker
    and its tests never need the actual image).
  - A new npm/pnpm dependency looks necessary (this task should need none: `child_process`,
    `node:fs`, `node:os` and `node:crypto` are all already available to `apps/worker` via Node's
    standard library).
  - The gate fails twice for the same cause.

## Lead answers (27 Oct 2026)
- Branch: both phases run on one branch, `m13/11.4d-ffmpeg-chunker`, under task 11.4d; a fresh builder per phase; the 100-call budget covers the whole task.
- Q1: agreed, exactly `audio/mp4`, `video/mp4` and `video/webm`.
- Q2: agreed, temp files.
- Q3: agreed. Builders and the lead don't run docker; the GPL/LGPL check of `ffmpeg -version` in the built image is a human step after merge, recorded on the follow-up task 11.4i. The ADR states the fallback (a pinned, checksum-verified LGPL-only static build) and that ffmpeg runs as a separate process, never linked.
- Q4: agreed. The Phase A handoff says whether ffmpeg was on PATH locally; the lead checks the CI log for the opt-in test's pass or skip line. No `.github/**` edit in this task.
- Q5: agreed. Follow-up board task 11.4i (deps 11.4d): lift apps/web's 24 MB cap for these three types, re-check the 15-minute searchable budget for a long video, and the human's ffmpeg licence check in the built image.
