# Plan: 11.4l · Worker image builds its own LGPL-only ffmpeg (ADR-0016 Decision 8 fallback)

## Task (board 11.4l)
B-62 finding (resolved 5 Nov 2026 by the lead): the pinned worker base image's apk ffmpeg
(6.1.2-r2) is built `--enable-gpl`. Per ADR-0016 Decision 8, swap `apps/worker/Dockerfile` to the
documented fallback: a pinned, checksum-verified LGPL-only ffmpeg static build with no GPL-only
codec enabled. Tech-stack change (rule 2).

## Acceptance (verbatim from the board)
> apps/worker/Dockerfile installs a pinned, checksum-verified ffmpeg build with no --enable-gpl
> codec; the handoff pastes the new build's `ffmpeg -version` configuration line showing no
> GPL-only codec enabled; @edmate/worker typecheck, lint and test (including the ffmpegChunker
> suite) stay green; the lead rebuilds the image once and re-checks the licence banner before merge.

How each part is shown:
| Acceptance part | Shown by | Who |
|---|---|---|
| Dockerfile installs a pinned, checksum-verified build, no `--enable-gpl` | The new `ffmpeg` stage (pinned version + literal sha256 + `sha256sum -c`), and the new `ffmpegBuild.test.ts`, which reads the Dockerfile and fails if the pin, the checksum step or the LGPL-only configure flags drift | builder |
| Handoff pastes the `ffmpeg -version` configuration line | For a build from source, ffmpeg's `configuration:` line is the configure arguments, verbatim. The builder pastes the **expected** line (copied from the Dockerfile). The lead adds the **actual** line from the rebuilt image under "Lead verification" before merge | builder (expected), lead (actual) |
| `@edmate/worker` typecheck, lint, test green, ffmpegChunker suite included | `corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...`. `ffmpegChunker.test.ts` is unchanged and must still pass | builder |
| Lead rebuilds the image and re-checks the licence banner | "Lead verification (review step only)" below | lead |

**The builder never runs `docker build`.** The builder's gate is the `@edmate/worker` typecheck,
lint and test plus the secret scan. Only the lead's review step proves that the image compiles and
shows an LGPL banner. A configure or compile error found there goes back to the builder as a fix
round.

## Authority (cite, don't re-litigate)
ADR-0016 Decision 8 already decided the fallback: "default to the distribution package unless that
check fails, with a documented fallback (a pinned, checksum-verified LGPL-only static build) if it
does". On 5 Nov 2026 the check failed: the lead built the image and found apk `ffmpeg 6.1.2-r2`
configured with `--enable-gpl`. No new ADR is needed. The builder adds a short dated
**amendment** to ADR-0016 (step 4). It records that the fallback was taken and which parts of
Decisions 7 and 9 it replaces. It is not a new decision. The lead may drop this step; doing so
does not change the reviewer set (see Risky paths).

## What the worker actually asks ffmpeg to do
Checked against `apps/worker/src/ingest/ffmpegChunker.ts`, lines 30-34 and 229-254. This is the
complete argv. Nothing else in `apps/worker/src/**` spawns ffmpeg, and nothing spawns ffprobe:
`ffprobe` appears nowhere in the repo.

| argv | ffmpeg component it needs |
|---|---|
| `-protocol_whitelist file`, input path, output pattern | protocol `file` |
| `-f mp4` (for `audio/mp4`, `video/mp4`) | demuxer `mov` (its name list is `mov,mp4,m4a,3gp,3g2,mj2`) |
| `-f webm` (for `video/webm`) | demuxer `matroska` (`matroska,webm`) |
| the audio stream inside those containers | audio **decoders** (see below) |
| `-vn` | none: the video stream is never decoded, so no video decoder is needed |
| `-ac 1 -ar 16000` | libswresample (on by default), plus filters `aresample`, `aformat` and `anull`, which the CLI's audio filtergraph inserts |
| `-c:a pcm_s16le` | encoder `pcm_s16le` |
| `-f segment -segment_format wav -segment_time N -reset_timestamps 1` | muxers `segment` and `wav` |
| `-nostdin -y` | CLI flags only |

Audio decoders. The chunker forces only the container. The codec is whatever the uploaded file
carries.
- **Required:** `aac` (MP4/M4A from phones, Zoom, OBS, Meet and Teams), `opus` (WebM from browser
  MediaRecorder, and Opus-in-MP4), `vorbis` (older WebM).
- **Also enabled (decision D3):** `mp3` and `mp3float` (MP3 audio inside MP4), and `alac` (Apple
  Lossless `.m4a`, e.g. an iPhone voice memo with lossless recording turned on). All are native
  LGPL decoders with no external library.
- **Deliberately not enabled:** `ac3`/`eac3`, `flac` and PCM-in-MOV. These are rare in teacher
  recordings. A file whose codec isn't enabled makes ffmpeg exit non-zero, and the chunker already
  maps that to the non-retryable `validation` error "the recording could not be read by the
  chunker" (ADR-0016 Decision 6). It fails closed, never silently. Adding a decoder later means
  one token in the Dockerfile and one in `ffmpegBuild.test.ts`, reviewed like this task.

Parsers `aac`, `opus`, `vorbis` and `mpegaudio` are enabled too. The demuxers use them when they
are present. They cost little and avoid probe warnings.

## Design answers (the four questions)

### 1. Which build to pin, and how its checksum is verified
**Choice: build FFmpeg from the official source release tarball, pinned by version and by a sha256
literal in the Dockerfile, in a discarded `ffmpeg` build stage on the same pinned Alpine base.**
The stage produces one statically linked `ffmpeg` binary. Only that binary and its licence texts
are copied into `runtime`.

Why not a prebuilt "static ffmpeg":
- johnvansickle.com static builds are configured `--enable-gpl` (libx264, libx265 and others). They
  fail the very check this task exists for.
- `mwader/static-ffmpeg` images are GPL for the same reason (x264/x265).
- BtbN/FFmpeg-Builds has `linux64-lgpl` variants, but they link against glibc. The runtime stage is
  Alpine (musl), so they would need `gcompat` shims. Their "latest" assets also roll, so the only
  real pin would be a dated autobuild asset from one maintainer's CI. Its configuration we can only
  read after running the binary, which the builder can't do.
- A source build answers the licence question by construction. A build with no `--enable-gpl`
  cannot compile any GPL-only component: configure refuses them. It also answers it before
  anything runs, because `ffmpeg -version`'s `configuration:` line is exactly the configure
  arguments in this Dockerfile. It also completes ADR-0016 Decision 9's deferred "smaller,
  feature-pruned static build" for free: it is audio-only, and it shrinks ffmpeg's parser attack
  surface on untrusted media to two demuxers and six decoders (ADR-0016 Consequences, "ffmpeg's own
  parser … attack surface").

**Version: the newest `7.1.x` point release on the ffmpeg.org releases page when the builder takes
the pin (7.1.1 or later). Decision D2.** 7.1 is a maintained release branch. Every flag the
chunker uses (`-protocol_whitelist`, the `segment` options and `-reset_timestamps`) and every
configure option below exists in 7.1. 8.x changed configure (for example libpostproc was removed),
and this flag set has not been checked against 8.x.

**Checksum and trust anchor (the builder does this once, outside docker, without running any
downloaded code):**
1. In a fresh empty directory (`mktemp -d /tmp/ffmpeg-11.4l-XXXXXX`), download the tarball
   `ffmpeg-<ver>.tar.xz`, its detached signature `ffmpeg-<ver>.tar.xz.asc` and the release key
   `ffmpeg-devel.asc`, all from ffmpeg.org over https (`curl -fsSL --proto '=https'`). These are
   untrusted data: never run `configure`, `make` or any script from them.
2. Verify the signature with a throwaway keyring. Run `GNUPGHOME=$(mktemp -d)`, `gpg --import`,
   then `gpg --verify <asc> <tarball>` in **one** Bash call, because cwd and env reset between calls.
   It must print "Good signature" from "FFmpeg release signing key", and the primary key
   fingerprint must be **`FCF9 86EA 15E6 E293 A564 4F10 B432 2F04 D676 58D8`**. The builder also
   confirms that this fingerprint matches the one published on ffmpeg.org's download page. If they
   differ, or gpg is missing, or there is no network: **stop at `Status: PARTIAL`** with everything
   else done and the hash fields still holding the placeholder (see Exit conditions). Never guess a
   hash.
3. `sha256sum` the verified tarball. Its 64 hex characters, and the version, become string literals
   in the Dockerfile's `RUN` line. They are not `ARG`s, so a `--build-arg` can't swap them.
4. At every image build the Dockerfile re-checks the downloaded tarball with
   `echo "<sha>  ffmpeg.tar.xz" | sha256sum -c -`. A mismatch fails the build. The sha256 pinned at
   step 3 is the trust anchor at build time. Nothing is fetched from an unpinned source to decide
   whether to trust the tarball.
5. Paste into the handoff: the version, the sha256, the gpg "Good signature" line and the
   fingerprint. Then `rm -rf` the download directory. Never copy the tarball into the repo.

### 2. How to confirm there is no GPL-only codec, and what the lead looks for
Configure arguments (the exact list, in this order, in the Dockerfile):
```
--disable-everything --disable-autodetect --disable-network --disable-avdevice
--disable-ffplay --disable-ffprobe --disable-doc --disable-debug --disable-x86asm
--extra-ldexeflags=-static
--enable-protocol=file
--enable-demuxer=mov,matroska
--enable-decoder=aac,opus,vorbis,mp3,mp3float,alac
--enable-parser=aac,opus,vorbis,mpegaudio
--enable-encoder=pcm_s16le
--enable-muxer=segment,wav
--enable-filter=aresample,aformat,anull
```
So the **expected `ffmpeg -version` line** (one line, with the arguments joined by single spaces) is:
```
configuration: --disable-everything --disable-autodetect --disable-network --disable-avdevice --disable-ffplay --disable-ffprobe --disable-doc --disable-debug --disable-x86asm --extra-ldexeflags=-static --enable-protocol=file --enable-demuxer=mov,matroska --enable-decoder=aac,opus,vorbis,mp3,mp3float,alac --enable-parser=aac,opus,vorbis,mpegaudio --enable-encoder=pcm_s16le --enable-muxer=segment,wav --enable-filter=aresample,aformat,anull
```
What the line must **not** contain: `--enable-gpl`, `--enable-version3` (which would make it LGPL
v3, not 2.1+), `--enable-nonfree` (which would make it unredistributable), or any `--enable-lib…`.
No external codec library at all means no libx264, libx265, libvpx, libxvid, libfdk-aac and so on.
`ffmpeg -L` must say "GNU **Lesser** General Public License … version 2.1 of the License, or (at
your option) any later version", and must not contain the string "GNU General Public License".

The image build enforces all of this itself and fails closed: see the `RUN` check in step 3. A
later edit that adds `--enable-gpl`, or drops a component the chunker needs, fails `docker build`,
and `ffmpegBuild.test.ts` fails CI before that.

Notes on the flags:
- `--disable-autodetect` keeps the build deterministic and dependency-free. With it, ffmpeg cannot
  quietly pick up zlib or iconv from the build stage. As a side effect, zlib-compressed MP4 `cmov`
  atoms and zlib-compressed Matroska tracks are unsupported. They are rare and fail closed as
  `validation`.
- `--disable-network` removes every network protocol from the binary. That is defence in depth
  under the chunker's `-protocol_whitelist file`.
- `--disable-x86asm` avoids needing `nasm` (decision D4). Audio decode and 16 kHz resampling in
  plain C still run far faster than real time. The lead's smoke step (below) times one 20 s clip,
  and the 10-minute chunker timeout (ADR-0016 Decision 5) is unchanged. The option is accepted and
  ignored on arm64 hosts.
- `--extra-ldexeflags=-static` links the `ffmpeg` executable fully static against musl, so the
  binary needs no shared library in `runtime`.

### 3. The minimal Dockerfile diff
- **New stage `ffmpeg`**, placed between `build` and `runtime`, `FROM node:22.22.3-alpine3.22`. It
  reuses the already-pinned base, so no new base image pin is introduced, it is already cached, and
  musl matches `runtime`. Build-only tools (`build-base curl tar xz`) are installed **only in this
  stage**. The stage is discarded, so none of them reach the runtime image, and no "remove
  afterwards" step is needed.
- **`runtime` stage:** the `RUN apk add --no-cache ffmpeg` line and its comment (current lines
  34-38) are **removed** and replaced by two `COPY --from=ffmpeg` lines in the same place, before
  `USER node`. `/usr/local/bin` is on `PATH` in the node image, so the chunker's default
  `ffmpegPath: 'ffmpeg'` resolves unchanged. The binary is root-owned and mode 755: user `node` can
  run it but not change it, the same as the apk binary was.
- The `base` and `build` stages are unchanged. `.dockerignore` is unaffected (the new stage copies
  nothing from the build context). `docker/compose.yaml` and
  `docker/compose.production-egress.example.yaml` build from this Dockerfile unchanged. The first
  `up --build` compiles ffmpeg once (a few minutes on the VM) and caches it afterwards.

The exact text the builder writes (fill in `<VER>` and `<SHA256>` from step 1). Shell detail:
under `set -e`, a command negated with `!` never stops the build, so every "must not" check is
written as `if …; then exit 1; fi`, never `! grep`.
```dockerfile
# ffmpeg for the worker's chunker (ADR-0016 Decision 8, task 11.4l). The base image's apk ffmpeg
# is built with GPL enabled (checked 5 Nov 2026), so the worker builds its own from the official
# FFmpeg source release, pinned by version and sha256 (GPG-verified when the pin was taken). It is
# configured LGPL 2.1+ only (no gpl, version3 or nonfree option, no external library) with just
# what src/ingest/ffmpegChunker.ts invokes. This stage is discarded; only the binary and its
# licence texts reach `runtime`. src/ingest/ffmpegBuild.test.ts pins these flags.
FROM node:22.22.3-alpine3.22 AS ffmpeg
RUN apk add --no-cache build-base curl tar xz
WORKDIR /src
RUN set -eux; \
    FFMPEG_VERSION='<VER>'; \
    FFMPEG_SHA256='<SHA256>'; \
    curl -fsSL --proto '=https' --tlsv1.2 -o ffmpeg.tar.xz \
      "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"; \
    echo "${FFMPEG_SHA256}  ffmpeg.tar.xz" | sha256sum -c -; \
    tar -xJf ffmpeg.tar.xz; \
    mv "ffmpeg-${FFMPEG_VERSION}" ffmpeg; \
    rm ffmpeg.tar.xz
WORKDIR /src/ffmpeg
RUN set -eux; \
    ./configure \
      --disable-everything --disable-autodetect --disable-network --disable-avdevice \
      --disable-ffplay --disable-ffprobe --disable-doc --disable-debug --disable-x86asm \
      --extra-ldexeflags=-static \
      --enable-protocol=file \
      --enable-demuxer=mov,matroska \
      --enable-decoder=aac,opus,vorbis,mp3,mp3float,alac \
      --enable-parser=aac,opus,vorbis,mpegaudio \
      --enable-encoder=pcm_s16le \
      --enable-muxer=segment,wav \
      --enable-filter=aresample,aformat,anull; \
    make -j"$(nproc)"
# Fail the image build unless the binary is LGPL 2.1+ and has every component the chunker uses.
RUN set -eux; \
    ./ffmpeg -hide_banner -L > /tmp/licence.txt; \
    grep -q 'GNU Lesser General Public License' /tmp/licence.txt; \
    if grep -q 'GNU General Public License' /tmp/licence.txt; then echo 'ffmpeg is GPL' >&2; exit 1; fi; \
    ./ffmpeg -version | grep '^configuration:' > /tmp/conf.txt; \
    if grep -Eq -e '--enable-(gpl|nonfree|version3|lib)' /tmp/conf.txt; then echo 'ffmpeg is not LGPL-only' >&2; exit 1; fi; \
    ./ffmpeg -hide_banner -decoders | awk '{print $2}' > /tmp/decoders.txt; \
    for c in aac opus vorbis mp3 mp3float alac; do grep -qx "$c" /tmp/decoders.txt; done; \
    ./ffmpeg -hide_banner -demuxers | awk '{print $2}' > /tmp/demuxers.txt; \
    grep -qx 'mov,mp4,m4a,3gp,3g2,mj2' /tmp/demuxers.txt; \
    grep -qx 'matroska,webm' /tmp/demuxers.txt; \
    ./ffmpeg -hide_banner -muxers | awk '{print $2}' > /tmp/muxers.txt; \
    grep -qx segment /tmp/muxers.txt; \
    grep -qx wav /tmp/muxers.txt; \
    ./ffmpeg -hide_banner -encoders | awk '{print $2}' | grep -qx pcm_s16le
```
And in `runtime`, replacing lines 34-38:
```dockerfile
# ADR-0016 Decision 8 (task 11.4l): the LGPL-only ffmpeg built in the `ffmpeg` stage, with its
# licence texts. It runs as a separate process and is never linked into the app.
COPY --from=ffmpeg /src/ffmpeg/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /src/ffmpeg/COPYING.LGPLv2.1 /src/ffmpeg/LICENSE.md /usr/local/share/licenses/ffmpeg/
```
The two licence files ship next to the binary (LGPL 2.1 §4/§6: the licence text travels with the
object code). The corresponding source is the pinned upstream tarball, named by version and sha256
in this public repo's Dockerfile.

**Grep-only pre-check by the builder (to de-risk the lead's build without docker or running
anything).** In the extracted download directory, `grep` the untrusted sources for every name the
configure line uses, and paste the hit counts into the handoff:
- `configure`: the strings `disable-autodetect`, `disable-network`, `disable-avdevice`,
  `disable-x86asm` and `extra-ldexeflags`. Also read its `ffmpeg_deps=` / `ffmpeg_select=` lines and
  note whether the CLI depends on anything not enabled here. `threads` comes from musl pthreads,
  which `--disable-autodetect` does not turn off. If `ffmpeg_deps` names something that looks
  disabled, say so in the handoff rather than guess.
- `libavcodec/allcodecs.c`: `ff_aac_decoder`, `ff_opus_decoder`, `ff_vorbis_decoder`,
  `ff_mp3_decoder`, `ff_mp3float_decoder`, `ff_alac_decoder`, `ff_pcm_s16le_encoder`.
- `libavcodec/parsers.c`: `ff_aac_parser`, `ff_opus_parser`, `ff_vorbis_parser`,
  `ff_mpegaudio_parser`.
- `libavformat/allformats.c`: `ff_mov_demuxer`, `ff_matroska_demuxer`, `ff_segment_muxer`,
  `ff_wav_muxer`. `libavformat/protocols.c`: `ff_file_protocol`.
- `libavfilter/allfilters.c`: `ff_af_aresample`, `ff_af_aformat`, `ff_af_anull`.

If any name is missing, the configure line would fail or silently drop a component. **Stop at
PARTIAL** and report it; don't improvise flags.

### 4. Do the existing ffmpegChunker tests change? No. Confirmed, not assumed.
`apps/worker/src/ingest/ffmpegChunker.test.ts` has two kinds of tests:
- **Unit blocks** (argv, protocol whitelist and forced demuxer, scope, failure paths, wav bounds,
  drain, SIGTERM/SIGKILL, happy path). All use an injected fake `ProcessRunner` and never run a real
  ffmpeg, so they don't depend on which binary ships.
- **The opt-in block** `describe.runIf(FFMPEG_PRESENT)` (line 485). It uses whatever `ffmpeg` is on
  the **host's** `PATH`, never the image's. Its fixture generator runs `-f lavfi -i sine=…` and
  `-c:a aac`, an input device, a source filter and an AAC **encoder** that the pruned image binary
  deliberately lacks. So this block cannot, and must not, be pointed at the image binary. It keeps
  running unchanged wherever a host ffmpeg exists.

`ffmpegChunker.ts` is not modified. Every flag in its argv maps to a component this build enables
(table above). So the CLI surface the chunker uses is the same, and no code change is needed.
Proving that the pruned binary really decodes MP4/AAC and WebM/Opus to WAV pieces is the lead's
smoke step below, because it needs the built image.

## Files
Create:
- `apps/worker/src/ingest/ffmpegBuild.test.ts`: a static contract test between the Dockerfile and
  the chunker (tests first, below).

Modify:
- `apps/worker/Dockerfile`: the new `ffmpeg` stage, and the apk line in `runtime` replaced by the
  two `COPY` lines. The header comment (lines 1-4) gains one clause: "a third stage builds an
  LGPL-only ffmpeg (ADR-0016)".
- `docs/adr/0016-ffmpeg-chunker.md`: a dated amendment only (step 4). No existing sentence is
  rewritten.
- `docs/tasks/11.4l/handoff.md` (new, the builder's handoff).

Out of bounds (stop at PARTIAL if any needs a change):
- `apps/worker/src/ingest/ffmpegChunker.ts` and `ffmpegChunker.test.ts` (both unchanged; see Q4)
- `packages/**` (including `packages/gateway`'s chunking or whisper code), `apps/web/**`,
  `docker/**`, `.github/**`, `.claude/**`, `.githooks/**`, `.dockerignore`, `pnpm-lock.yaml`, every
  `package.json`
- Any other ADR, and `docs/board/tasks.yaml` (the lead owns it)

## Steps (tests first)

1. **Red: write `apps/worker/src/ingest/ffmpegBuild.test.ts` against the unchanged Dockerfile.**
   - Read the Dockerfile with
     `readFileSync(fileURLToPath(new URL('../../Dockerfile', import.meta.url)), 'utf8')`.
     **Drop every line whose first non-blank character is `#` before any check.** The comments
     mention `--enable-gpl` on purpose, and must not trip or satisfy a check.
   - Cut out the `FROM … AS ffmpeg` stage (up to the next `FROM`) and the `AS runtime` stage. Parse
     the configure flags from the `./configure` invocation (the text up to `make -j`) into tokens
     `--name` or `--name=value`, with continuation backslashes and `;` removed. Build sets:
     enabled `protocol`, `demuxer`, `decoder`, `parser`, `encoder`, `muxer` and `filter` (split
     values on `,`).
   - Tests (one `it` each, plain names):
     1. "the runtime stage installs no distro ffmpeg": no `apk add` line anywhere matches
        `/\bffmpeg\b/`.
     2. "ffmpeg is fetched at a pinned version over https and checked against a pinned sha256":
        `FFMPEG_VERSION='7.1.N'` matches `/^7\.1\.\d+$/`. `FFMPEG_SHA256='…'` matches
        `/^[0-9a-f]{64}$/` and is not one repeated character (no placeholder). The URL is
        `https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz`. `sha256sum -c` appears
        **after** the `curl` and **before** `tar -x` within that `RUN`.
     3. "configure is LGPL-only with no external library": the tokens include
        `--disable-everything`, `--disable-autodetect` and `--disable-network`. No token matches
        `/^--enable-(gpl|nonfree|version3|lib)/`.
     4. "the build enables every component the chunker's argv needs": for each of `audio/mp4`,
        `video/mp4` and `video/webm`, call `createFfmpegChunker({ run })` with a fake runner that
        records `args` and returns `{ code: 1 }`, and swallow the expected `validation` rejection.
        From the captured argv, take the `-f` value **before** `-i` and map it through a local table
        `{ mp4: 'mov', webm: 'matroska' }`. An unmapped value fails with a message saying to add it
        to the Dockerfile and to this table. Assert that it is in `demuxer`. Also assert that the
        `-c:a` value is in `encoder`, the `-f` value after `-i` and the `-segment_format` value are
        in `muxer`, the `-protocol_whitelist` value is in `protocol`, `aac`, `opus` and `vorbis`
        are in `decoder`, and `aresample` is in `filter`.
     5. "the image build fails closed on a GPL or incomplete ffmpeg": the `ffmpeg` stage contains a
        `RUN` with `-L`, `GNU Lesser General Public License`, and an `if grep -Eq` over
        `--enable-(gpl|nonfree|version3|lib)` that `exit 1`s. It must **not** contain a line that
        starts its check with `! grep` (the `set -e` pitfall).
     6. "runtime copies the built binary onto PATH with its licence": `runtime` has
        `COPY --from=ffmpeg` to `/usr/local/bin/ffmpeg` and one copying `COPYING.LGPLv2.1`. Both
        appear before `USER node`.
   - Run `corepack pnpm --filter @edmate/worker exec vitest run src/ingest/ffmpegBuild.test.ts`.
     Tests 1, 2, 3, 5 and 6 must be **red**, and 4 too, because there is no `ffmpeg` stage yet.
     Record the red output summary for the handoff.
   - Keep helpers small: one `stage(name)`, one `configureTokens()`, one `enabled(kind)`. No
     function longer than about 40 lines. Use `node:fs`, `node:url` and the package's existing
     vitest only. No new dependency.
2. **Pin the source (outside docker).** Follow "Checksum and trust anchor" steps 1-3 and the
   grep-only pre-check. Write the version and sha256 down for step 3.
3. **Green: edit `apps/worker/Dockerfile`** to the exact text in Design answer 3, with `<VER>` and
   `<SHA256>` filled in. Re-run the new test file until green. Then run the whole gate (below).
4. **ADR-0016 amendment.** Under Decision 8, add a paragraph headed "Amendment (5 Nov 2026, task
   11.4l)". It says, plainly: the check failed (apk `ffmpeg 6.1.2-r2` in the pinned base was built
   `--enable-gpl`); the fallback is taken; the worker now builds FFmpeg `<VER>` from the official
   source tarball, pinned by sha256 and GPG-verified when pinned, LGPL 2.1+, with the audio-only
   component set; Decision 7's `apk add` line and Decision 9's image-size note are replaced by this;
   any audio codec outside the enabled list fails closed as `validation`, and adding one changes
   the Dockerfile and `ffmpegBuild.test.ts`, reviewed like this task. Add one line to Status:
   "Amended 5 Nov 2026 (task 11.4l): Decision 8's fallback taken." Keep it plain and short. Rewrite
   no other text.
5. **Handoff** `docs/tasks/11.4l/handoff.md` must include: the red/green evidence; the version,
   sha256, the gpg "Good signature" line and the fingerprint; the grep pre-check hit counts; the
   **expected** configuration line (copied from the Dockerfile, labelled "expected; the lead pastes
   the actual line below after rebuilding"); an empty `## Lead verification` section for the lead;
   `## Decisions` (D1-D5 below, plus the risk: high entry); `## Gate`; and
   `## Budget` / `Tool calls used: N`.

## Gate (builder)
```bash
source ~/.nvm/nvm.sh && corepack pnpm turbo run typecheck lint test --filter=@edmate/worker...
python3 .githooks/secret-scan.py --all
```
Also run `corepack pnpm exec prettier --check apps/worker/src/ingest/ffmpegBuild.test.ts
docs/tasks/11.4l/handoff.md docs/adr/0016-ffmpeg-chunker.md` (Prettier has no Dockerfile parser,
as 11.4d noted). The ffmpegChunker suite must stay green with zero changes. If the host has ffmpeg,
its opt-in block runs; if not, it skips. Either is fine. Say which in the handoff. An unrelated
flake in another package (for example the known real-clock ones) is re-run once and noted, as in
11.4i.

## Lead verification (review step only; never in the builder's gate)
On the VM, from the PR branch:
```bash
docker build -f apps/worker/Dockerfile -t edmate-worker-check .
docker run --rm --entrypoint ffmpeg edmate-worker-check -version | head -3
docker run --rm --entrypoint ffmpeg edmate-worker-check -hide_banner -L
docker run --rm --entrypoint sh edmate-worker-check -c 'apk info -e ffmpeg || echo "no apk ffmpeg"; ls /usr/local/share/licenses/ffmpeg'
```
Pass when:
- The build succeeds. Its own `RUN` check already failed closed on a GPL or incomplete binary.
- Line 1 is `ffmpeg version <VER>`.
- The `configuration:` line equals the handoff's expected line, with no `--enable-gpl`,
  `--enable-nonfree`, `--enable-version3` or `--enable-lib…`.
- `-L` names the GNU Lesser General Public License, version 2.1 or later.
- The apk check prints "no apk ffmpeg", and both licence files are listed.

Paste the actual `configuration:` line into the handoff's `## Lead verification` section.

Functional smoke: proves the pruned binary decodes what real uploads carry, including a **video**
track it must skip with `-vn`. Make the fixtures with any ffmpeg on the host or in a throwaway
container. They are synthetic and never committed:
```bash
F=$(mktemp -d); O=$(mktemp -d); chmod 0777 "$O"
ffmpeg -f lavfi -i testsrc=size=320x240:rate=10 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 20 -c:v libx264 -c:a aac -shortest "$F/v.mp4"
ffmpeg -f lavfi -i testsrc=size=320x240:rate=10 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 20 -c:v libvpx -c:a libopus -shortest "$F/v.webm"
for f in mp4:v.mp4 webm:v.webm; do fmt=${f%%:*}; in=${f#*:}; rm -f "$O"/*; \
  time docker run --rm --network none -v "$F":/w:ro -v "$O":/out --entrypoint ffmpeg edmate-worker-check \
    -nostdin -y -protocol_whitelist file -f "$fmt" -i "/w/$in" -vn -ac 1 -ar 16000 -c:a pcm_s16le \
    -f segment -segment_time 5 -segment_format wav -reset_timestamps 1 /out/piece-%03d.wav; \
  echo "exit=$? pieces=$(ls "$O" | wc -l)"; done
```
Pass when both runs exit 0 with 4 or 5 pieces each, in about a second or two. Optionally, an
`.m4a` (`-vn -c:a aac`) and an Opus-in-MP4 behave the same.

If the build or the smoke fails, it goes back to the builder as a fix round with the error text.
That most likely means a configure-name problem, which the grep pre-check is there to prevent.

## Risky paths touched (checked against `.claude/skills/merge-gate/risk-paths.txt`)
- `apps/worker/Dockerfile`: no match. Rule 2 still applies (tech-stack change), so it is reviewed
  by architect, security-reviewer and an opus typescript-reviewer, per the lead's brief.
- `apps/worker/src/ingest/ffmpegBuild.test.ts`: no match (the only worker glob is
  `apps/worker/src/alerts/**`).
- `docs/adr/0016-ffmpeg-chunker.md`: **matches `docs/adr/**`**. Group reviewers: `architect,
  security-reviewer, typescript-reviewer`. This is the same set rule 2 already requires here.
- `docs/tasks/11.4l/*`: no match.
- Safety prefixes (`packages/harness/src/guardrails/**`, `content/**`, `evals/suites/safety|locked/**`,
  `apps/worker/src/alerts/**`): none touched.

Required in `review.md`: **architect, security-reviewer, typescript-reviewer (opus), code-reviewer**.
The handoff's `## Decisions` must carry the `risk: high` entry below. The lead approves at merge.

## Decisions to log in the handoff
- **11.4l LGPL-only ffmpeg replaces the distro package (lead, risk: high).** Decided: the worker
  image builds FFmpeg `<VER>` from the official source tarball, pinned by sha256 in
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

## Open questions
None blocking. Design questions 1-4 are answered above. The lead may veto step 4 (the ADR
amendment). Dropping it removes `docs/adr/**` from the touched paths but does not change the
reviewer set.

## Budget
Budget: 60 tool calls (1 phase(s), @edmate/worker)

One phase. One Dockerfile, one new test file, one ADR paragraph and one handoff, all in one
package. The sizing rule's split thresholds (more than about 8 source files, 2 or more packages, 2
or more guards or adapters) are not reached.

## Allowed tools
Read, Grep, Glob, Edit, Write, and Bash for only these:
- `curl` to ffmpeg.org, for only the releases listing, the tarball, its `.asc` and `ffmpeg-devel.asc`;
- `gpg` with a throwaway `GNUPGHOME`, `sha256sum`, and `tar`/`grep` inside the fresh download
  directory (extract and grep only; never run `configure`, `make` or any file from the tarball);
- the pnpm gate commands and the secret scan;
- `rm -rf` of the download directory at the end.

**No `docker`, `docker compose` or `make`**, and no host build of ffmpeg.

## Exit conditions
- **`Status: DONE`** when all of these hold:
  - The new test file was red and then went green.
  - The Dockerfile matches Design answer 3, with a real GPG-verified version and sha256.
  - The grep pre-check found every component name.
  - The ADR amendment is written.
  - The `@edmate/worker` gate and the secret scan are green.
  - The handoff has the expected configuration line, the pin evidence and the decisions.

  The lead's image rebuild is not part of DONE. It happens at review.
- **`Status: PARTIAL`, then stop and report** if any of these happen:
  - There is no network or gpg, or the signature or fingerprint check fails or doesn't match the
    plan. Leave `<SHA256>` unfilled. Never commit a guessed or unverified hash.
  - The grep pre-check can't find a component or configure option name.
  - Any out-of-bounds file (including `ffmpegChunker.ts` or its test) seems to need a change.
  - The gate is red for a reason in this task's files after two fix attempts.
  - The builder is past about 55 tool calls.
