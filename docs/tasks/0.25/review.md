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

No hardcoded credentials or real Azure identifiers in the diff itself. `.githooks/post-commit`
always exits 0 and never blocks a commit (confirmed by security-reviewer: no injection via file
paths/branch names, which are only used in a static `grep -qx` match, never eval'd; IMDS token is
never printed or logged). `blockers-watch.sh`/`monitor-ingest.sh` post only a bare open-count, never
`.claude/blockers.md` entry text, matching the stated safety requirement.

A second, independent security-reviewer pass found that `test_no_azure_identifiers.py`'s own regex
coverage had a real gap (see the HIGH finding below, now fixed) — the first-pass claim that its
regexes were comprehensive was itself incomplete; corrected here.

## Findings

- [HIGH] [fixed] .claude/tests/test_no_azure_identifiers.py:18-20 — the regex set (`GUID_RE`,
  `IPV4_RE`, `ONCALL_FILLED_RE`) had no pattern for hostname-shaped Azure identifiers. Verified: a
  real DCE endpoint (`https://edmate-prod-dce-xk29.eastus-1.ingest.monitor.azure.com`) and a bare
  `*.monitor.azure.com` URL both returned no hit — exactly the data `monitor-setup.sh` prints to the
  human's terminal for pasting into `~/.config/edmate/monitor.env`, and exactly the shape a future
  doc edit (e.g. a "here's what it looks like" example in `docs/azure-vm.md`) could leak into this
  public repo with no test or secret-scan pattern catching it. Fixed in commit `e39b3bc6`: added
  `AZURE_FQDN_RE` (scanned the same way as `GUID_RE`/`IPV4_RE`), with an allowlist for the one fixed
  `monitor.azure.com` AAD resource-URI constant already in `infra/azure/lib/monitor-ingest.sh` (and
  its percent-encoded form). Added regression tests proving it catches the two real-hostname
  fixtures above and does not flag the repo's existing legitimate content. Resource-group/VM-name
  patterns were deliberately left uncovered — `edmate-agents`/`edmate-lead` are the repo's own fixed,
  already-public documented names, indistinguishable from a real secret by regex alone; not a gap
  worth a brittle rule. Re-verified: `python3 -m unittest discover .claude/tests` → 390/390 OK;
  `python3 .githooks/secret-scan.py --all` → clean.

- [MEDIUM] [deferred 0.25b] infra/azure/lib/monitor-ingest.sh:26 — `. "$env_file"` sources the human-edited
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

- [MEDIUM] [deferred 0.25b] infra/azure/lib/monitor-ingest.sh:46,51 — neither the IMDS token request nor the
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
  `.claude/tests/`): 21/21 passed (pre-fix); 390/390 on the full suite post-fix (see below).
- `python3 -m unittest discover -v .claude/tests` (repo root): 390/390 passed, post-fix.
- `python3 .githooks/secret-scan.py --all`: clean.
- `python3 .claude/skills/merge-gate/merge_gate.py 0.25`: fails only on the pre-review checks this
  file resolves; no other failures once this file is present.

The HIGH finding above is fixed and re-verified. The two MEDIUM findings are real but narrow in
trigger (a malformed human-edited `monitor.env`, or a network stall) rather than routine-operation
bugs; deferred to board task `0.25b` per the merge gate's own rule (build plan rule 6) rather than
holding up this merge, given the human's live-demo priority (6 Nov 2026).
