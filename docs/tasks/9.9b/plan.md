# Plan: 9.9b — scripts/live-deploy.sh + docs/live-demo.md

## Acceptance (verbatim)
> a clean checkout on the edmate-app VM, with `EDMATE_PUBLIC_HOST` and the secrets set by hand,
> reaches a running stack and a printed https URL by running `scripts/live-deploy.sh` alone;
> `docs/live-demo.md` has no real IP, hostname or secret in it.

How it will be shown: the builder cannot run this for real (no VM access, CLAUDE.md rule 4: no
real model/SSH calls in tests). It proves the script with `bash -n` (syntax) and a code read-through
against every acceptance clause (fails loudly on each unset var; the one `docker compose up -d --build`
line matches the title's two `-f` flags exactly; the printed line is `https://${EDMATE_PUBLIC_HOST}`
with no literal default), and proves the doc with a plain-text scan (`grep -nE` for IPv4, a bare
hostname-looking token, or `=` followed by a non-placeholder value) showing zero matches. The real
run against the VM is 9.9c, not this task.

## Files to create
- `scripts/live-deploy.sh`
- `docs/live-demo.md`

## Files out of bounds
`docker/compose.yaml`, `docker/Caddyfile`, `docker/compose.live.yaml`, `docker/Caddyfile.live`
(9.9a's files — may not exist yet at build time, that's fine), `infra/azure/**`, `docs/try-it.md`,
`docker/env.example` (read-only reference).

## Design decisions (go to the task's `## Decisions`, not a human blocker)
1. **Migrate/seed run the same way `docs/try-it.md` already does, against the VM's own loopback**:
   `docker compose -f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`
   publishes Postgres on `127.0.0.1:55432` (loopback only — the VM's NSG has no inbound rule for it
   anyway), then the script runs `db:migrate` and `pnpm seed` from the host exactly as try-it.md
   does. No new in-container migration path is invented; the web/worker images are standalone
   runtime images and don't carry the `@edmate/db` CLI.
2. **`EDMATE_PUBLIC_HOST` comes only from `$1` or the `EDMATE_PUBLIC_HOST` shell env var**, never
   from `docker/.env`, matching the accept line's exact wording ("an env var or script argument
   only"). `AUTH_SECRET` and `EDMATE_ANTHROPIC_API_KEY` (the "secrets ... fills by hand on the VM")
   are read from `docker/.env`, the existing convention in every other guide (`try-it.md`,
   `azure-vm.md`). The script `set -a; source docker/.env; set +a` (if the file exists) before
   validating.
3. **Bucket creation (`storage:roundtrip`) is not in the script** — the task title lists exactly
   "db:migrate and the docs/try-it.md demo seed", not storage. It is documented as an explicit
   smoke-checklist step in `docs/live-demo.md` instead, so 9.9c's first real run surfaces a missing
   bucket rather than the script silently doing something the title didn't ask for.
4. **No shellcheck/test file is added.** The repo has no bash test convention: the two existing
   scripts (`scripts/claude-backup.sh`, `infra/azure/start-lead.sh`) have no test file and
   `.github/workflows/ci.yml` runs no shellcheck step. The builder runs `bash -n` and, if available,
   `shellcheck` locally as its own verification, but does not wire either into CI — matching what's
   already there, not inventing a new pattern.
5. **Health check after `up -d --build` is a soft, bounded retry loop** (`curl -fsS
   https://${EDMATE_PUBLIC_HOST}/api/health`, e.g. 24 tries / 5 s), that warns and still prints the
   URL on timeout rather than exiting non-zero — 9.9c's whole job is to fix wiring from a first run
   that may not be healthy yet, so the script must not die before printing the URL it needs.
6. **Idempotency**: `git pull --ff-only` (fails loudly, not silently, on a dirty tree or diverged
   branch — the human/console fixes that by hand), `docker compose up -d --build` is naturally
   rerunnable, `db:migrate` and `pnpm seed` are already idempotent per try-it.md.

## scripts/live-deploy.sh — outline
```
#!/usr/bin/env bash
set -euo pipefail
# usage: scripts/live-deploy.sh [public-host]
REPO_ROOT=... (cd "$(dirname "$0")/.."; pwd)
cd "$REPO_ROOT"

say() { printf 'live-deploy: %s\n' "$*" >&2; }
die() { say "$*"; exit 2; }

HOST="${1:-${EDMATE_PUBLIC_HOST:-}}"
[ -n "$HOST" ] || die "EDMATE_PUBLIC_HOST is not set (env var or script argument). See docs/live-demo.md."
export EDMATE_PUBLIC_HOST="$HOST"

[ -f docker/.env ] || die "docker/.env is missing. Copy docker/env.example to docker/.env and fill in the secrets by hand (see docs/live-demo.md). Never commit it."
set -a; source docker/.env; set +a

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
for i in $(seq 1 24); do
  if curl -fsS --max-time 5 "https://$HOST/api/health" >/dev/null 2>&1; then say "health check: ok"; break; fi
  sleep 5
done

say "live at: https://$HOST"
```
(Builder fills in exact quoting/error text; this is the shape, not the literal final file.)

## docs/live-demo.md — outline
Mirrors `docs/try-it.md`'s structure and account-creation steps (same copy where it still applies),
swapping `http://localhost:8080` for `https://${EDMATE_PUBLIC_HOST}`:
1. What you need (SSH access to `edmate-app`, nothing else — no local Docker).
2. Fill `docker/.env` by hand on the VM (copy from `docker/env.example`): `AUTH_SECRET`
   (`openssl rand -base64 32`), `EDMATE_ANTHROPIC_API_KEY`. State plainly: `EMAIL_SERVER`/
   `EMAIL_FROM` stay unset — the live demo keeps using Mailpit until a real mail provider exists
   (human decision, `docs/setup/sign-in-mail-and-proxy.md`), and Mailpit's own web UI stays bound to
   127.0.0.1 (9.9a), never public.
3. `export EDMATE_PUBLIC_HOST=<your VM's hostname>` then `scripts/live-deploy.sh` (or
   `scripts/live-deploy.sh <hostname>`). No literal example resembling a real sslip.io host or IP —
   use a placeholder like `<your-vm-hostname>`.
4. Reaching Mailpit over the tailnet (not the public internet) to read sign-in links: reuse the SSH
   port-forward pattern `docs/azure-vm.md` already uses to reach the VM's internal services (named,
   not re-invented) — `ssh -L 8025:127.0.0.1:8025 edmate@<host>` then open
   `http://127.0.0.1:8025` locally.
5. Make the staff account, verify the demo teacher, upload the sample lesson, start the student
   package and chat — same commands/screens as try-it.md §4-6, with the URL swapped.
6. Smoke checklist: `/api/health` is 200; sign-in mail arrives in Mailpit over the tailnet; upload
   goes Processing → Ready (flags the MinIO bucket step — `docker compose ... exec worker npm run
   storage:roundtrip` — if it doesn't, per decision 3 above); student chat gets a real reply with no
   error.
7. Troubleshooting: reuse try-it.md's entries that still apply (provider_key, DATABASE_URL not set);
   add one for `EDMATE_PUBLIC_HOST`/`AUTH_URL` mismatches (cookie/CORS) since 9.9c is the task that
   resolves those from a real run.
No literal IP, hostname or secret value anywhere in the file — every example is a placeholder.

## Tests first
No test file is added (see decision 4). Before handoff the builder runs `bash -n scripts/live-deploy.sh`
and re-reads the script against every clause of the accept line and the scope boundaries (idempotent,
fails loudly, no silent default, takes the host only from arg/env). `docs/live-demo.md` is checked
with a plain-text grep for IPv4-shaped strings, `=<non-placeholder>` secret assignments, and any
hostname that isn't `<...>` or `localhost`.

## Risky paths touched
None (checked against `.claude/skills/merge-gate/risk-paths.txt`): `scripts/**` and `docs/**` are not
in any listed group.

## Open questions
None — the human's context message and the existing `try-it.md`/`azure-vm.md`/`env.example`
conventions resolve every design choice above (logged as Decisions, not blockers).

## Budget
Budget: 40 tool calls (1 phase, no packages)

## Allowed tools
Read, Grep, Glob, Write, Edit, Bash (bash -n / shellcheck / grep checks only — no docker, SSH, model or payment calls)

## Exit conditions
Status: DONE once both files exist, `bash -n` passes, every accept-line clause is satisfied by a
read-through, and the doc's secret/IP scan is clean. Status: PARTIAL if a reasonable build exceeds
about 40 tool calls, or if 9.9a's actual `docker/compose.live.yaml` (once merged) turns out to need a
different invocation shape than the title specifies — stop and hand back rather than guessing.
