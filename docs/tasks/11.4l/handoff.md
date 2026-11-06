# Handoff: 11.4l · Worker image builds its own LGPL-only ffmpeg (ADR-0016 Decision 8 fallback)

Status: DONE

Branch: `m13/11.4l-ffmpeg-lgpl-swap`

## What changed

- `apps/worker/src/ingest/ffmpegBuild.test.ts` (new): a static contract between the Dockerfile and
  the chunker. It has 6 tests, as specified in plan step 1. It drops comment lines first, then
  checks: no distro ffmpeg, the version and sha256 pin with `sha256sum -c` between `curl` and
  `tar -x`, LGPL-only configure flags, every component the chunker's real argv needs (captured from
  `createFfmpegChunker` with a fake runner for `audio/mp4`, `video/mp4` and `video/webm`), the
  image's own fail-closed licence check, and the two `COPY --from=ffmpeg` lines before `USER node`.
- `apps/worker/Dockerfile`: the new discarded `ffmpeg` stage, exactly the text in Design answer 3
  with the version and sha256 filled in. In `runtime`, `RUN apk add --no-cache ffmpeg` and its
  comment are replaced by the two `COPY --from=ffmpeg` lines. The header comment gains the clause
  "a third stage builds an LGPL-only ffmpeg (ADR-0016)". "Stage 2 runs …" now reads "the last stage
  runs …", because with three stages "stage 2" would be wrong.
- `docs/adr/0016-ffmpeg-chunker.md`: one Status line ("Amended 5 Nov 2026 (task 11.4l): Decision
  8's fallback taken.") and a dated amendment paragraph under Decision 8. No existing text was
  rewritten.
- `ffmpegChunker.ts` and `ffmpegChunker.test.ts` are unchanged.

## Red, then green

Red, against the unchanged Dockerfile
(`corepack pnpm --filter @edmate/worker exec vitest run src/ingest/ffmpegBuild.test.ts`):

```
× the runtime stage installs no distro ffmpeg
× ffmpeg is fetched at a pinned version over https and checked against a pinned sha256
× configure is LGPL-only with no external library
× the build enables every component the chunker's argv needs
× the image build fails closed on a GPL or incomplete ffmpeg
× runtime copies the built binary onto PATH with its licence
AssertionError: expected [ 'RUN apk add --no-cache ffmpeg' ] to deeply equal []
TypeError: .toMatch() expects to receive a string, but got undefined
AssertionError: expected [] to deeply equal ArrayContaining{…}
AssertionError: audio/mp4: demuxer mov: expected false to be true
AssertionError: expected '' to contain './ffmpeg -hide_banner -L'
AssertionError: expected -1 to be greater than -1
Tests  6 failed (6)
```

(My first red run had a bug in my own test: I read `err.kind` instead of `TranscriberError`'s
`code`. I fixed that before recording the red run above, so every failure is for the intended
reason.)

Green, after the Dockerfile edit: `Tests  6 passed (6)`.

## Pin evidence (taken outside docker, in a fresh `mktemp -d /tmp/ffmpeg-11.4l-XXXXXX`)

- Version: **7.1.5**. It is the newest `7.1.x` on https://ffmpeg.org/releases/ (the list has 7.1,
  7.1.2, 7.1.3, 7.1.4 and 7.1.5).
- sha256 of `ffmpeg-7.1.5.tar.xz`:
  **`de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f`**
- gpg, with a throwaway `GNUPGHOME`, after importing https://ffmpeg.org/ffmpeg-devel.asc:

  ```
  gpg: Signature made Sat Jun 20 02:28:16 2026 UTC
  gpg:                using RSA key FCF986EA15E6E293A5644F10B4322F04D67658D8
  gpg:                issuer "<the FFmpeg devel list address>"
  gpg: Good signature from "FFmpeg release signing key <the FFmpeg devel list address>" [unknown]
  Primary key fingerprint: FCF9 86EA 15E6 E293 A564  4F10 B432 2F04 D676 58D8
  ```

  (The key's public list address is replaced by a placeholder above, because the secret scan
  flags any email. gpg also printed the usual "not certified with a trusted signature" warning. That is expected
  with a fresh keyring. Trust comes from the fingerprint check below.)

- The fingerprint equals the plan's `FCF9 86EA 15E6 E293 A564 4F10 B432 2F04 D676 58D8`, and the
  one published on https://ffmpeg.org/download.html (`FCF986EA15E6E293A5644F10B4322F04D67658D8`).
- Nothing from the tarball was run. The download directory was deleted with `rm -rf` afterwards,
  and nothing from it is in the repo.

## Grep-only pre-check (hit counts in the extracted 7.1.5 sources)

| File | Name | Hits |
|---|---|---|
| `configure` | `disable-autodetect` | 1 |
| `configure` | `disable-network` | 1 |
| `configure` | `disable-avdevice` | 1 |
| `configure` | `disable-x86asm` | 3 |
| `configure` | `extra-ldexeflags` | 2 |
| `libavcodec/allcodecs.c` | `ff_aac_decoder`, `ff_opus_decoder`, `ff_vorbis_decoder`, `ff_mp3_decoder`, `ff_mp3float_decoder`, `ff_alac_decoder`, `ff_pcm_s16le_encoder` | 1 each |
| `libavcodec/parsers.c` | `ff_aac_parser`, `ff_opus_parser`, `ff_vorbis_parser`, `ff_mpegaudio_parser` | 1 each |
| `libavformat/allformats.c` | `ff_mov_demuxer`, `ff_matroska_demuxer`, `ff_segment_muxer`, `ff_wav_muxer` | 1 each |
| `libavformat/protocols.c` | `ff_file_protocol` | 1 |
| `libavfilter/allfilters.c` | `ff_af_aresample`, `ff_af_aformat`, `ff_af_anull` | 1 each |
| top level | `COPYING.LGPLv2.1`, `LICENSE.md` (the two files `runtime` copies) | present |

Every name was found.

What the `ffmpeg` CLI depends on (`configure` line 4054 onwards):

- `ffmpeg_deps="avcodec avfilter avformat threads"`. `threads` comes from pthreads. I checked that
  `--disable-autodetect` does not turn it off: the `if disabled autodetect` block (around line
  4466) only weak-disables `$EXTERNAL_AUTODETECT_LIBRARY_LIST` and
  `$HWACCEL_AUTODETECT_LIBRARY_LIST`, not `$THREADS_LIST`. The pthreads probe (line 6809) still
  runs, and musl provides pthreads. So the plan's assumption holds, from the source rather than a
  guess.
- `ffmpeg_select` force-enables `aformat`, `anull`, `atrim`, `crop`, `format`, `hflip`, `null`,
  `rotate`, `transpose`, `trim` and `vflip`. These are ffmpeg's own LGPL filters, which the CLI
  always pulls in, even with `--disable-everything`. They are not codecs or libraries, and they do
  not change the licence. The lead will see them in `ffmpeg -filters`, which is expected.
- The same `disable autodetect` block runs `disabled iconv || enable libc_iconv`. So configure may
  still use musl's own built-in iconv. That is part of libc, not an external library, and it adds
  no `--enable-lib…` to the configuration line.

## Expected `ffmpeg -version` configuration line

Expected; the lead pastes the actual line below after rebuilding:

```
configuration: --disable-everything --disable-autodetect --disable-network --disable-avdevice --disable-ffplay --disable-ffprobe --disable-doc --disable-debug --disable-x86asm --extra-ldexeflags=-static --enable-protocol=file --enable-demuxer=mov,matroska --enable-decoder=aac,opus,vorbis,mp3,mp3float,alac --enable-parser=aac,opus,vorbis,mpegaudio --enable-encoder=pcm_s16le --enable-muxer=segment,wav --enable-filter=aresample,aformat,anull
```

It has no `--enable-gpl`, `--enable-version3`, `--enable-nonfree` and no `--enable-lib…`. Line 1
should read `ffmpeg version 7.1.5`.

## Fix round 1 (lead's docker build plus typescript-reviewer)

Tests were changed first. Against the unfixed Dockerfile, the licence test went red
(`Tests 1 failed | 5 passed`). After the Dockerfile fix, all 6 passed.

- **HIGH, `apps/worker/Dockerfile:58`:** the licence check grepped `ffmpeg -L` output for "GNU
  Lesser General Public License". Real ffmpeg wraps that phrase across two lines ("…General
  Public" / "License…"), so a correct LGPL build failed the image build. The lead's docker build
  confirmed it. Fix: `./ffmpeg -hide_banner -L | tr '\n' ' ' > /tmp/licence.txt`, with a comment
  saying why. The GPL check below it is unchanged. Without `pipefail`, a failing `./ffmpeg` in the
  pipe leaves the file without the LGPL phrase, so the next `grep -q` still fails the build.
  `ffmpegBuild.test.ts:143` now asserts the joined form, so going back to the unjoined form fails
  the test, not only a later docker build.
- **MEDIUM, `ffmpegBuild.test.ts:100`:** the pin test used `indexOf('curl ')`, which matched the
  earlier `apk add … curl tar xz` line instead of the download. It now anchors on `curl -fsSL`.
  Mutation check: with the download `curl` line deleted from a temporary copy of the Dockerfile,
  the pin test fails. The Dockerfile was restored afterwards.
- **MEDIUM, `ffmpegBuild.test.ts:80-87`:** the "no distro ffmpeg" test read one physical line at
  a time, so it missed `apk add \` with `ffmpeg` on the next line. It now joins
  backslash-continued lines, takes each `apk add` command up to the next `;`, `&&` or `||`, and
  checks for the whole word `ffmpeg`. It also asserts that at least one `apk add` was found, so
  the check can't pass by matching nothing. Mutation check: adding `RUN apk add --no-cache \` /
  `ffmpeg` to `runtime` in a temporary copy makes the test fail.

## Lead verification

Docker build (worktree synced to `bf139afc`, the fix-round-1 commit): **succeeded**, including the
image's own licence-check `RUN` step (previously the step that failed on a correct LGPL build,
before the fix-round fix).

```
$ docker run --rm --entrypoint ffmpeg edmate-worker-check -version | head -3
ffmpeg version 7.1.5 Copyright (c) 2000-2026 the FFmpeg developers
built with gcc 14.2.0 (Alpine 14.2.0)
configuration: --disable-everything --disable-autodetect --disable-network --disable-avdevice --disable-ffplay --disable-ffprobe --disable-doc --disable-debug --disable-x86asm --extra-ldexeflags=-static --enable-protocol=file --enable-demuxer='mov,matroska' --enable-decoder='aac,opus,vorbis,mp3,mp3float,alac' --enable-parser='aac,opus,vorbis,mpegaudio' --enable-encoder=pcm_s16le --enable-muxer='segment,wav' --enable-filter='aresample,aformat,anull'
```

Matches the "Expected" block above exactly (ffmpeg quotes each `--enable-*` list's value; same
flags, same order, same content). No `--enable-gpl`, `--enable-nonfree`, `--enable-version3` or
`--enable-lib…`.

```
$ docker run --rm --entrypoint ffmpeg edmate-worker-check -hide_banner -L
... GNU Lesser General Public License ... version 2.1 of the License, or (at your option) any later version. ...
```
Names the GNU Lesser General Public License, version 2.1 or later. No GPL text.

```
$ docker run --rm --entrypoint sh edmate-worker-check -c 'apk info -e ffmpeg || echo "no apk ffmpeg"; ls /usr/local/share/licenses/ffmpeg'
no apk ffmpeg
COPYING.LGPLv2.1
LICENSE.md
```

Functional smoke (synthetic MP4+AAC and WebM+Opus, made in a throwaway alpine+ffmpeg container,
never committed; run against the built image with `--network none`):

| Fixture | Exit | Pieces | Wall time |
|---|---|---|---|
| `v.mp4` (h264+aac, 20s) | 0 | 5 | 0.42s |
| `v.webm` (vp8+opus, 20s) | 0 | 4 | 0.44s |

Both within the plan's "4 or 5 pieces, about a second or two". The video track was correctly
dropped by `-vn` (ffmpeg's own stream mapping log shows only the audio stream mapped to the
`pcm_s16le` output). All checks pass. **Verdict: APPROVE.**

## Decisions

### 5 Nov 2026 · 11.4l LGPL-only ffmpeg replaces the distro package · decided by lead · risk: high
Decided: The worker image builds FFmpeg 7.1.5 from the official source tarball, pinned by sha256 in `apps/worker/Dockerfile` (GPG-verified against FFmpeg's release key when pinned), configured LGPL 2.1+ only with an audio-only component set, in place of `apk add ffmpeg`.
Why: The lead's 5 Nov 2026 check showed the base image's apk ffmpeg 6.1.2-r2 is `--enable-gpl`, and ADR-0016 Decision 8 pre-authorizes this fallback. Reviewed by architect, security-reviewer and typescript-reviewer (opus); code-reviewer also ran. The lead rebuilt the image and independently re-checked the licence banner, the configuration line, the absence of any apk ffmpeg package, and a functional smoke test (synthetic MP4+AAC and WebM+Opus, offline) before merge — see `## Lead verification` above.
Alternatives: Keep the distro apk ffmpeg and accept the GPL exposure (rejected: ADR-0016 requires LGPL-only); use a prebuilt static binary (rejected below as D1).
Reversible: Yes, but not cost-free — reverting the Dockerfile stage and the ADR amendment restores the apk package, which is the GPL build the ADR rejects, not a clean rollback. The actual rollback the ADR names (Consequences, "Rollback") is removing the `chunker` option from `createWhisperTranscriber`'s call site, restoring the prior "refuse at upload" behaviour, with no contracts change either way.

### 5 Nov 2026 · 11.4l ffmpeg built from source in a discarded Docker stage (D1) · decided by planner · risk: medium
Decided: Build ffmpeg from the official source tarball in its own discarded Docker stage, rather than fetch a prebuilt static binary.
Why: The prebuilt sources available are GPL, glibc-linked, or have rolling (non-pinned) assets. A source build makes the exact `configuration:` line known before anything runs, so the LGPL-only guarantee can be checked mechanically.
Alternatives: A prebuilt static binary from a third-party mirror (rejected: licence and provenance can't be pinned the same way).
Reversible: Yes.

### 5 Nov 2026 · 11.4l pinned to the 7.1 release branch (D2) · decided by planner · risk: low
Decided: Pin to FFmpeg 7.1.5, the newest 7.1.x point release at the time of pinning.
Why: The 7.1 branch is maintained, and this task's flag set was checked against it, not against 8.x, which changed configure (e.g. removed libpostproc).
Alternatives: Track 8.x (rejected: this flag set has not been checked against it).
Reversible: Yes — a version and sha256 bump.

### 5 Nov 2026 · 11.4l decoder set limited to what the chunker needs (D3) · decided by planner · risk: low
Decided: Enable only the decoders aac, opus, vorbis, mp3, mp3float and alac.
Why: These are the audio codecs real uploads carry for the chunker's three supported MIME types (aac/alac in MP4 and M4A, opus/vorbis in WebM, mp3/mp3float as a broader-coverage addition); ac3/eac3/flac are left out, and an unsupported codec fails closed as a `validation` error rather than silently degrading.
Alternatives: Enable a broader codec set for headroom (rejected: widens the audit surface for no current use).
Reversible: Yes.

### 5 Nov 2026 · 11.4l `--disable-x86asm` (D4) · decided by planner · risk: low
Decided: Disable x86 assembly optimizations in the ffmpeg build, so no `nasm` build dependency is needed.
Why: Audio-only work in plain C still runs far faster than real time; the lead's smoke test (above) confirms this (0.42-0.44s for 20s inputs).
Alternatives: Keep x86asm enabled and add nasm to the build stage (rejected: unnecessary given the smoke-test timing).
Reversible: Yes.

### 5 Nov 2026 · 11.4l recorded as a dated ADR-0016 amendment, not a new ADR (D5) · decided by planner · risk: low
Decided: Record this fallback as a dated amendment to ADR-0016 (Decision 8), not a new ADR.
Why: ADR-0016 already pre-authorized this exact fallback in Decisions 7-9; amending it keeps the decision history in one place rather than splitting it across documents.
Alternatives: Write a new ADR (rejected: unnecessary, the decision was already pre-authorized).
Reversible: Yes.

## Gate

Commands: `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...`,
`python3 .githooks/secret-scan.py --all`, and `corepack pnpm exec prettier --check` on the new test,
this handoff and the ADR.

- `@edmate/worker` typecheck, lint and test: **green**. Tests: 41 files passed, 7 skipped. 465
  tests passed, 38 skipped. `ffmpegBuild.test.ts`: 6 passed. `ffmpegChunker.test.ts`: 28 tests, 4
  skipped, unchanged and green.
- The ffmpegChunker opt-in block (`describe.runIf(FFMPEG_PRESENT)`) **skipped**, because this
  host has no ffmpeg on `PATH`. That is fine per the plan.
- Secret scan: clean (exit 0). Prettier: all three files pass.
- Flakes in other packages (not touched by this task), each re-run once as the plan allows:
  - Run 1: `@edmate/config` `harness-purity.test.ts` "rejects drizzle-orm imported from
    packages/harness" timed out at 5000 ms. It passed on run 2.
  - Run 2: `@edmate/harness` `guardrails/chain.test.ts` (2000-chain property test, 25 s) and
    `pedagogy/modelRequest.test.ts` "runs in linear time on long hostile input" (23 s) failed.
    The machine was busy, with a load average of about 10 because other builders were running.
    Re-run alone, both files passed: 2 files, 164 tests.
  - Every other package task in the filter passed.

Fix round 1 gate: `turbo run typecheck lint test --filter=@edmate/worker...` passed all 38 tasks.
`ffmpegBuild.test.ts` passed 6 of 6. `ffmpegChunker.test.ts` passed unchanged (28 tests, 4
skipped, the opt-in block skipped because this host has no ffmpeg). The first attempt was cut off
by my own 10-minute shell limit while `@edmate/evals#test` was still running. At that point 37 of
38 tasks had passed and none had failed; the full rerun was green. After Prettier reformatted the
test file, the worker package was re-checked: 11 of 11 tasks passed. Secret scan and Prettier are
clean.

## Budget

Budget: 60 tool calls (1 phase)

Tool calls used: 55 (37 in round 1, 18 in fix round 1)
