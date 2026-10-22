# Edmate worker image (task 0.2). Build from the repo root:
#   docker build -f apps/worker/Dockerfile .
# Stage 1 installs every dependency, builds with turbo, then `pnpm deploy` copies the worker with
# production dependencies only; stage 2 runs the compiled JavaScript as the `node` user.

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
COPY --from=build --chown=node:node /repo/evals/suites ./evals/suites
USER node
CMD ["node", "dist/index.js"]
