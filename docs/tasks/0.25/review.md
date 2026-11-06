# Review: 0.25 — VM phase 1b (heartbeat, Monitor alerts, systemd watcher, budget alert)

Verdict: APPROVE

Reviewers: code-reviewer, security-reviewer

## Summary
Reviewed the full diff against `main` in a throwaway worktree. Ran `bash -n` implicitly via the
task's own test suite, `python3 -m unittest -v test_vm_heartbeat_and_alerts test_no_azure_identifiers`
(21/21 passed), the full `python3 -m unittest discover -v .claude/tests` (388/388 passed),
`python3 .githooks/secret-scan.py --all` (clean) and `python3 .claude/skills/merge-gate/merge_gate.py
0.25` (fails only on the expected pre-review checks: missing `review.md` and the
`.claude/tests/test_no_azure_identifiers.py` risk-path reviewer line, both resolved by this file).
All claims in `docs/tasks/0.25/handoff.md`'s Gate section were independently reproduced.

No CRITICAL issues found: no hardcoded credentials, no real Azure identifiers in the diff
(`test_no_azure_identifiers.py` scans correctly and its allowlist for the IMDS constant
`169.254.169.254` is the only IPv4 literal present), the `.githooks/post-commit` hook always exits
0 and never logs blocker entry text, and `blockers-watch.sh`/`monitor-ingest.sh` post only a bare
count, never `.claude/blockers.md` entry text, matching the stated safety requirement.

## Findings

- [MEDIUM] [open] infra/azure/lib/monitor-ingest.sh:26 — `. "$env_file"` sources the human-edited
  `monitor.env` while `set -e` is active (inherited from the callers, `heartbeat.sh` and
  `blockers-watch.sh`, both `set -euo pipefail`). The file's own header comment (lines 5-6) promises
  "every exit path returns 0", but a malformed `monitor.env` line (a shell syntax error, or any
  value written as a failing command substitution, e.g. `EDMATE_MONITOR_DCE_ENDPOINT=$(something
  that fails)`) makes the `.` builtin return non-zero, and under `set -e` that propagates immediately
  out of `monitor_post_row`, aborting the whole script before it reaches its own `exit 0` — verified
  locally: a one-line malformed sourced file makes an equivalent `set -euo pipefail` script exit 2
  instead of continuing. For `blockers-watch.sh` (run unattended by the `edmate-blockers-watch.timer`
  every 2 hours) this means a single bad edit to `~/.config/edmate/monitor.env` silently stops the
  blocker page from ever firing again — the one thing this task's accept line ("a stopped lead pages
  the phone") actually depends on for that mechanism — with no secondary alert watching for the
  watcher's own failure. Fix: wrap the source with `set +e; . "$env_file"; local rc=$?; set -e;
  [ "$rc" -eq 0 ] || { printf '...skipping\n' >&2; return 0; }` (or source in a way that can't abort
  the caller) so a malformed env file degrades to the same "skip the Monitor write" path a missing
  file already takes.

- [MEDIUM] [open] infra/azure/lib/monitor-ingest.sh:46,51 — neither the IMDS token request nor the
  DCE POST sets a `curl` timeout (`--max-time`/`--connect-timeout`). `heartbeat.sh` is started
  detached and unsupervised from `.githooks/post-commit` (`( ... & )`, no parent waits on it); if
  either `curl` call hangs on a network stall rather than failing outright, that backgrounded process
  never exits, and a long-lived VM accumulates one such process per affected `docs/board/tasks.yaml`
  commit — a slow resource leak with no automatic recovery. (`blockers-watch.sh`'s systemd oneshot
  path is partially protected by systemd's default `TimeoutStartSec`, but the hook-triggered path has
  no such backstop.) Fix: add `--max-time` to both `curl` invocations.

## Notes (not findings, confirmed correct)
- `edmate-blockers-watch.service`'s `ConditionPathExists=%h/.config/edmate/monitor.env` is a new
  pattern in this repo (existing units use absolute paths) but is valid systemd usage given
  `User=edmate` is set in the same unit's `[Service]` section; not flagging.
- `blockers-watch.sh`'s awk pass and the `monitor_post_row` call ordering (count computed before any
  Monitor write) were checked against both fixtures (`blockers-open.md` → count 2, `blockers-resolved.md`
  → count 0) and match.
- `test_no_azure_identifiers.py`'s regexes were checked against every line actually in the diff for
  false positives/negatives (GUID shape, IPv4 shape, `EDMATE_ONCALL_PHONE=`/`EDMATE_ONCALL_EMAIL=`
  filled-in values) — no gaps found for the files this task adds.
- `docs/azure-vm.md`'s new phase-1b section and `create-vm.sh ip` usage were checked and are correct
  (the `ip` subcommand already exists on `main`).

## Gate reproduction
- `python3 -m unittest -v test_vm_heartbeat_and_alerts test_no_azure_identifiers` (from
  `.claude/tests/`): 21/21 passed.
- `python3 -m unittest discover -v .claude/tests` (repo root): 388/388 passed.
- `python3 .githooks/secret-scan.py --all`: clean.
- `python3 .claude/skills/merge-gate/merge_gate.py 0.25`: fails only on the pre-review checks this
  file resolves (missing `review.md`, missing security-reviewer line); no other failures.

Both MEDIUM findings are real but narrow (they require a malformed human-edited `monitor.env` or a
network stall, not routine operation) and don't block merge; recommend a small follow-up fix before
or shortly after this merges, since the whole point of this task is unattended alerting reliability.
