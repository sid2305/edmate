#!/usr/bin/env bash
# Deploy the live demo stack on the edmate-app VM: pull main, build and start the live overlay,
# migrate and seed the database, and print the public URL. See docs/live-demo.md.
#
#   scripts/live-deploy.sh [public-host]
#
# The public host/IP comes only from the first argument or the EDMATE_PUBLIC_HOST shell env var
# (never from docker/.env). AUTH_SECRET and EDMATE_ANTHROPIC_API_KEY are read from docker/.env,
# filled in by hand on the VM; this script never writes or prints either.
#
# Safe to rerun: `git pull --ff-only` fails loudly rather than silently on a dirty tree or a
# diverged branch (fix that by hand on the VM, then rerun); `docker compose up -d --build`,
# `db:migrate` and `pnpm seed` are already idempotent.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"

say() { printf 'live-deploy: %s\n' "$*" >&2; }
die() { say "$*"; exit 2; }

HOST="${1:-${EDMATE_PUBLIC_HOST:-}}"
[ -n "$HOST" ] || die "EDMATE_PUBLIC_HOST is not set (pass it as the first argument or export it). See docs/live-demo.md."
export EDMATE_PUBLIC_HOST="$HOST"

[ -f docker/.env ] || die "docker/.env is missing. Copy docker/env.example to docker/.env and fill in the secrets by hand (see docs/live-demo.md). Never commit it."
set -a
# shellcheck disable=SC1091
source docker/.env
set +a

for v in AUTH_SECRET EDMATE_ANTHROPIC_API_KEY; do
  [ -n "${!v:-}" ] || die "$v is not set in docker/.env. See docs/live-demo.md."
done

say "pulling main"
git pull --ff-only || die "git pull --ff-only failed; resolve by hand on the VM (dirty tree or diverged branch), then rerun."

say "building and starting the live stack for https://$HOST"
docker compose -f docker/compose.yaml -f docker/compose.live.yaml up -d --build

say "publishing postgres on loopback for migrate/seed (matches docs/try-it.md)"
docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres
export DATABASE_URL="postgres://${POSTGRES_USER:-edmate}:${POSTGRES_PASSWORD:-edmate-dev}@127.0.0.1:${EDMATE_PG_TEST_PORT:-55432}/${POSTGRES_DB:-edmate}"
corepack pnpm --filter @edmate/db db:migrate
corepack pnpm seed

say "waiting for the public URL to answer (up to 2 minutes; a timeout is not fatal, see docs/live-demo.md)"
healthy=0
for i in $(seq 1 24); do
  if curl -fsS --max-time 5 "https://$HOST/api/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 5
done
if [ "$healthy" -eq 1 ]; then
  say "health check: ok"
else
  say "health check: still not answering after 2 minutes; see docs/live-demo.md's troubleshooting section."
fi

say "live at: https://$HOST"
