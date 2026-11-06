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
# Safe to rerun: `git pull --ff-only origin main` fails loudly rather than silently on a dirty
# tree or a diverged branch (fix that by hand on the VM, then rerun); `docker compose up -d
# --build`, `db:migrate` and `pnpm seed` are already idempotent.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"

say() { printf 'live-deploy: %s\n' "$*" >&2; }
die() { say "$*"; exit 2; }

HOST="${1:-${EDMATE_PUBLIC_HOST:-}}"
[ -n "$HOST" ] || die "EDMATE_PUBLIC_HOST is not set (pass it as the first argument or export it). See docs/live-demo.md."
export EDMATE_PUBLIC_HOST="$HOST"

[ -f docker/.env ] || die "docker/.env is missing. Copy docker/env.example to docker/.env and fill in the secrets by hand (see docs/live-demo.md). Never commit it."

# docker/.env is sourced (not just parsed) below, so treat it like the secrets file it is: refuse
# to source it if it isn't owned by the current user or is writable by anyone else, the same check
# scripts/claude-backup.sh already applies to its own secrets file.
env_owner=$(stat -c '%u' docker/.env 2>/dev/null || stat -f '%u' docker/.env)
[ "$env_owner" = "$(id -u)" ] || die "docker/.env is not owned by you; refusing to source it as code."
env_mode=$(stat -c '%a' docker/.env 2>/dev/null || stat -f '%Lp' docker/.env)
env_group_bit=${env_mode: -2:1}
env_other_bit=${env_mode: -1}
if [ $(( env_group_bit & 2 )) -ne 0 ] || [ $(( env_other_bit & 2 )) -ne 0 ]; then
  die "docker/.env is group- or world-writable (mode $env_mode); chmod it so only you can write it, then rerun."
fi

# Strip any CRLF line endings before sourcing, so a value edited/copied from Windows doesn't bake
# a trailing \r into AUTH_SECRET/POSTGRES_*/etc.
set -a
# shellcheck disable=SC1091
source <(sed 's/\r$//' docker/.env)
set +a
# Reassert after sourcing: EDMATE_PUBLIC_HOST must come only from $1/the shell env var (decision
# 2), never get silently overwritten by a same-named key in docker/.env.
export EDMATE_PUBLIC_HOST="$HOST"

for v in AUTH_SECRET EDMATE_ANTHROPIC_API_KEY; do
  [ -n "${!v:-}" ] || die "$v is not set in docker/.env. See docs/live-demo.md."
done

say "pulling main"
git pull --ff-only origin main || die "git pull --ff-only origin main failed; resolve by hand on the VM (dirty tree or diverged branch), then rerun."

say "installing dependencies (in case the pull changed any)"
corepack pnpm install

say "building and starting the live stack for https://$HOST"
docker compose -f docker/compose.yaml -f docker/compose.live.yaml up -d --build

say "publishing postgres on loopback for migrate/seed (matches docs/try-it.md)"
# Passes the same -f docker/compose.live.yaml used above, so this resolves the same merged
# postgres service the live stack is already running under. Assumes docker/compose.live.yaml
# (9.9a) never redefines the postgres service itself (only adds Caddy/overlay-only services).
docker compose -f docker/compose.yaml -f docker/compose.live.yaml -f packages/db/test/compose.port.yaml up -d postgres
export DATABASE_URL="postgres://${POSTGRES_USER:-edmate}:${POSTGRES_PASSWORD:-edmate-dev}@127.0.0.1:${EDMATE_PG_TEST_PORT:-55432}/${POSTGRES_DB:-edmate}"
corepack pnpm --filter @edmate/db db:migrate
corepack pnpm seed

say "waiting for the public URL to answer (up to 4 minutes: 24 tries, 5s curl timeout + 5s sleep each; a timeout is not fatal, see docs/live-demo.md)"
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
  say "health check: still not answering after 4 minutes; see docs/live-demo.md's troubleshooting section."
fi

say "live at: https://$HOST"
