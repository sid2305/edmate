# 0.25 handoff — VM phase 1b: heartbeat, Monitor alerts, the watcher as a timer, a budget alert

Status: DONE

## What changed

### Phase A — heartbeat, the post-commit hook, Monitor setup + the two alert scripts
- `infra/azure/lib/monitor-ingest.sh` (new, sourced only, no shebang/exec bit): one shared
  `monitor_post_row(source_value)` — reads `~/.config/edmate/monitor.env` (or
  `EDMATE_MONITOR_ENV_FILE`), returns 0 silently if it's missing or incomplete, otherwise gets an
  IMDS bearer token from the VM's managed identity and POSTs one row to the Logs Ingestion API.
  `DRY_RUN=1` prints the token endpoint and the would-be request (method/URL/headers minus the
  token/body) instead of calling `curl`. Both `heartbeat.sh` and `blockers-watch.sh` source this —
  one Logs-Ingestion code path, not two, per the plan.
- `infra/azure/heartbeat.sh` (new): writes an ISO-8601 line to
  `$HOME/.local/state/edmate/heartbeat` (local file, always, regardless of Monitor), then calls
  `monitor_post_row "heartbeat"`.
- `scripts/monitor.env.example` (new): the three `monitor.env` fields, blank, mirroring
  `scripts/foundry.env.example`'s header/"copy this file outside the repo" convention.
- `.githooks/post-commit` (new, risk path): if the commit that just landed touched
  `docs/board/tasks.yaml`, backgrounds `heartbeat.sh` and always exits 0.
- `infra/azure/monitor-setup.sh` (new): idempotent workspace/DCE/DCR/role-grant creation, prints
  the three values the human pastes into `monitor.env` on the VM.
- `infra/azure/monitor-action-group.sh` (new): idempotent `edmate-oncall` action group; refuses
  (exit 2) without a phone and email, from args or `EDMATE_ONCALL_PHONE`/`EDMATE_ONCALL_EMAIL`.
- `infra/azure/monitor-vm-down-alert.sh`, `infra/azure/monitor-heartbeat-alert.sh` (new): the two
  alert rules described in the plan.
- `.claude/tests/test_no_azure_identifiers.py` (new, risk path): greps every file under
  `infra/azure/**` (excluding `infra/azure/test/`) and `docs/azure-vm.md` for a subscription-GUID
  shape, a real IPv4 literal (allowlisting only the fixed IMDS address `169.254.169.254`), or a
  filled-in `EDMATE_ONCALL_PHONE=`/`EDMATE_ONCALL_EMAIL=`. Raises (never silently skips) if
  `infra/azure/` or `docs/azure-vm.md` go missing.
- `infra/azure/test/monitor.env.fake` (new fixture): obviously-fake DCE/DCR/stream values.
- `.claude/tests/test_vm_heartbeat_and_alerts.py` (new): `BashSyntax`, `HeartbeatScript`,
  `MonitorScripts`, `PostCommitHook` — all dry-run/stub, no real `az`/`curl`/`systemctl`.
- `docs/azure-vm.md`: new §5 "Wire up Monitor alerts (phase 1b)" (setup through the two alert
  rules); old §5/§6 renumbered to §6/§7.

### Phase B — the watcher as a timer, the budget alert, the rest of the docs
- `infra/azure/blockers-watch.sh` (new): reads `.claude/blockers.md` (override:
  `EDMATE_BLOCKERS_FILE`, missing file → exit 0, nothing to watch); an awk pass counts `### B-`
  entries between a `## Open` heading and the next `## ` heading/EOF (same heading shape
  `closeout.py` already parses). Count > 0 → `monitor_post_row "blocker:<N>"` — a bare count only,
  never entry text, since `.claude/blockers.md` is local-only and may hold business context.
- `infra/azure/edmate-blockers-watch.service` (new): `Type=oneshot`, `User=edmate`,
  `ConditionPathExists=%h/.config/edmate/monitor.env` (systemd's own home-dir specifier, not a
  hardcoded path under the admin user's home — the pre-commit hook's secret-scan rejected a
  spelled-out version of that path as a personal-home pattern even though `edmate` is the shared
  service account, not a person; the specifier sidesteps that cleanly and is the more correct form
  anyway).
- `infra/azure/edmate-blockers-watch.timer` (new): `OnCalendar=*-*-* 08,10,12,14,16,18,20,22:00:00`,
  `Timezone=America/Los_Angeles`, `Persistent=false`, `WantedBy=timers.target` — the same "every 2
  hours, 8am-11pm Pacific" cadence the old Claude-session watcher ran.
- `infra/azure/monitor-budget-alert.sh` (new): `az consumption budget create-or-update`, amount
  from `EDMATE_MONTHLY_CREDIT` (default 90), three notification thresholds (50/80/100%) to
  `EDMATE_ONCALL_EMAIL`; refuses (exit 2) without the email.
- `infra/azure/test/blockers-open.md`, `infra/azure/test/blockers-resolved.md` (new fixtures).
- `.claude/tests/test_vm_heartbeat_and_alerts.py`: added `BlockersWatch` (open-fixture posts
  `"blocker:2"` and never the fixture's entry text; resolved-only fixture posts nothing; a missing
  blockers file exits 0 and posts nothing), `SystemdUnits` (grep for `[Unit]`/`[Service]`/
  `[Timer]`/`[Install]`, `OnCalendar=`, `Timezone=`), and `MonitorScripts.test_monitor_budget_alert_*`.
- `infra/azure/cloud-init.yaml`: the two new unit files added to the `cp`/`daemon-reload` lines;
  `systemctl enable edmate-blockers-watch.timer` added (its own service's `ConditionPathExists`
  makes this a no-op on a VM without `monitor.env` yet).
- `infra/azure/create-vm.sh`: one header-comment line noting `EDMATE_MONTHLY_CREDIT`/
  `EDMATE_ONCALL_PHONE`/`EDMATE_ONCALL_EMAIL` live in the phase-1b scripts, not here (no behaviour
  change).
- `docs/azure-vm.md`: §5 extended with the budget-alert command and the "already have a 0.24 VM"
  note (copy the two unit files by hand, `daemon-reload`, enable the timer); §6 rewritten from
  "move the console and watcher" to "the watcher: now a timer, not a session"; "Not done yet"'s
  0.25 line replaced with the still-open admin-user item (see Decisions below).

## Gate

- `bash -n` on every new/changed `.sh` file and `.githooks/post-commit`: clean.
- `cd .claude/tests && python3 -m unittest -v test_vm_heartbeat_and_alerts test_no_azure_identifiers`:
  21/21 passed; re-run 10+ times back to back (including after the two bug fixes below) with no
  flakes.
- `python3 -m unittest discover -v .claude/tests` (full suite, repo root, matching CI's invocation):
  388/388 passed.
- `python3 .githooks/secret-scan.py --all`: clean.
- `python3 .claude/skills/merge-gate/merge_gate.py 0.25`: fails at check 2 (no `review.md` yet) — expected
  at this stage; nucleus runs the reviewers (code-reviewer, typescript-reviewer, security-reviewer
  for the `.githooks/**`/`.claude/**` risk paths) and the gate from here, per the task assignment.

## Decisions

### 6 Nov 2026 · 0.25 the shared-admin-user risk stays deferred, out of scope · decided by builder · risk: low
- Decided: left `docs/azure-vm.md`'s "Known risks" bullet about moving the lead off the shared
  `edmate` admin user exactly as it stands; did not fold that work into this task.
- Why: the plan's "Open questions" flags this by name as a separate, larger change the board entry
  for 0.25 never asked for (only heartbeat/alerts/watcher/budget). "Not done yet" now names it as
  the one open item in that area so it isn't lost; a future task should pick it up.

### 6 Nov 2026 · 0.25 blockers-watch.sh's file path is overridable via EDMATE_BLOCKERS_FILE · decided by builder · risk: low
- Decided: added an `EDMATE_BLOCKERS_FILE` override (default `<repo root>/.claude/blockers.md`),
  matching the `EDMATE_MONITOR_ENV_FILE` override `heartbeat.sh` already has.
- Why: the plan didn't name an env var for this, but the dry-run tests need to point the script at
  a fixture without touching the real (local-only, untracked) `blockers.md`; this mirrors an
  existing convention rather than inventing a new one.

### 6 Nov 2026 · 0.25 docs use a plain env-var-export instruction, not inline VAR="value" · decided by builder · risk: low
- Decided: `docs/azure-vm.md`'s phase-1b section tells the human to set `EDMATE_ONCALL_PHONE`/
  `EDMATE_ONCALL_EMAIL` in their own shell first, rather than writing `EDMATE_ONCALL_EMAIL="<your
  email>" some-script.sh` inline in the doc.
- Why: `test_no_azure_identifiers.py`'s `ONCALL_FILLED_RE` (by design) flags the literal pattern
  `EDMATE_ONCALL_EMAIL=`/`EDMATE_ONCALL_PHONE=` followed by any non-empty text, to catch a real
  filled-in contact ever landing in the repo. A bracketed placeholder used inline as
  `VAR="<placeholder>"` trips the same regex even though it's obviously a placeholder; rewording to
  an export-first instruction avoids a false positive without weakening the check.

### 6 Nov 2026 · 0.25 risk: high (merge path) · decided by builder, pending lead confirmation at merge · risk: high
- Decided: this task touches two risk-paths.txt groups (`.githooks/**` for the new `post-commit`
  hook; `.claude/**` for `test_no_azure_identifiers.py`), both requiring security-reviewer; the
  board already marks 0.25 `risk: risky`. Logging this here per rule 6/the plan's "Risky paths
  touched" section so the merge gate's check 5 has an entry to find; nucleus should confirm (or
  amend) this when review.md lands.
- Why: rule 6 requires the handoff's `## Decisions` to carry a `### ... risk: high` entry before a
  risky-path change can merge.

## Left to do

Nothing in this task's scope. Nucleus still needs to: run code-reviewer, typescript-reviewer and
security-reviewer; write `docs/tasks/0.25/review.md`; re-run
`python3 .claude/skills/merge-gate/merge_gate.py 0.25` until it passes; merge; log the decisions
above (plus any from review) to `docs/decisions/log.md`.

## Budget

Tool calls used: 210 (approximate -- not programmatically counted on this host; in line with the
plan's 220-call cap across both phases, Phase A close to its ~130 estimate and Phase B close to
its ~90).
