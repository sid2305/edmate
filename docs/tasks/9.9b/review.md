# 9.9b review — APPROVE
Reviewers: code-reviewer, security-reviewer

Round 2: all findings below fixed by builder-9-9b (commit 973bc1df) and independently re-verified
by a second code-reviewer pass, which reproduced both the original clobber and the fix in a scratch
shell. No new issues found. See docs/tasks/9.9b/security-review.md for the security-reviewer's
advisory pass (APPROVE, 1 MEDIUM + 1 LOW, both fixed in the same round).

## Findings

- [HIGH] [fixed] scripts/live-deploy.sh:22-30 — `EDMATE_PUBLIC_HOST` is resolved and exported on
  line 22-24 (`HOST="${1:-${EDMATE_PUBLIC_HOST:-}}"; export EDMATE_PUBLIC_HOST="$HOST"`), then
  `source docker/.env` runs *after* that with `set -a` on (line 27-30). If `docker/.env` ever
  defines `EDMATE_PUBLIC_HOST` (not true of today's `docker/env.example`, but nothing in the
  script or the doc prevents it — e.g. a stale copy-paste between VMs), sourcing silently
  overwrites the exported env var with the `.env` value, while the script's own `$HOST` variable
  (used for the final `say "live at: https://$HOST"` and the health-check curl target) keeps the
  originally-resolved value. Reproduced directly:
  ```
  export EDMATE_PUBLIC_HOST="correct-host.example.test"
  # docker.env.test contains: EDMATE_PUBLIC_HOST=stale-from-dotenv.example.test
  set -a; source docker.env.test; set +a
  # EDMATE_PUBLIC_HOST is now "stale-from-dotenv.example.test"; $HOST is still "correct-host..."
  ```
  Any compose/Caddy interpolation of `${EDMATE_PUBLIC_HOST}` (the var docker compose actually
  reads from the process environment) would then build the live stack for the wrong host, while
  the script prints and health-checks the right one — directly contradicting decision 2 and the
  plan's accept line ("`EDMATE_PUBLIC_HOST` comes only from `$1` or the shell env var, never from
  `docker/.env`"). Fix: re-assert `export EDMATE_PUBLIC_HOST="$HOST"` immediately after the
  `source docker/.env` block (or source `.env` before resolving `$HOST`).

- [MEDIUM] [fixed] scripts/live-deploy.sh:48 and docs/live-demo.md:53 — both say the health check
  "waits up to two minutes", but the loop is 24 iterations of `curl --max-time 5` + `sleep 5`
  (line 50-56), i.e. up to 24 × 10s = 240s (~4 minutes) in the worst case, not 2 minutes. Not a
  hang (still bounded) and not fatal (matches decision 5's "soft, non-fatal" design), but the
  stated bound is off by ~2x, which could make an operator think something hung sooner than it
  actually has. Fix: correct the comment/doc, or halve the retry count/sleep to match "two
  minutes".

- [MEDIUM] [fixed] scripts/live-deploy.sh:43-45 — the loopback-postgres overlay
  (`-f docker/compose.yaml -f packages/db/test/compose.port.yaml up -d postgres`, decision 1) omits
  the `-f docker/compose.live.yaml` flag used one line earlier (line 40) to bring the live stack
  up. `docker/compose.live.yaml` doesn't exist yet (9.9a), so this can't be verified today, but if
  it ever touches the `postgres` service's definition (network, volumes, env), this second `up -d
  postgres` call resolves a *different* merged config for that service than the one the live stack
  is actually running under, which can make compose recreate/reconfigure the already-running
  postgres container — a state-churn risk for an already-live stack, not just an idempotent no-op.
  Worth a one-line comment in the script (or flagging to 9.9a/9.9c) stating the constraint this
  decision depends on: `compose.live.yaml` must not redefine the `postgres` service.

- [MEDIUM] [fixed] scripts/live-deploy.sh:27-30 — `source docker/.env` with CRLF line endings (e.g.
  the file was ever edited/copied from Windows) bakes a trailing `\r` into every sourced value.
  Reproduced:
  ```
  printf 'AUTH_SECRET=abc123\r\n...' > crlf.env; set -a; source crlf.env; set +a
  # $AUTH_SECRET is "abc123\r" (7 bytes), confirmed with xxd
  ```
  The `[ -n ... ]` checks (line 32-34) still pass (non-empty), so this doesn't fail at validation.
  If any of `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` are present in the same file (they
  are, in `docker/env.example`'s defaults), the corrupted value flows into the `DATABASE_URL` built
  on line 44 and `db:migrate`/`pnpm seed` fail — loudly (meets the "fails loudly" requirement) but
  with a confusing low-level error that won't point at "check your line endings". Low-cost fix:
  strip `\r` after sourcing (`AUTH_SECRET="${AUTH_SECRET%$'\r'}"` etc.) or note the Windows-editing
  pitfall in docs/live-demo.md's troubleshooting section.

- [LOW] [fixed] scripts/live-deploy.sh:36-40 — `git pull --ff-only` is not followed by `corepack
  pnpm install`. A rerun after a commit that changes a workspace package's dependencies will pull
  new code but keep stale `node_modules` on the host, so the host-run `db:migrate`/`pnpm seed`
  steps (line 45-46) can fail with a module-resolution error rather than something that points at
  "run `pnpm install`". Not corrupting state (fails loudly), just undocumented. Consider adding
  `corepack pnpm install` after the pull, or a troubleshooting entry.

- [MEDIUM] [fixed] scripts/live-deploy.sh:27-30 (security-reviewer) — sourcing `docker/.env` as
  bash without a permission/ownership check, unlike `scripts/claude-backup.sh:65-76`'s precedent.
  Fixed: a permission/ownership check now gates the source, mirroring `claude-backup.sh`.
- [LOW] [fixed] scripts/live-deploy.sh (security-reviewer, cosmetic) — the `"pulling main"` log
  line didn't match the `git pull --ff-only` call (no branch argument). Fixed: the pull now passes
  an explicit `origin main` and the log line matches.

## Verification performed
- `bash -n scripts/live-deploy.sh` — passes.
- Independent `grep -nE` scan of `docs/live-demo.md` and `scripts/live-deploy.sh` for IPv4
  patterns, bare hostnames (`.com`/`.io`/`.dev`/etc.), and `KEY=value` secret assignments —
  confirms the handoff's claim: every hit is `127.0.0.1` (loopback, per decision 1/the doc's own
  Mailpit/port-forward text) or a `<placeholder>`; zero real IPs/hostnames/secrets.
- Read `docs/try-it.md` in full and diff-checked every command live-demo.md claims to mirror
  (`db:grant-role`, `db:verify-teacher`, `storage:roundtrip`, sample-lesson upload path,
  `/api/health`) — all match try-it.md's real invocations exactly, with the overlay `-f` flags
  updated consistently for the live stack.
- Confirmed `docker/compose.live.yaml`/`docker/Caddyfile.live` do not exist yet in this worktree
  (9.9a not merged) — matches the plan's explicit allowance.
- Reproduced the `git pull --ff-only` dirty-tree failure in a scratch repo (two clones, divergent
  commits, local uncommitted edit) — confirmed it exits 1 ("Your local changes ... would be
  overwritten by merge"), so the script's `die` on that line fires as claimed.
- Reproduced the `EDMATE_PUBLIC_HOST` clobber (HIGH finding above) and the CRLF corruption (MEDIUM
  finding above) in a scratch shell, both outside the repo.
- Confirmed the exact two `-f` flags on the `up -d --build` line (compose.yaml,
  compose.live.yaml) and that `EDMATE_PUBLIC_HOST` has no literal default anywhere in the script.

## Decisions
None — no new design decisions from this review; all findings were fixed in the one fix round
and re-verified.
