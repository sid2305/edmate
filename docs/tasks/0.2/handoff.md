# 0.2 handoff: Docker Compose

Status: DONE
Branch: `m0/0.2-docker-compose`
Worktree: `.claude/worktrees/agent-acf3bc6e6fae27b5d`
Plan: `docs/tasks/0.2/plan.md` (team lead amendments applied over the earlier sections)

## Acceptance evidence

No env file was used for any of these runs (amendment 3).

`docker compose -f docker/compose.yaml up -d --build --wait` then `docker compose -f docker/compose.yaml ps`:
```
SERVICE    IMAGE                                      STATUS                    PORTS
caddy      caddy:2.10.2-alpine                        Up 5 seconds (healthy)    127.0.0.1:8080->80/tcp
minio      pgsty/minio:RELEASE.2026-08-04T00-00-00Z   Up 17 seconds (healthy)   127.0.0.1:9000-9001->9000-9001/tcp
postgres   pgvector/pgvector:0.8.1-pg16               Up 17 seconds (healthy)   5432/tcp
redis      redis:7.4.6-alpine                         Up 17 seconds (healthy)   6379/tcp
web        edmate-web:dev                             Up 11 seconds (healthy)   3000/tcp
worker     edmate-worker:dev                          Up 11 seconds (healthy)
```

`curl -i localhost:8080/api/health`:
```
HTTP/1.1 200 OK
Cache-Control: no-store
Content-Type: application/json
Via: 1.1 Caddy
{"status":"ok"}
```

Storage round-trip, inside the stack (`docker compose -f docker/compose.yaml exec worker npm run storage:roundtrip`):
```
[storage:roundtrip] ok: 50 bytes to http://minio:9000 edmate-dev/roundtrip/9137e61c-....txt (bucket created; object deleted)
exit=0
```
From the host after `corepack pnpm build` (`corepack pnpm --filter worker storage:roundtrip`):
```
[storage:roundtrip] ok: 50 bytes to http://localhost:9000 edmate-dev/roundtrip/2a97e728-....txt (bucket existed; object deleted)
exit=0
```
Failure path (wrong key, `-e S3_SECRET_ACCESS_KEY=wrong-placeholder`):
```
[storage:roundtrip] failed: Unknown (HTTP 403: check the access key pair)
exit=1
```

pgvector: `psql -U edmate -d edmate -tAc "select extname||' '||extversion from pg_extension where extname='vector'"` → `vector 0.8.1`.

Idempotent restart: `docker compose down` then `up -d --wait` again → all six healthy, health 200, round-trip `bucket existed` (MinIO data persisted in `docker/data/minio`). Web and worker containers run as `node` (not root). Images: web 197 MB, worker 179 MB. Stack stopped with `docker compose -f docker/compose.yaml down`; `git check-ignore docker/data/postgres` → ignored by `.gitignore:28 docker/data/`.

`corepack pnpm build test lint typecheck` → `Tasks: 36 successful, 36 total`. `corepack pnpm format:check` → all files formatted.

`corepack pnpm --filter @edmate/worker test` → 24 tests passed; coverage 100% statements, branches, functions, lines (`src/storage/roundtrip.ts`, `src/worker.ts`).

`python3 .githooks/secret-scan.py --all` → clean (run before the final commit).

## Changes
- `docker/compose.yaml`: postgres (pgvector), redis, minio, web, worker, caddy. Every setting is `${VAR:-dev-default}`; healthchecks on all six; `depends_on: service_healthy`; data bind-mounted under `docker/data/` (gitignored); only Caddy (8080) and MinIO (9000/9001) publish ports, on 127.0.0.1.
- `docker/Caddyfile`: `:80` → `web:3000`, `auto_https off`.
- `docker/env.example`: every variable with the same dev placeholders as the compose defaults.
- `docker/postgres/init.sql`: `CREATE EXTENSION IF NOT EXISTS vector;`.
- `apps/web/Dockerfile`: multi-stage, `pnpm fetch` + offline install, turbo build, standalone runtime as `node`, wget healthcheck.
- `apps/worker/Dockerfile`: multi-stage, turbo build, `pnpm deploy --prod --legacy`, runtime as `node`.
- `.dockerignore` at the repo root.
- `apps/web/next.config.ts`: `output: 'standalone'` (the one allowed app-code change).
- `apps/worker`: `@aws-sdk/client-s3` 3.1152.0 (exact); `src/storage/roundtrip.ts` (config from env, `ensureBucket`, `roundTrip`, `describeError`) with `roundtrip.test.ts` (mocked S3 client, no network); `src/scripts/storage-roundtrip.ts` entrypoint; `storage:roundtrip` script; `src/scripts/**` excluded from coverage like `src/index.ts`.

## Deviations
- **MinIO image is `pgsty/minio`, not `minio/minio`.** Upstream `minio/minio` and `quay.io/minio/minio` no longer serve images (registry returns "authentication required" / "no such manifest" for every tag tried). See Decisions; the lead may prefer another choice.
- The round-trip logic is in `src/storage/roundtrip.ts`; `src/scripts/storage-roundtrip.ts` (the path in amendment 7) is a thin entrypoint, so the logic is unit-tested and the network part stays out of coverage.
- Inside the container the script runs as `npm run storage:roundtrip` (the runtime image has no pnpm or workspace); from the host it is `corepack pnpm --filter worker storage:roundtrip`, which needs `corepack pnpm build` first (it runs `dist/`).
- Plan step "named volumes": used bind mounts under `docker/data/` as the plan's Requirements 7 and the brief describe.
- Plan's `version: '3.8'` key dropped (obsolete in Compose v2; it warns).
- `.dockerignore` excludes all of `.claude`, not just `.claude/worktrees` (nothing in it is needed to build).
- Not run: a CI workflow for compose (task 0.5 owns CI).
- Not written: `docs/tasks/0.2/review.md` (the lead writes it). No risky paths touched.

## Decisions

### 18 Oct 2026 · 0.2 MinIO image from a community build · decided by tdd-guide · risk: medium
Decided: The local S3 server is `pgsty/minio:RELEASE.2026-08-04T00-00-00Z`, a maintained community build of the MinIO server with dated release tags, because the official MinIO images are no longer published.
Why: The amendment asks for MinIO pinned to a dated release tag; this is the only source found that still has one. It is dev-only, and the app talks plain S3, so it can be swapped without code changes.
Alternatives: `bitnamilegacy/minio` (frozen at 2025.7, no updates); Chainguard's MinIO (free tier is `latest` only); a different S3 server such as SeaweedFS or RustFS; building MinIO from source in our own image.
Reversible: Yes, one image line in docker/compose.yaml.

### 18 Oct 2026 · 0.2 Other image pins · decided by tdd-guide · risk: low
Decided: `pgvector/pgvector:0.8.1-pg16`, `redis:7.4.6-alpine`, `caddy:2.10.2-alpine`, and `node:22.22.3-alpine3.22` for both app images (the same Node as `.nvmrc` 22 in dev).
Why: Exact tags as amendment 2 asks; pgvector's image is Postgres 16 with the extension built in.
Alternatives: Floating tags such as `pg16`, `7-alpine`, `2-alpine`, `22-alpine`.
Reversible: Yes.

### 18 Oct 2026 · 0.2 S3 client · decided by lead · risk: low
Decided: The storage round-trip uses the AWS SDK v3 S3 client (`@aws-sdk/client-s3` 3.1152.0, exact), with path-style addressing on by default for MinIO.
Why: Production is any S3-compatible bucket, not necessarily MinIO (amendment 7).
Alternatives: The MinIO JS SDK.
Reversible: Yes.

### 18 Oct 2026 · 0.2 Ports and defaults · decided by tdd-guide · risk: low
Decided: Only Caddy publishes a port, on 127.0.0.1:8080 (`EDMATE_HTTP_PORT`), plus MinIO's API and console on 127.0.0.1:9000/9001; web, worker, Postgres and Redis stay on the compose network. Compose runs with no env file: every setting has a dev default (`edmate` / `edmate-dev` / `edmate-dev-storage`) documented in docker/env.example.
Why: Port 3000 is taken on this machine (amendment 4); binding to 127.0.0.1 keeps the dev passwords off the local network; agents cannot create env files (amendment 3).
Alternatives: Publish on all interfaces; require an env file.
Reversible: Yes.

### 18 Oct 2026 · 0.2 Standalone web image · decided by lead · risk: low
Decided: The web image runs Next.js standalone output (`output: 'standalone'` in apps/web/next.config.ts) as the `node` user; the worker image uses `pnpm deploy --prod` and runs as `node`.
Why: Small runtime images (about 200 MB) with no dev dependencies or root process.
Alternatives: `pnpm --filter web start` on a full install.
Reversible: Yes.

### 18 Oct 2026 · 0.2 Worker healthcheck · decided by tdd-guide · risk: low
Decided: The worker counts as healthy when its container can open a connection to Redis, its queue.
Why: The worker has no HTTP port yet and app code was out of scope; this shows the process is up and its one dependency is reachable.
Alternatives: A heartbeat file or HTTP endpoint written by the worker (needs a change to apps/worker/src/index.ts); no healthcheck.
Reversible: Yes, when real queues land.
