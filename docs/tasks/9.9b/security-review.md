# 9.9b security review (advisory — not risk-paths-required)

Reviewer: security-reviewer (read-only; findings transcribed by the lead).

Verdict: **APPROVE**, no CRITICAL/HIGH blockers. One MEDIUM worth fixing before the 9.9c real run.

## Findings

- **[MEDIUM] [open]** `scripts/live-deploy.sh:27-30` — `set -a; source docker/.env; set +a` executes
  the file as bash, not as data. `docker compose` already auto-loads `docker/.env` on its own (same
  mechanism `docs/try-it.md` relies on, no sourcing needed) — the only reason `live-deploy.sh` sources
  it is to check `AUTH_SECRET`/`EDMATE_ANTHROPIC_API_KEY` presence, which doesn't need code execution.
  The repo's own more cautious precedent for this exact pattern, `scripts/claude-backup.sh:65-76`,
  checks the config file's permissions (`chmod 600`) and ownership before sourcing it; `live-deploy.sh`
  skips both checks on a secrets file sitting on an internet-facing box. Scenario: `docker/.env` ever
  becomes group/world-writable (a careless `chmod`, a shared deploy user) → any other local user's
  injected `$(...)`/backtick content in that file runs with the deploying operator's privileges on
  every rerun, silently. Fix: parse the two needed values with `grep '^AUTH_SECRET=' docker/.env | cut
  -d= -f2-` (or similar) instead of `source`, or at minimum add the same 600/ownership check
  `claude-backup.sh` already uses.
- **[INFO]** Independent secret/IP/hostname scan — zero hits beyond `127.0.0.1` loopback and
  `<your-vm-hostname>`-style placeholders in both new files.
- **[LOW, cosmetic] [open]** The log line `"pulling main"` has no branch argument on the `git pull
  --ff-only` call, so it actually pulls whatever branch is currently checked out. One-word fix
  (`git pull --ff-only origin main`, or rephrase the log line) so operators aren't misled if the VM is
  ever on a different branch.
- **[OK]** `git pull --ff-only` fails loudly on a dirty tree/diverged branch, no auto-resolve — correct
  call for an unattended production script.
- **[OK]** `curl -fsS --max-time 5` — no `-k`/`--insecure`, TLS validation intact. `$HOST` always
  double-quoted everywhere used; worst case of a bad value is a malformed URL, not an injection
  primitive (the operator supplies it themselves).
- **[OK]** No `set -x` or secret-echoing error paths; secret checks only test presence, never print
  values; `DATABASE_URL` exported but never logged.
- **[OK]** `docs/live-demo.md` never tells the operator to put a secret in a URL, query string, or
  committed file; states `docker/.env` is gitignored and never leaves the VM, to rotate (not just
  delete) if leaked, and keeps Mailpit on loopback/tailnet only.

Files reviewed: `scripts/live-deploy.sh`, `docs/live-demo.md`, plus for context `docker/env.example`,
`docs/try-it.md`, `docs/azure-vm.md`, `scripts/claude-backup.sh`.
