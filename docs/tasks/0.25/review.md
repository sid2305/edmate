# Review: 0.25 — APPROVE

Reviewers: code-reviewer, security-reviewer

## Summary
Reviewed the full diff against `main` in a throwaway worktree. Ran
`python3 -m unittest -v test_vm_heartbeat_and_alerts test_no_azure_identifiers` (21/21 passed), the
full `python3 -m unittest discover -v .claude/tests` (388/388 passed), `python3
.githooks/secret-scan.py --all` (clean) and `python3 .claude/skills/merge-gate/merge_gate.py 0.25`
(fails only on the pre-review checks this file resolves: missing `review.md`, missing the
`security-reviewer` line for the `.claude/**`/`.githooks/**` risk paths). All claims in
`docs/tasks/0.25/handoff.md`'s Gate section were independently reproduced.

No CRITICAL or HIGH issues found: no hardcoded credentials, no real Azure identifiers in the diff
(`test_no_azure_identifiers.py`'s regexes were checked against every line this task adds and
correctly allowlist only the fixed IMDS constant `169.254.169.254`), the `.githooks/post-commit`
hook always exits 0 and never blocks a commit, and `blockers-watch.sh`/`monitor-ingest.sh` post only
a bare open-count, never `.claude/blockers.md` entry text, matching the stated safety requirement.

## Findings

- [MEDIUM] [open] infra/azure/lib/monitor-ingest.sh:26 — `. "$env_file"` sources the human-edited
  `monitor.env` while `set -e` is active (inherited from the callers, `heartbeat.sh` and
  `blockers-watch.sh`, both `set -euo pipefail`). The file's own header comment (lines 5-6) promises
  "every exit path returns 0", but a malformed `monitor.env` line (a shell syntax error, or any value
  written as a failing command substitution, e.g. `EDMATE_MONITOR_DCE_ENDPOINT=$(something that
  fails)`) makes the `.` builtin return non-zero, and under `set -e` that propagates immediately out
  of `monitor_post_row`, aborting the whole script before it reaches its own `exit 0`. Verified
  locally with an equivalent `set -euo pipefail` script: a one-line malformed sourced file makes it
  exit 2 instead of continuing past the source line. For `blockers-watch.sh` (run unattended by
  `edmate-blockers-watch.timer` every 2 hours) this means a single bad edit to
  `~/.config/edmate/monitor.env` silently stops the blocker page from ever firing again — the
  mechanism this task's accept line ("a stopped lead pages the phone") depends on for the watcher —
  with no secondary alert watching for the watcher's own failure (unlike the heartbeat path, which is
  self-detecting via `monitor-heartbeat-alert.sh`'s "no row in 2h" check). Scenario: human copies
  `monitor-setup.sh`'s printed values into `monitor.env` but leaves a stray unescaped character or a
  failing substitution on one line → every future `blockers-watch.sh` run (and `heartbeat.sh` run)
  exits non-zero before posting anything, with only a systemd-journal/background-process failure as
  evidence. Fix: wrap the source so it can't abort the caller, e.g. `set +e; . "$env_file"; local
  rc=$?; set -e; [ "$rc" -eq 0 ] || { printf '...skipping\n' >&2; return 0; }`.

- [MEDIUM] [open] infra/azure/lib/monitor-ingest.sh:46,51 — neither the IMDS token request nor the
  DCE POST sets a `curl` timeout (`--max-time`/`--connect-timeout`). `heartbeat.sh` is started
  detached and unsupervised from `.githooks/post-commit` (`( ... & )`, no parent waits on it); if
  either `curl` call hangs on a network stall rather than failing outright, that backgrounded process
  never exits, and a long-lived VM accumulates one such process per affected
  `docs/board/tasks.yaml` commit — a resource leak with no automatic recovery. (`blockers-watch.sh`'s
  systemd oneshot path is partly protected by systemd's default `TimeoutStartSec`; the hook-triggered
  `heartbeat.sh` path has no such backstop.) Fix: add `--max-time` to both `curl` invocations.

## Notes (not findings, confirmed correct)
- `edmate-blockers-watch.service`'s `ConditionPathExists=%h/.config/edmate/monitor.env` is a new
  pattern in this repo (existing units use absolute paths) but is valid systemd usage given
  `User=edmate` is set in the same unit's `[Service]` section.
- `blockers-watch.sh`'s awk pass and the `monitor_post_row` call ordering (count computed before any
  Monitor write) were checked against both fixtures (`blockers-open.md` → count 2,
  `blockers-resolved.md` → count 0) and match the handoff's claims.
- `docs/azure-vm.md`'s new phase-1b section and its `infra/azure/create-vm.sh ip` usage were checked;
  `ip` is an existing subcommand on `main`, not invented by this task.

## Gate reproduction
- `python3 -m unittest -v test_vm_heartbeat_and_alerts test_no_azure_identifiers` (from
  `.claude/tests/`): 21/21 passed.
- `python3 -m unittest discover -v .claude/tests` (repo root): 388/388 passed.
- `python3 .githooks/secret-scan.py --all`: clean.
- `python3 .claude/skills/merge-gate/merge_gate.py 0.25`: fails only on the pre-review checks this
  file resolves; no other failures once this file is present.

Both findings are real but narrow in trigger (a malformed human-edited `monitor.env`, or a network
stall) rather than routine-operation bugs, so they don't change the verdict to CHANGES_REQUESTED;
left [open] for the lead to fix, defer, or mark [wontfix] with a decision entry per the merge gate's
own rule (build plan rule 6).
