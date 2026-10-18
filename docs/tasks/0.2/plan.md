# Implementation Plan: Task 0.2 – Docker Compose Setup

## Acceptance Criteria (verbatim from board)
- `docker compose up` serves `/api/health` = 200
- A test file round-trips through MinIO

## Overview
Set up a complete Docker Compose environment with all infrastructure: PostgreSQL 16 + pgvector, Redis, MinIO (S3-compatible), Caddy reverse proxy, the Next.js web app, and the BullMQ worker. This enables local development and demonstrates the deployable architecture before the harness is built.

## Requirements
1. **Services:** PostgreSQL 16 with pgvector extension, Redis, MinIO, Caddy, web (Next.js), worker (Node.js)
2. **Configuration:** Docker Compose orchestration with named volumes for data persistence
3. **Environment:** env.example with placeholder values (no real secrets, per CLAUDE.md non-negotiable rule 5)
4. **Dockerfiles:** Web and worker apps containerized with Node 22, strict tsconfig, production-ready
5. **Health check:** Caddy routes `/api/health` from the web app; curl returns 200
6. **MinIO test:** A script or test file in `apps/worker/src/test-minio.ts` that uploads and downloads a test file, verifying S3-compatible storage works end-to-end
7. **Volumes:** `docker/data/postgres/`, `docker/data/redis/`, `docker/data/minio/` (all gitignored, created on first run)

## Architecture Changes

### New Files
| File | Purpose |
| --- | --- |
| `docker/compose.yaml` | Docker Compose config: all 6 services, named volumes, port mappings, health checks, env source |
| `docker/Caddyfile` | Reverse proxy config: port 80 → 3000 (web), `caddy reload` on changes; routes `/api/health`, `/api/`, `/uploads/` (MinIO presigned URLs) |
| `docker/env.example` | Template with all keys needed: `NODE_ENV`, `DATABASE_URL`, `REDIS_URL`, `MINIO_*`, `JWT_SECRET` (placeholder: "dev-key-not-a-secret") |
| `apps/web/Dockerfile` | Multi-stage build: Node 22 Alpine, `corepack pnpm install --prod`, `pnpm build`, `node -e "require('next/dist/server')"` (start command; will be overridden by compose) |
| `apps/worker/Dockerfile` | Multi-stage build: Node 22 Alpine, `corepack pnpm install --prod`, runs compiled dist/index.js |
| `apps/worker/src/test-minio.ts` | Acceptance test: imports MinIO client, creates a bucket, uploads `test-file.txt`, downloads and verifies content, deletes, exits 0 on success |

### Files Out of Bounds
- `packages/contracts`, `packages/harness`, `packages/db` (data layer not yet built; Dockerfiles do not import them)
- `apps/web` code (except Dockerfile; /api/health already exists from 0.1)
- `.env` files (blocked by CLAUDE.md hooks and secret scan)
- `docker-compose.override.yml` (teams can create it locally if needed, not committed)

## Implementation Steps

### Phase 1: Configuration and Infrastructure
1. **Create `docker/env.example`** (File: `docker/env.example`)
   - Action: Add all keys with safe placeholders (DATABASE_URL=postgres://postgres:postgres@postgres:5432/edmate, MINIO_ROOT_USER=minioadmin, etc.)
   - Why: Teams copy it to `.env` (which is gitignored); no real secrets in the repo
   - Dependencies: None
   - Risk: Low

2. **Create `docker/compose.yaml`** (File: `docker/compose.yaml`)
   - Action: Define 6 services with pinned image versions (postgres:16-alpine, redis:7-alpine, minio:latest, caddy:2-alpine, web, worker)
   - Postgres: POSTGRES_USER=postgres, POSTGRES_PASSWORD=postgres (dev), pgvector via `psql ... CREATE EXTENSION`; health check `pg_isready`
   - Redis: health check `redis-cli ping`, volume `docker/data/redis/`
   - MinIO: MINIO_ROOT_USER/PASSWORD from env, volume `docker/data/minio/`, expose 9000 (API) and 9001 (console)
   - Caddy: reads Caddyfile, volume bind, expose 80; depends_on web (service_healthy)
   - Web: build from apps/web/Dockerfile, ports 3000:3000, env_file .env, depends_on postgres, redis, minio
   - Worker: build from apps/worker/Dockerfile, env_file .env, depends_on postgres, redis
   - Why: Compose is the required deployment target; pinned versions ensure reproducibility; health checks enable orchestration
   - Dependencies: None
   - Risk: Medium (must correctly wire all services; test locally)

3. **Create `docker/Caddyfile`** (File: `docker/Caddyfile`)
   - Action: Simple config: `:80 { reverse_proxy web:3000 }` (or per-route if needed for S3 presigned URLs later)
   - Why: Single entry point on port 80; web app runs on 3000 inside the container
   - Dependencies: None
   - Risk: Low

### Phase 2: Dockerfiles
4. **Create `apps/web/Dockerfile`** (File: `apps/web/Dockerfile`)
   - Action: Multi-stage: FROM node:22-alpine → corepack enable → corepack pnpm install --prod → corepack pnpm build → EXPOSE 3000 → CMD ["node", "-e", "require('next/dist/server/lib/start-server').default()"]
   - Why: Production build only; strict tsconfig already enforced (from 0.1); /api/health works as-is
   - Dependencies: 0.1 (web app already built)
   - Risk: Low (Next.js is a known build pattern)

5. **Create `apps/worker/Dockerfile`** (File: `apps/worker/Dockerfile`)
   - Action: Multi-stage: FROM node:22-alpine → corepack enable → corepack pnpm install --prod → corepack pnpm build (dist/index.js) → CMD ["node", "dist/index.js"]
   - Why: Worker runs compiled code; no live dev needed in compose
   - Dependencies: 0.1 (worker already has src/index.ts)
   - Risk: Low

### Phase 3: Acceptance Test
6. **Create `apps/worker/src/test-minio.ts`** (File: `apps/worker/src/test-minio.ts`)
   - Action: Small script (50 lines): instantiate MinIO client from env (MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY); create bucket 'test'; upload Buffer.from('hello world') as 'test-file.txt'; download and assert content; delete; exit 0
   - Why: Verifies MinIO is reachable and storage works before the harness depends on it
   - Dependencies: Step 2 (compose running MinIO)
   - Risk: Low (MinIO SDK is standard)

7. **Verify Acceptance** (Manual)
   - Action: In the repo root: `docker compose up -d && sleep 5 && curl http://localhost/api/health && docker compose exec worker npm run test:minio && docker compose down`
   - Why: Confirms /api/health 200 and MinIO round-trip both pass
   - Dependencies: Steps 1–6
   - Risk: Low (if steps are correct, this is mechanical)

## Testing Strategy
- **Compose syntax:** `docker compose config` must not error
- **Service health:** `docker compose up --wait` succeeds (waits for all health checks)
- **Web endpoint:** `curl http://localhost/api/health` returns 200 and `{"status":"ok"}`
- **MinIO:** Run the test-minio script via `docker compose exec worker node dist/test-minio.js` and verify exit 0
- **Volumes:** Check `docker/data/` exists after `docker compose up`; data persists across restart (`docker compose restart postgres`)
- **No real secrets:** Run `python3 .githooks/secret-scan.py --all` and verify no keys in docker/ or env.example

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Database init fails or pgvector not available | Embed `psql ... CREATE EXTENSION pgvector` in a SQL init script or service initialization script |
| MinIO bucket not auto-created | Create it in test-minio.ts before uploading; accept 409 if it already exists |
| Caddy reverse proxy misconfigured | Test manually with `curl -v http://localhost/api/health` to see routing headers; simplify Caddyfile first |
| Docker Compose version incompatibility | Specify `version: '3.8'` in compose.yaml and test on the same version used in CI |
| Port conflicts on localhost (port 80, 3000) | Document that users must ensure ports are free; offer `docker compose down` step before `up` |
| .env file committed by mistake | Hook reminder in docs; ignore it in gitignore already (set in 0.1) |
| Test-minio script fails in CI because MinIO not ready | Add retry loop with exponential backoff; or use `depends_on` service_healthy in compose (requires Redis and DB health checks first) |

## Success Criteria
- [ ] `docker compose config` validates without errors
- [ ] `docker compose up --wait` succeeds; all 6 services reach "healthy" state within 30 seconds
- [ ] `curl http://localhost/api/health` returns HTTP 200 with body `{"status":"ok"}`
- [ ] `docker compose exec worker npm run test:minio` (or similar) uploads, downloads and verifies a test file, exits 0
- [ ] `docker compose down` removes all containers and networks
- [ ] `docker compose up --wait` a second time succeeds (idempotent startup)
- [ ] `docker/data/` is gitignored and volumes persist across container restarts
- [ ] `env.example` contains no real secrets (all placeholders); docs explain copy to `.env`
- [ ] `python3 .githooks/secret-scan.py --all` passes (no keys in docker/ or Dockerfiles)
- [ ] Files only created/modified are those listed; no changes to packages or apps code except Dockerfiles

## Files to Create/Modify Summary
1. Create: `docker/compose.yaml`
2. Create: `docker/Caddyfile`
3. Create: `docker/env.example`
4. Create: `apps/web/Dockerfile`
5. Create: `apps/worker/Dockerfile`
6. Create: `apps/worker/src/test-minio.ts`
7. Verify: `docker/.gitignore` includes `data/`

## Deciding How Acceptance Is Shown
1. **Health check (200):** `docker compose up` → Caddy on port 80 routes to web:3000 → `curl http://localhost/api/health` returns 200 with `{"status":"ok"}`. This is verifiable by a human running the commands or by a CI integration test that starts compose and checks the endpoint.
2. **MinIO round-trip:** The builder includes `apps/worker/src/test-minio.ts` (or a separate script). It imports the MinIO SDK, creates a bucket, uploads a file, downloads it, verifies the content matches, deletes it, and exits 0. This runs inside the worker container via `docker compose exec worker npm run test:minio` or similar. A local developer or CI test can verify success by checking the exit code.

## Open Questions
1. **MinIO persistence and cleanup:** Should test files be cleaned up automatically, or left for inspection? (Recommendation: clean up in test-minio.ts; production uses buckets with retention policies later)
2. **Caddy config:** Should Caddyfile be dynamic (reloaded on file change) or static? (Recommendation: static for now; add reload if needed in M8 for uploads)
3. **Node version in Dockerfile:** Should we pin Node 22.5.1 (specific minor) or just 22-alpine? (Recommendation: 22-alpine for security patches; nvm pins 22 LTS in dev)
4. **Worker `test-minio` entry:** Should it be a separate npm script (package.json: `"test:minio": "node dist/test-minio.js"`) or run inside Docker manually? (Recommendation: add to package.json so `docker compose exec` works cleanly)

## Docker Installation Check
**Action:** The plan assumes Docker and Docker Compose (v2+) are installed locally. A developer should run `docker --version && docker compose --version` before starting. If Docker is not installed, they should install it (Docker Desktop on Mac/Windows, or docker.io + docker-compose-plugin on Linux) and ensure the daemon is running. CI will assume Docker is available in the GitHub Actions runner.

---

## How Acceptance Is Shown in Practice
1. **Local:** Developer clones the repo, copies `docker/env.example` to `.env`, runs `docker compose up --wait`, then:
   ```bash
   curl http://localhost/api/health
   # Response: {"status":"ok"} with HTTP 200
   
   docker compose exec worker npm run test:minio
   # Output: "Test passed: uploaded, downloaded, and verified test file"
   # Exit code: 0
   ```
   Both commands succeed → Task is done locally.

2. **CI:** A GitHub Actions workflow runs:
   ```bash
   cp docker/env.example .env
   docker compose up --wait
   curl http://localhost/api/health  # Must return 200
   docker compose exec worker npm run test:minio  # Must exit 0
   docker compose down
   ```
   All checks pass → Task is done in CI.


## Team lead amendments (18 Oct 2026) — override the sections above

1. **Postgres image:** `pgvector/pgvector:pg16` (pinned to a specific tag), not `postgres:16-alpine`, which has no pgvector. Init script `docker/postgres/init.sql` runs `CREATE EXTENSION IF NOT EXISTS vector;` (the extension is `vector`).
2. **Pin every image to an exact tag**, including MinIO (a dated `RELEASE.…` tag, never `latest`), Redis, Caddy and Node (`node:22.x-alpine` with exact minor).
3. **No `.env` needed to run.** Agents cannot create `.env` files (hook-blocked) and the acceptance must run here. In compose use `${VAR:-dev-default}` for every setting; `docker/env.example` documents each variable with the same placeholder values. Dev-only placeholders such as `edmate-dev` are fine; if the secret scan flags one, choose a different placeholder rather than adding an allow marker.
4. **Ports:** port 3000 on this machine is used by an unrelated process. Publish only Caddy, on `${EDMATE_HTTP_PORT:-8080}`; web and worker stay on the compose network. MinIO API/console may publish on 9000/9001 for local use. Acceptance: `curl -i localhost:8080/api/health` → 200.
5. **Web Dockerfile:** multi-stage; install all deps (dev deps are needed to build), build with turbo for `web`, run with Next.js standalone output (set `output: 'standalone'` in apps/web/next.config.ts; that is the one allowed change to app code) or `pnpm --filter web start`. Drop the `node -e require(...start-server)` command. Same multi-stage approach for the worker. Add a `.dockerignore` at the repo root (node_modules, .next, dist, docker/data, .claude/worktrees, .git).
6. **Healthchecks:** web via `wget -qO- localhost:3000/api/health` (or node fetch); alpine has no curl. Caddy `depends_on` web `service_healthy`.
7. **Storage round-trip:** `apps/worker/src/scripts/storage-roundtrip.ts`, using the AWS SDK v3 S3 client (`@aws-sdk/client-s3`, pinned), since production is an S3-compatible bucket, not necessarily MinIO. Creates the bucket if missing, uploads, downloads, compares, deletes, exits 0. Add a `storage:roundtrip` script to apps/worker/package.json. Unit tests stay mock-only (no network in `pnpm test`); the round-trip is run manually against compose and pasted in the handoff.
8. Open questions answered: clean up test objects (yes); npm script (yes, as above); Caddy reload (not needed).
9. Log in the handoff decisions: image choices and tags, S3 client choice, ports, standalone output.
