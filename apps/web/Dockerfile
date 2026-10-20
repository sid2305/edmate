# Edmate web app image (task 0.2). Build from the repo root:
#   docker build -f apps/web/Dockerfile .
# Stage 1 installs every dependency (dev deps are needed to build) and builds with turbo;
# stage 2 runs Next.js's standalone server only, as the unprivileged `node` user.

FROM node:22.22.3-alpine3.22 AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Fetch packages from the lockfile alone so this layer is cached until the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm turbo run build --filter=@edmate/web

FROM node:22.22.3-alpine3.22 AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    EDMATE_CONTENT_DIR=/app/content
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
# The age gate (1.7) reads the locale packs and privacy notices at run time.
COPY --from=build --chown=node:node /repo/content/locales ./content/locales
COPY --from=build --chown=node:node /repo/content/legal ./content/legal
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
