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

### 6 Nov 2026 · 9.9b migrate/seed reuse try-it.md's loopback Postgres pattern · decided by builder · risk: low
Decided: `scripts/live-deploy.sh` publishes Postgres on `127.0.0.1:55432` via `packages/db/test/compose.port.yaml` and runs `db:migrate`/`pnpm seed` from the host, exactly as `docs/try-it.md` does.
Why: The web/worker runtime images don't carry the `@edmate/db` CLI, so no new in-container migration path is needed.
Alternatives: An in-container migration step (rejected: would need a new image variant for no gain).
Reversible: Yes.

### 6 Nov 2026 · 9.9b EDMATE_PUBLIC_HOST comes only from an env var or script argument · decided by builder · risk: low
Decided: `EDMATE_PUBLIC_HOST` is read only from `$1` or the shell env var, never from `docker/.env`; `AUTH_SECRET`/`EDMATE_ANTHROPIC_API_KEY` still come from `docker/.env` as every other guide already does. The script re-exports `EDMATE_PUBLIC_HOST` after sourcing the file so a same-named key there can never win.
Why: Matches the accept line's exact wording; a stale value left in `docker/.env` must never silently override the host the script was actually just told to use.
Alternatives: Allow `docker/.env` to set it too (rejected: exactly the silent-override risk the accept line rules out).
Reversible: Yes.

### 6 Nov 2026 · 9.9b bucket creation left out of the deploy script · decided by builder · risk: low
Decided: `storage:roundtrip` (MinIO bucket creation) is not run by `scripts/live-deploy.sh`; it's a documented manual smoke-check step in `docs/live-demo.md` instead.
Why: The task title lists exactly "db:migrate and the docs/try-it.md demo seed", not storage; a missing bucket should surface as a visible first-run issue, not be silently papered over.
Alternatives: Add it to the script (rejected: outside the task's stated scope).
Reversible: Yes.

### 6 Nov 2026 · 9.9b no shellcheck/test file added · decided by builder · risk: low
Decided: No shellcheck or test file for `scripts/live-deploy.sh`; the builder ran `bash -n` and `shellcheck` locally but wired neither into CI.
Why: Matches the repo's existing convention — neither `scripts/claude-backup.sh` nor `infra/azure/start-lead.sh` has a test file, and CI runs no shellcheck step today.
Alternatives: Add a new CI shellcheck step (rejected: a repo-wide convention change, out of scope for this task).
Reversible: Yes.

### 6 Nov 2026 · 9.9b health check is a soft, bounded retry that never fails the script · decided by builder · risk: low
Decided: After `up -d --build`, the script polls `/api/health` (e.g. 24 tries / 5s) and still prints the URL on timeout instead of exiting non-zero.
Why: Task 9.9c's job is to fix wiring from a first run that may not be healthy yet, so the script must not die before printing the URL it needs.
Alternatives: Exit non-zero on timeout (rejected: would block 9.9c's own diagnostic first run).
Reversible: Yes.

### 6 Nov 2026 · 9.9b idempotency via ff-only pull plus a reinstall · decided by builder · risk: low
Decided: `git pull --ff-only origin main` fails loudly on a dirty/diverged tree; `corepack pnpm install` runs right after the pull so a dependency-changing commit doesn't surface as a confusing module-resolution error during migrate/seed.
Why: `docker compose up -d --build`, `db:migrate` and `pnpm seed` are already idempotent per try-it.md; the pull/install steps needed the same guarantee made explicit.
Alternatives: None — matches the existing idempotency pattern.
Reversible: Yes.

### 6 Nov 2026 · 9.9b live-demo.md's env block lists every human-filled var, covers B-69 · decided by lead · risk: low
Decided: `docs/live-demo.md`'s `docker/.env` block (post-approval amendment) now lists `AUTH_SECRET`, `EDMATE_ANTHROPIC_API_KEY` and the four `S3_*` vars in one place, states `EDMATE_ANTHROPIC_API_KEY` is the human's own key filled by hand only, and explains why the `S3_*` vars must be non-default (B-69: the live overlay must not fall back to the dev stack's placeholder S3 values).
Why: Direct human instruction naming the exact vars and the B-69 requirement.
Alternatives: None — a direct instruction.
Reversible: Yes, doc-only.

### 6 Nov 2026 · 9.9b live-demo.md's env block adds Resend vars per B-25 · decided by lead · risk: low
Decided: `docs/live-demo.md`'s `docker/.env` block also lists `EMAIL_SERVER`/`EMAIL_FROM` (Resend), with the verified-domain caveat and a Mailpit-fallback option.
Why: B-25 (human decision, 21 Oct 2026): the live site's sign-in mail goes through Resend, not Mailpit.
Alternatives: None — a direct instruction.
Reversible: Yes, doc-only.
