# Handoff: 9.9b — scripts/live-deploy.sh + docs/live-demo.md

Status: DONE

## Files changed

- `scripts/live-deploy.sh` (new)
- `docs/live-demo.md` (new)

Nothing else touched. `docker/compose.yaml`, `docker/Caddyfile`, `docker/compose.live.yaml`,
`docker/Caddyfile.live`, `infra/azure/**`, `docs/try-it.md`, `docker/env.example` were only read for
reference, never edited.

## How I verified

- `bash -n scripts/live-deploy.sh` passes. `shellcheck` is not installed in this environment, so it
  wasn't run (not wired into CI either — see Decisions below).
- Read the script against every clause of the accept line and the plan's design decisions:
  - Fails loudly (non-zero exit via `die` or `set -euo pipefail`) on: `EDMATE_PUBLIC_HOST` unset,
    `docker/.env` missing, `AUTH_SECRET`/`EDMATE_ANTHROPIC_API_KEY` unset in `docker/.env`, a dirty
    or diverged `git pull --ff-only`, or any compose/migrate/seed command failing.
  - The one `docker compose up -d --build` line is
    `docker compose -f docker/compose.yaml -f docker/compose.live.yaml up -d --build` — exactly the
    two `-f` flags named in the task title.
  - The printed line is `live at: https://$HOST"` where `HOST` is exactly `EDMATE_PUBLIC_HOST` (from
    `$1` or the env var) — no literal default.
  - `EDMATE_PUBLIC_HOST` is read only from `$1`/the shell env var, never from `docker/.env`.
  - The health check is a soft, bounded retry (24 tries / 5 s) that warns and still prints the URL
    on timeout rather than exiting non-zero.
- Ran a plain-text scan over `docs/live-demo.md` (and `scripts/live-deploy.sh`) for IPv4-shaped
  strings, non-placeholder hostnames, and `=<value>` secret assignments:
  `grep -nE '([0-9]{1,3}\.){3}[0-9]{1,3}'` and a bare-hostname grep. Every hit was `127.0.0.1`
  (loopback, matching decision 1 below), a placeholder inside `<...>`, or a filename/doc reference —
  zero real IPs, hostnames or secret values.

## Decisions

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
