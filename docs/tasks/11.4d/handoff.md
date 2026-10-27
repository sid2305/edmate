# Handoff: 11.4d

Status: DONE

## Phase A

**Files changed:**
- `apps/worker/src/ingest/ffmpegChunker.ts` (new): exports `createFfmpegChunker(opts?): AudioChunker`. Delegates `audio/mpeg`/`audio/wav` (and anything else) to `defaultChunker` unchanged; for `audio/mp4`/`video/mp4`/`video/webm` it runs one `ffmpeg` process (`child_process.spawn`, `shell: false`, fixed argv) to re-encode and split the recording into numbered 16 kHz mono 16-bit PCM WAV pieces in a per-call `fs.mkdtemp` temp directory, reads them back in filename order (local RIFF/`data`-chunk reader for `durationMs`), enforces a wall-clock timeout (`AbortSignal.timeout`) and a running-total output-size guard (reused `DEFAULT_MAX_DOWNLOAD_BYTES`), and always removes the temp directory in a `finally`. `opts.run` lets tests inject a fake process runner (mirrors how `whisper.ts` injects `fetch`); `opts.ffmpegPath`, `opts.timeoutMs`, `opts.maxOutputBytes` override defaults.
- `apps/worker/src/ingest/ffmpegChunker.test.ts` (new): unit tests with a fake `ProcessRunner` (argv shape / no-shell / nothing from `mimeType` or the raw bytes in argv; scope delegation to `defaultChunker`; non-zero exit → non-retryable `validation`; a hanging runner + small `timeoutMs` → retryable `provider_error`; an oversized running total → non-retryable `input_too_large`, stopping before reading every piece; no output pieces → `validation`; a happy path with 3 fake WAV pieces → correct, monotonically increasing `offsetMs`/`durationMs`; every failure/success path asserts the real temp directory is gone via `fs.stat`). One `describe.runIf(FFMPEG_PRESENT)` block (checked once, synchronously, via `spawnSync('ffmpeg', ['-version'])`, inside a `try`/`catch` so it never throws when ffmpeg is absent) with two opt-in tests against real ffmpeg: (a) a synthetic tone MP4 (generated with `ffmpeg -f lavfi -i sine=...`, never committed) split with an artificially small `maxBytes`, asserting more than one piece, each ≤ `maxBytes`, offsets monotonic, total duration within one segment of the source; (b) the same synthetic MP4 run through `createWhisperTranscriber(fakeKeys, { chunker: createFfmpegChunker(), fetch: fakeFetch })` with a local fake `fetch` (download leg serves the MP4 bytes, transcription leg serves a scripted Whisper-shaped `verbose_json` response per call) — no real model or network call — asserting a stitched transcript whose segments cover the pieces in order and `transcriptionCalls > 1`.
- `docs/adr/0016-ffmpeg-chunker.md` (new): the ADR, Status "Proposed", following `0015-payments-port.md`'s heading order; passes `python3 docs/adr/check-headings.py`.

**Red then green:** wrote the full test suite first against a stub `createFfmpegChunker` that threw `not implemented yet (red phase)`; ran `vitest run src/ingest/ffmpegChunker.test.ts` and confirmed all 11 tests failed (red). Restored the real implementation and reran the same file: all 11 passed (green). Re-ran again after wiring into the full gate below; still 11/11.

**ffmpeg on this machine:** `ffmpeg -version` succeeded (ffmpeg 4.2.3, Homebrew build on macOS). Both opt-in tests ran (not skipped) and passed. Whether GitHub's hosted `ubuntu-latest` runner has ffmpeg on `PATH` is unverified here (Q4, plan); the lead should check the next CI run's log for this file's pass/skip line.

**State after this phase:** `createFfmpegChunker` exists, is fully unit-tested without needing ffmpeg installed, and is proven against real ffmpeg on this machine. Nothing calls it yet — `apps/worker/src/ingest/gateway.ts` is unchanged, so `createIngestGateway` still composes the transcriber with no chunker (Phase B's job). The ADR is written from this plan's own Decision section (the architect has not yet reviewed it; this handoff does not claim that review happened).

## Phase B

**Files changed:**
- `apps/worker/src/ingest/gateway.ts` (edit): `createIngestGateway` now passes `chunker:
  createFfmpegChunker()` in the options object given to `createWhisperTranscriber`, alongside the
  existing `allowedHosts: [s3Host]`. No other line changed.
- `apps/worker/src/ingest/gateway.test.ts` (edit): added one assertion to the existing "allows only
  the configured S3 host" coverage — a sibling test (`11.4d: still rejects a disallowed host now
  that the ffmpeg chunker is wired in`) that calls `gateway.transcriber!.transcribe` with a
  disallowed host and `mimeType: 'video/mp4'`, asserting it still rejects. The chunker's own
  argv/timeout/output-guard/cleanup behaviour is not re-tested here — that's Phase A's job
  (`ffmpegChunker.test.ts`), per the plan.
- `apps/worker/Dockerfile` (edit): one `RUN apk add --no-cache ffmpeg` line in the `runtime` stage,
  before `USER node`, with a comment pointing at ADR-0016 and its Q3 licence-check follow-up.

**Red then green:** added the new test to `gateway.test.ts` first and ran
`vitest run src/ingest/gateway.test.ts` — it passed immediately (8/8) even before the `gateway.ts`
edit, because the allowlist check in `whisper.ts`
runs before any chunking and rejects the disallowed host regardless of which chunker is configured;
this matches the plan's own note ("a direct chunker-wiring test is not possible through this
module's public surface"). The test is still meaningful: it proves the edit didn't change the
allowlist behaviour. After wiring `createFfmpegChunker()` into `gateway.ts`, reran the same file:
still 8/8 green, and the full `--filter=@edmate/worker...` gate below is green with the chunker
composed.

**ffmpeg on this machine:** unchanged from Phase A — `ffmpeg -version` succeeds locally (no need to
re-probe for this phase; Phase A's opt-in tests already covered that and are untouched here).

**State after this phase (task done):** `createIngestGateway` composes the real transcriber with
`createFfmpegChunker()` wired in — MP4/WebM/M4A recordings of any length will transcribe once the
worker image is rebuilt with ffmpeg installed. The Dockerfile change is written but **not built**
by this builder (builders never run `docker`/`docker compose` per the plan's Allowed tools); the
lead or a human must run `docker build -f apps/worker/Dockerfile .` once, per the plan's Lead
answers on Q3, and check `ffmpeg -version`'s licence banner (GPL vs LGPL) before relying on this in
a deployed image — tracked on follow-up board task 11.4i. Whether GitHub's hosted `ubuntu-latest`
CI runner has ffmpeg on PATH (so Phase A's opt-in tests run there rather than skip) is still
unverified (Q4); the lead checks the next CI run's log for `ffmpegChunker.test.ts`'s pass/skip line.

## Fix round 1

Addressed the three required findings from `review.md` (security-reviewer CRITICAL, architect
HIGH, typescript-reviewer HIGH); the MEDIUM/LOW items (output cap during the run, `wavDurationMs`
bounds, drain error listener, bare catch, oversized-output test) are deferred to task 11.4j, per
the fix brief, and not touched here.

**1. ffmpeg must not follow references inside the media (security CRITICAL / architect HIGH).**
`apps/worker/src/ingest/ffmpegChunker.ts`: added a fixed `FFMPEG_INPUT_FORMAT` table
(`audio/mp4`/`video/mp4` -> `mp4`, `video/webm` -> `webm`) and put `-protocol_whitelist file -f
<format>` before `-i` in the argv -- the demuxer name comes only from this table, never from the
mime string itself (`lowerMime` is only a lookup key). Verified directly with the real ffmpeg on
this machine (4.2.3) that `-f mp4` and `-f webm` are both accepted input-format names (confirmed
against `ffmpeg -demuxers`'s `mov,mp4,m4a,3gp,3g2,mj2` and `matroska,webm` rows) and that, without
this fix, `-i` on an `#EXTM3U` playlist whose segment points at `http://127.0.0.1:9/x.ts` and on an
`ffconcat` playlist referencing a local file both succeed in opening those references (content
sniffing), while forcing `-protocol_whitelist file -f mp4` makes both fail immediately with
"Invalid data found when processing input" -- confirmed by hand with real ffmpeg before writing the
test.
- Red: wrote `createFfmpegChunker: protocol whitelist and forced demuxer` (3 cases, one per mime)
  and the two new opt-in tests (HLS-shaped and concat-shaped inputs labelled `video/mp4`) against
  the pre-fix `ffmpegChunker.ts`; the protocol-whitelist assertions failed (no `-protocol_whitelist`
  or forced `-f` in argv) and the opt-in HLS test failed because real ffmpeg actually tried to open
  the manual-test-confirmed network path (observed directly via the hand-run `ffmpeg -i hls.m3u8`
  command above, which attempts to connect before this fix; after the fix the same command rejects
  the input outright).
- Green: after adding the fixed table and the two new argv entries, all argv tests pass; both
  opt-in tests pass -- the HLS test's local TCP listener on `127.0.0.1` receives zero connections,
  and the concat test's referenced local file is read back unchanged (never consumed by ffmpeg).

**2. A process that ignores SIGTERM must not hang the worker (typescript HIGH).** Rewrote
`realRunner` as `createRealRunner(graceMs)` (exported for the new test): it no longer passes
`signal: opts.signal` to `spawn` (Node's own signal integration rejects the promise the instant the
signal aborts, without waiting to see whether the child actually exited -- which is exactly the bug:
`run()` would falsely report completion while an ffmpeg that ignores SIGTERM kept running).
Instead, on abort the runner now sends SIGTERM itself, starts a `setTimeout(graceMs)` that calls
`child.kill('SIGKILL')` if `exit`/`error` hasn't fired yet, clears that timer the moment the process
actually exits, and the returned promise settles exactly once, only on a genuine `exit` or spawn
`error`. `DEFAULT_SIGKILL_GRACE_MS` (5 s) is the default; `FfmpegChunkerOptions.sigkillGraceMs`
overrides it.
- Red: with the original `spawn({ signal })`-based `realRunner`, the new test (`createRealRunner:
  SIGTERM then SIGKILL`) failed immediately with `AbortError: The operation was aborted` thrown from
  inside the promise -- Node's built-in signal handling rejected the moment `AbortSignal.timeout`
  fired, before the child (which traps and ignores SIGTERM) had any chance to actually exit. This is
  precisely the HIGH finding reproduced as a failing test, not just asserted in prose.
- Green: after the rewrite, the test spawns a real `node -e` child that writes its own pid to a
  file, traps SIGTERM as a no-op, and loops forever; `createRealRunner(1000)` with a 1 s
  `AbortSignal.timeout` settles well under 10 s and `process.kill(pid, 0)` throws afterwards
  (`ESRCH`), proving the child was actually reaped by the SIGKILL escalation, not just that the
  promise resolved.

**3. ADR.** `docs/adr/0016-ffmpeg-chunker.md`: Decision §3 now states the protocol whitelist and
forced demuxer (replacing "probed by content... ffmpeg's own demuxer sniffing picks the
container"); Decision §5's timeout bullet now states the SIGTERM-then-SIGKILL grace escalation
(replacing "SIGTERM'd rather than hanging... indefinitely", which undersold that a single SIGTERM
alone does not guarantee the process exits); Consequences gained a new bullet naming ffmpeg's own
parser/memory-safety attack surface on untrusted media and the mitigations (non-root `USER node`,
the timeout-then-SIGKILL escalation, the output cap, the protocol whitelist and forced demuxer).
`python3 docs/adr/check-headings.py` stays green (heading order untouched).

Also folded `FFMPEG_SCOPE` into a single source of truth derived from `FFMPEG_INPUT_FORMAT`'s own
keys (`Object.keys(...)`), so the scope check and the forced-demuxer lookup can never disagree and
the lookup needs no dead `undefined` branch; added one more unit test (a runner that throws for a
reason other than the timeout, e.g. an `ENOENT`-shaped spawn failure) to keep branch coverage at
the same 80% bar the original Phase A handoff reported, after the new code added branches.

**Files touched:** `apps/worker/src/ingest/ffmpegChunker.ts`, `apps/worker/src/ingest/ffmpegChunker.test.ts`, `docs/adr/0016-ffmpeg-chunker.md`, this handoff. No file outside that list changed.

## Decisions

### 27 Oct 2026 · 11.4d ffmpeg chunker (ADR-0016) · decided by builder · risk: high
- Decided: `apps/worker`'s Docker image gains a new system binary (`ffmpeg`), a tech-stack change under rule 2. The ADR (`docs/adr/0016-ffmpeg-chunker.md`) is written and set to Status "Proposed", naming architect, security-reviewer and typescript-reviewer as the required reviewers.
- Why: the gap closed here (MP4/WebM/M4A recordings can't be split for Whisper's upload limit the way WAV/MP3 already are) needs a general audio decoder, which is out of scope for a hand-written parser; ffmpeg is the established tool and the plan's Lead answers (27 Oct 2026) already confirms this ADR's scope (Q1-Q5). This decision itself is not final until the architect, security-reviewer and typescript-reviewer review `review.md` and the lead approves — this entry records the builder's side (rule 2's requirement that an ADR exists before the code it governs ships), not that approval.

No other decision the plan didn't already make was needed in Phase A.

### 27 Oct 2026 · 11.4d approve ADR-0016 and merge · decided by lead · risk: high
- Decided: ADR-0016 (ffmpeg in the worker image, protocol whitelist `file`, forced demuxer from a fixed mime table, SIGTERM then SIGKILL on timeout) is Accepted and 11.4d merges. Fix round 1 closed the security CRITICAL, the architect HIGH and MEDIUM and the typescript HIGH; security-reviewer, architect and typescript-reviewer each re-verified and approved.
- Why: the chunker is what lets MP4, WebM and M4A recordings of any length be transcribed, and the fix round shuts the one real attack path (ffmpeg following HLS or concat references inside an upload). The remaining MEDIUM/LOW items are hardening, not blockers, and go to board task 11.4j.

### 27 Oct 2026 · 11.4d budget overrun accepted · decided by lead · risk: low
- Decided: accept 224 tool calls against the plan's 100 (Phase A 91, Phase B 44, fix round 89, by the harness count; the handoff's self-counts are lower).
- Why: the fix round had to prove the ffmpeg rejection against real ffmpeg and a real SIGTERM-ignoring child, which is where the overrun came from; the result is the security property the task needed. Future briefs that ask for real-process tests should budget for them.

## Gate

- `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...` — **green.** (First attempt hit two small lint errors — an unused `err` binding and a stray duplicate expression statement in the test file — fixed, then the full filtered run passed: 38/38 tasks successful, including `@edmate/db:test` at 99%+ coverage and `@edmate/worker:test`.)
- `apps/worker` `vitest run --coverage` (standalone, to read `ffmpegChunker.ts`'s own numbers): 461/461 tests passed. `src/ingest/ffmpegChunker.ts`: 86.51% statements, 80% branches, 91.66% functions, 88.23% lines — above the repo's 80% new-code bar. The few uncovered lines are the `spawn` constructor's synchronous-throw catch branch and one `fmt`-chunk edge in the local WAV reader, both defensive paths not exercised by the fake-runner tests.
- `python3 docs/adr/check-headings.py` — **green** (no output, exit 0).
- `corepack pnpm exec prettier --check` on `docs/adr/0016-ffmpeg-chunker.md`, `apps/worker/src/ingest/ffmpegChunker.ts`, `apps/worker/src/ingest/ffmpegChunker.test.ts` — **green** ("All matched files use Prettier code style!").
- `python3 .githooks/secret-scan.py --all` — **green.**

**Phase B:**
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...` — **green.** 38/38 tasks
  successful; `@edmate/worker:test` 462/462 tests passed; `src/ingest/gateway.ts` at 100%
  statements/branches/functions/lines.
- `python3 docs/adr/check-headings.py` — **green** (no output, exit 0; no change needed to the ADR
  in this phase).
- `corepack pnpm exec prettier --check` on `apps/worker/src/ingest/gateway.ts`,
  `apps/worker/src/ingest/gateway.test.ts` — one formatting fix applied to `gateway.test.ts`
  (`prettier --write`), then **green**. `apps/worker/Dockerfile` has no Prettier parser for
  Dockerfiles (expected; not a Prettier-covered file type).
- `python3 .githooks/secret-scan.py --all` — **green.**
- Docker image build: **not run** by this builder (builders never run `docker`/`docker compose`
  per the plan's Allowed tools). The lead or a human must run
  `docker build -f apps/worker/Dockerfile .` and check the ffmpeg licence banner (ADR-0016 Q3,
  tracked on follow-up 11.4i) before this ships in a deployed image.

**Fix round 1:**
- `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...` — **green.** 38/38
  tasks successful; `@edmate/worker:test` 468/468 tests passed (7 new: 3 protocol-whitelist argv
  cases, the SIGTERM-then-SIGKILL real-child test, 2 opt-in HLS/concat rejection tests, and one
  unit test for the pre-existing non-timeout throw path, all of which ran — not skipped — since
  ffmpeg is present on this machine); `src/ingest/ffmpegChunker.ts` 88.07% statements / 80%
  branches / 93.75% functions / 91.08% lines.
- `python3 docs/adr/check-headings.py` — **green** (no output, exit 0).
- `corepack pnpm exec prettier --check` on `docs/adr/0016-ffmpeg-chunker.md`,
  `apps/worker/src/ingest/ffmpegChunker.ts`, `apps/worker/src/ingest/ffmpegChunker.test.ts` —
  **green.**
- `python3 .githooks/secret-scan.py --all` — **green.**

## Budget

Phase A tool calls used: 72
Phase B tool calls used: 19
Fix tool calls used: 32
