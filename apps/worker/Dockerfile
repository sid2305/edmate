# Edmate worker image (task 0.2). Build from the repo root:
#   docker build -f apps/worker/Dockerfile .
# Stage 1 installs every dependency, builds with turbo, then `pnpm deploy` copies the worker with
# production dependencies only; a third stage builds an LGPL-only ffmpeg (ADR-0016); the last stage
# runs the compiled JavaScript as the `node` user.

FROM node:22.22.3-alpine3.22 AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Fetch packages from the lockfile alone so this layer is cached until the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm turbo run build --filter=@edmate/worker
RUN pnpm --filter=@edmate/worker deploy --prod --legacy /out

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
    FFMPEG_VERSION='7.1.5'; \
    FFMPEG_SHA256='de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f'; \
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
# `ffmpeg -L` wraps "GNU Lesser General Public" / "License" across two lines; join them first.
RUN set -eux; \
    ./ffmpeg -hide_banner -L | tr '\n' ' ' > /tmp/licence.txt; \
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

FROM node:22.22.3-alpine3.22 AS runtime
# The publish gate (task 8.7) reads locale packs, prompt packs and skill personas from content/ and
# the platform eval suites from evals/suites/; a missing dir ends a gate run `error`, never a pass.
ENV NODE_ENV=production \
    EDMATE_CONTENT_DIR=/app/content \
    EDMATE_EVAL_SUITES_DIR=/app/evals/suites
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /repo/content/locales ./content/locales
COPY --from=build --chown=node:node /repo/content/prompt-packs ./content/prompt-packs
COPY --from=build --chown=node:node /repo/content/skills ./content/skills
# ADR-0016 Decision 8 (task 11.4l): the LGPL-only ffmpeg built in the `ffmpeg` stage, with its
# licence texts. It runs as a separate process and is never linked into the app.
COPY --from=ffmpeg /src/ffmpeg/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /src/ffmpeg/COPYING.LGPLv2.1 /src/ffmpeg/LICENSE.md /usr/local/share/licenses/ffmpeg/
COPY --from=build --chown=node:node /repo/evals/suites ./evals/suites
USER node
CMD ["node", "dist/index.js"]
