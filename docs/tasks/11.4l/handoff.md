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

## Lead verification

<!-- The lead fills this in after `docker build` and the checks in the plan's "Lead verification". -->

## Decisions

- **11.4l LGPL-only ffmpeg replaces the distro package (lead, risk: high).** Decided: the worker
  image builds FFmpeg 7.1.5 from the official source tarball, pinned by sha256 in
  `apps/worker/Dockerfile` (GPG-verified against FFmpeg's release key when pinned), configured LGPL
  2.1+ only with an audio-only component set, in place of `apk add ffmpeg`. Why: the lead's 5 Nov
  2026 check showed the base image's apk ffmpeg 6.1.2-r2 is `--enable-gpl`, and ADR-0016 Decision
  8 pre-authorizes this fallback. Reviewed by architect, security-reviewer, typescript-reviewer.
  The lead re-checked the licence banner on a rebuilt image before merge.
- D1 (risk: medium): a source build in a discarded stage rather than a prebuilt static binary. The
  prebuilt sources are GPL, glibc-linked, or have rolling assets. A source build makes the
  configuration line known before anything runs.
- D2 (risk: low): the 7.1 release branch, newest point release when pinned. It is maintained, and
  this flag set was checked against it, not against 8.x.
- D3 (risk: low): decoders aac, opus and vorbis, plus mp3/mp3float and alac. ac3/eac3/flac are left
  out, and an unsupported codec fails closed as `validation`.
- D4 (risk: low): `--disable-x86asm`, so no `nasm` is needed. Audio-only work is far faster than
  real time in plain C, and the lead's smoke times it.
- D5 (risk: low): a dated amendment to ADR-0016 rather than a new ADR. It records that the fallback
  was taken and what it replaces in Decisions 7 and 9.

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

## Budget

Budget: 60 tool calls (1 phase)

Tool calls used: 37
