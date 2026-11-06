# Handoff: 9.9b — scripts/live-deploy.sh + docs/live-demo.md

Status: DONE

## Files changed

- `scripts/live-deploy.sh` (new)
- `docs/live-demo.md` (new)

Nothing else touched. `docker/compose.yaml`, `docker/Caddyfile`, `docker/compose.live.yaml`,
`docker/Caddyfile.live`, `infra/azure/**`, `docs/try-it.md`, `docker/env.example` were only read for
reference, never edited.

## How I verified

- `bash -n scripts/live-deploy.sh` passes (re-checked after the review-fix round below).
  `shellcheck` is not installed in this environment, so it wasn't run (not wired into CI either —
  see Decisions below).
- Read the script against every clause of the accept line and the plan's design decisions:
  - Fails loudly (non-zero exit via `die` or `set -euo pipefail`) on: `EDMATE_PUBLIC_HOST` unset,
    `docker/.env` missing or not owned by/writable only by the current user, `AUTH_SECRET`/
    `EDMATE_ANTHROPIC_API_KEY` unset in `docker/.env`, a dirty or diverged `git pull --ff-only
    origin main`, or any compose/migrate/seed command failing.
  - The one `docker compose up -d --build` line is
    `docker compose -f docker/compose.yaml -f docker/compose.live.yaml up -d --build` — exactly the
    two `-f` flags named in the task title.
  - The printed line is `live at: https://$HOST"` where `HOST` is exactly `EDMATE_PUBLIC_HOST` (from
    `$1` or the env var) — no literal default.
  - `EDMATE_PUBLIC_HOST` is read only from `$1`/the shell env var, never from `docker/.env`: it is
    exported once on resolution and re-exported immediately after `docker/.env` is sourced, so a
    same-named key in that file can never win (see Round 2 fixes below).
  - The health check is a soft, bounded retry (24 tries / 5 s curl timeout + 5 s sleep, ~4 minutes
    worst case) that warns and still prints the URL on timeout rather than exiting non-zero.
- Ran a plain-text scan over `docs/live-demo.md` (and `scripts/live-deploy.sh`) for IPv4-shaped
  strings, non-placeholder hostnames, and `=<value>` secret assignments:
  `grep -nE '([0-9]{1,3}\.){3}[0-9]{1,3}'` and a bare-hostname grep. Every hit was `127.0.0.1`
  (loopback, matching decision 1 below), a placeholder inside `<...>`, or a filename/doc reference —
  zero real IPs, hostnames or secret values.

## Round 2: review fixes (code-reviewer CHANGES_REQUESTED + security-reviewer APPROVE)

Full write-ups at `docs/tasks/9.9b/review.md` and `docs/tasks/9.9b/security-review.md`. Fixed all
six open findings, in `scripts/live-deploy.sh` only:

1. **[HIGH] Export-order bug.** `export EDMATE_PUBLIC_HOST="$HOST"` is now re-asserted immediately
   after `source`-ing `docker/.env`, so a same-named key in that file can no longer silently win.
   Reproduced the clobber and the fix in a scratch shell outside the repo (exported a host, sourced
   a file defining the same var, confirmed the pre-fix value got overwritten and the post-fix
   reassert restores it).
2. **[MEDIUM, security] No ownership/permission check before sourcing `docker/.env` as code.**
   Added the same style of check `scripts/claude-backup.sh:65-76` uses: `die`s if the file isn't
   owned by the current user, or is group/other-writable (checked via `stat`'s mode bits).
3. **[MEDIUM] CRLF robustness.** `docker/.env` is now sourced through `source <(sed 's/\r$//'
   docker/.env)` so a trailing `\r` from a Windows-edited file never bakes into a sourced value.
   Verified in a scratch shell: before the fix a CRLF value came back as 7 bytes; after, 6.
4. **[MEDIUM] Health-check timing wording.** The script's `say` line and `docs/live-demo.md` both
   said "up to two minutes"; the real worst case is 24 × (5 s curl timeout + 5 s sleep) = 240 s (~4
   minutes). Both now say four minutes; the retry count/sleep themselves are unchanged (a cold boot
   may need the full window).
5. **[MEDIUM] Inconsistent `-f` flags on the second compose call.** The loopback-postgres call now
   passes `-f docker/compose.yaml -f docker/compose.live.yaml -f packages/db/test/compose.port.yaml`
   (all three), matching the main `up -d --build` call, so both calls resolve the same merged
   `postgres` service. Added a comment noting this assumes `docker/compose.live.yaml` (9.9a) never
   redefines the `postgres` service itself.
6. **[LOW] `git pull --ff-only` pulled whatever branch was checked out, not necessarily `main`.**
   Changed to `git pull --ff-only origin main`, matching the "pulling main" log line.
7. **[LOW] No `pnpm install` after the pull.** Added `corepack pnpm install` right after the pull,
   before the build/migrate/seed steps, so a dependency-changing commit doesn't surface as a
   confusing module-resolution error later.

Re-verified after all fixes: `bash -n scripts/live-deploy.sh` passes; re-ran the export-order
reproduction (now fixed); re-ran the CRLF reproduction (now fixed); re-ran the plain-text IP/
hostname/secret scan on both files (same clean result as before — see above).

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
   `azure-vm.md`). The script checks `docker/.env`'s ownership/permissions, then
   `set -a; source <(sed 's/\r$//' docker/.env); set +a` (if the file exists), then re-exports
   `EDMATE_PUBLIC_HOST="$HOST"` so a same-named key in the file can never win — see Round 2 fixes
   #1-3 above.
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
6. **Idempotency**: `git pull --ff-only origin main` (fails loudly, not silently, on a dirty tree
   or diverged branch — the human/console fixes that by hand), `docker compose up -d --build` is
   naturally rerunnable, `db:migrate` and `pnpm seed` are already idempotent per try-it.md. A
   `corepack pnpm install` runs right after the pull so a dependency-changing commit doesn't surface
   as a confusing module-resolution error in the migrate/seed steps (Round 2 fix #7).
7. **(Post-approval, lead) `docs/live-demo.md`'s `docker/.env` block now lists all the human-filled
   vars in one place**: `AUTH_SECRET`, `EDMATE_ANTHROPIC_API_KEY`, and the four `S3_*` vars
   (`S3_REGION`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_BUCKET`), per a direct human
   instruction that `EDMATE_ANTHROPIC_API_KEY` is the human's own key, filled by hand only — never
   held by an agent, a doc, a message or a log — and that the doc must name every var and cover
   B-69 (the live overlay must not fall back to the dev stack's placeholder S3 values).
   `scripts/live-deploy.sh` itself is unchanged; only `docs/live-demo.md` grew a fuller step 2 and
   one new troubleshooting entry for the placeholder-rejection error. `EDMATE_PUBLIC_HOST` stays
   out of that block, in its own step 3, per decision 2 above — unchanged.
