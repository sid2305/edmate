# Plan: 0.25 — VM phase 1b: heartbeat, Monitor alerts, the watcher as a timer, a budget alert

## Accept (verbatim)
"a stopped lead pages the phone within 2 hours; the watcher runs on the VM; the budget alert
exists; nothing in the repo names the subscription, IP or account."

## How this is shown, given no real Azure access
Exactly like 0.24: everything this task produces is infra-as-code (scripts, alert-rule
definitions, a systemd timer + unit + script) plus a docs/azure-vm.md section telling the human
exactly what to run, by hand, on their real subscription, to make the accept line true. The build
proves the code is correct without ever calling a real Azure API:

- every new/changed `infra/azure/*.sh` script supports a dry-run mode (`DRY_RUN=1` or `--dry-run`)
  that prints the exact `az ...` command(s) it would run and exits 0 without calling `az`, `curl`
  or the network;
- tests run each script in dry-run with fake placeholder values and assert the printed command has
  the right shape (resource names interpolated, thresholds present, no real identifier anywhere);
- a new regression test (`.claude/tests/test_no_azure_identifiers.py`) greps every committed file
  under `infra/azure/**` and `docs/azure-vm.md` for a subscription-GUID shape, an IPv4 literal, or
  a real resource name, and fails the build if one appears — this is the test that stands in for
  "nothing in the repo names the subscription, IP or account" on every future PR, not just this one;
- `bash -n` on every script proves it parses; the systemd unit/timer files are checked by grep for
  their required stanzas (`[Unit]`, `[Service]`/`[Timer]`, `[Install]`, an `OnCalendar=` line),
  the same level of rigor 0.24's own units got (no systemd available to validate against in this
  sandbox either).

docs/azure-vm.md gets a clearly marked "phase 1b: wire it up for real" section listing the human's
one-time actions on their own subscription: run `monitor-setup.sh` (workspace, DCE, DCR, role
assignment), fill in `~/.config/edmate/monitor.env` on the VM, run `monitor-action-group.sh` with
their own phone/email, run the two alert-creation scripts and the budget-alert script, copy the new
systemd units to `/etc/systemd/system/` and enable the timer. Only the human, after doing that, can
actually watch a stopped lead page their phone — the plan does not claim the build alone proves it;
it proves the code is right and ready to run.

## Required reading already done
`docs/azure-vm.md`, `infra/azure/create-vm.sh`, `infra/azure/cloud-init.yaml`,
`infra/azure/start-lead.sh`, `infra/azure/edmate-lead.service`, `infra/azure/edmate-stack.service`,
`scripts/foundry.env.example`, `.claude/blockers.md` (the watcher's current shape, last section
"Day to day" / §5 of azure-vm.md), `.claude/skills/team-lead/closeout.py` (how `docs/board/tasks.yaml`
actually gets committed — there is no git hook today that fires on a board commit; this task adds
the first one), `.githooks/pre-commit`, `.claude/skills/merge-gate/risk-paths.txt`,
`docs/lessons.md`, `docs/decisions/digest.md` (standing rules; nothing there conflicts with this
task). No existing "heartbeat on commit" mechanism exists anywhere in the repo — this task invents
it, following 0.24/0.26's shape (managed identity over any stored key, an `.example` env file
pattern for anything that must stay off the repo).

Key facts the build must follow exactly:
- §5 of `docs/azure-vm.md` says today's watcher is a second Claude Code / tmux session
  (`tmux new -s watcher`, `claude --remote-control edmate-watcher`) that "checks this file
  [`.claude/blockers.md`] every 2 hours (8am–11pm Pacific) and notifies the human's phone"
  (`.claude/blockers.md` header, line 4). The systemd-timer version is a faithful, non-LLM port of
  that cadence and that trigger condition (an unresolved entry under `.claude/blockers.md`'s
  `## Open` heading), not a new design.
- `.claude/blockers.md` line 3: "Local only (excluded from git; the repo is public)." Its entry
  text can hold business context. The watcher script must never copy blocker text into any cloud
  log or alert payload — it pages with a bare count ("N open blocker(s)"), never the entries
  themselves.
- `docs/azure-vm.md`'s "Known risks" section already flags task 0.25 by name for moving the lead
  off the shared `edmate` admin user; that is explicitly **not** in this task's scope (it is a
  separate, larger change — the board entry for 0.25 does not mention it, only heartbeat/alerts/
  watcher/budget). Leave it alone; note it as deferred in the handoff so it isn't lost.
- The VM already has a system-assigned managed identity (`create-vm.sh --assign-identity`,
  confirmed working for a role assignment in `docs/azure-vm.md` §3.4's Foundry example). Use it for
  the heartbeat's Monitor write (Azure Monitor Logs Ingestion API, an AAD bearer token from IMDS) —
  **no shared key or connection string ever written to disk**, matching 0.26's "Foundry through the
  managed identity, no key on disk" direction and avoiding inventing a new secret class.

## Scope check (per the task brief)
Entirely `infra/azure/**`, `.githooks/**`, `.claude/tests/**` and `docs/azure-vm.md`. Nothing here
touches a product code path (`apps/`, `packages/` other than reading, not writing). No change to
`apps/worker/src/alerts/**` is needed: that package is the in-product student-safety alert path
(SMS to the on-call phone for a distress escalation, B- decisions already logged); this task's
"page the phone" is a wholly separate, infra-only Azure Monitor action group. They happen to share
a notification shape (SMS + email to the same on-call phone) but are different systems and must
not be confused or merged in code.

## Files to create
- `infra/azure/heartbeat.sh` — writes an ISO-8601 timestamp line to a local state file
  (`$HOME/.local/state/edmate/heartbeat`, created if missing) and, only when
  `~/.config/edmate/monitor.env` exists, also sends one row to an Azure Monitor custom log table
  via the Logs Ingestion API: fetches a bearer token from IMDS using the VM's managed identity,
  then `curl`s the DCE endpoint with the DCR immutable ID and stream name read from that env file.
  No env file → writes the local file only and still exits 0 (this is a convenience path, not a
  safety guard — failing to reach Monitor must never block or fail a commit). Supports
  `DRY_RUN=1`: prints the token-endpoint URL and the would-be POST request line (method, URL,
  headers minus the token value, body shape) instead of calling `curl`.
- `.githooks/post-commit` (new hook; **risk path, needs security-reviewer**) — if the commit that
  just landed touched `docs/board/tasks.yaml`, calls `infra/azure/heartbeat.sh` in the background
  and never fails the commit (its own exit code is always 0; any error from heartbeat.sh is
  swallowed with a one-line stderr note). On a machine with neither the state dir's parent writable
  nor a monitor.env (every contributor laptop and CI, since hooks never run in CI), this still only
  writes a small local file under the user's own `$HOME` — never a problem for a public repo, and
  never required for anything to pass.
- `infra/azure/monitor-setup.sh` — idempotent `az` script (pattern: `create-vm.sh`'s `say()`,
  `set -euo pipefail`, overrides via `EDMATE_*` env vars, operates on whatever subscription
  `az account show` currently has set — never a literal subscription id) that creates, if missing,
  a Log Analytics workspace, a Data Collection Endpoint, a Data Collection Rule with a custom table
  `EdmateHeartbeat_CL` (columns: `TimeGenerated`, `Source` string), and grants the VM's managed
  identity the "Monitoring Metrics Publisher" role on the DCR. Prints the DCE endpoint, DCR
  immutable id and stream name at the end, for the human to paste into
  `~/.config/edmate/monitor.env` on the VM — never into the repo.
- `scripts/monitor.env.example` (mirrors `scripts/foundry.env.example`'s header and "copy this
  file OUTSIDE the repo" instructions) — the three monitor.env fields heartbeat.sh reads
  (`EDMATE_MONITOR_DCE_ENDPOINT`, `EDMATE_MONITOR_DCR_IMMUTABLE_ID`, `EDMATE_MONITOR_STREAM_NAME`),
  each left blank with a comment saying where `monitor-setup.sh` prints the real value.
- `infra/azure/monitor-action-group.sh` — idempotent `az monitor action-group create`/`update` for
  one action group `edmate-oncall` with one SMS action and one email action. Takes the phone number
  and email as required arguments or `EDMATE_ONCALL_PHONE` / `EDMATE_ONCALL_EMAIL` env vars; refuses
  with a clear message if either is unset — never defaults to or prints a real number/address
  because none is ever known to the script.
- `infra/azure/monitor-vm-down-alert.sh` — `az monitor metrics alert create` on the VM resource
  (built-in VM-availability/heartbeat metric from the Azure Monitor Agent), severity 1, 5-minute
  window, action group from above.
- `infra/azure/monitor-heartbeat-alert.sh` — `az monitor scheduled-query create`, a log-query alert
  on `EdmateHeartbeat_CL`: fires when the row count over the last 2 hours is 0, same action group.
  This is the alert that actually satisfies "no heartbeat for 2 hours" independently of whether the
  VM itself is reachable (a wedged-but-running VM still gets caught).
- `infra/azure/monitor-budget-alert.sh` — `az consumption budget create` scoped to the current
  subscription, amount from `EDMATE_MONTHLY_CREDIT` (default 90, matching the D2s_v5 estimate in
  `docs/azure-vm.md`; the human overrides it if theirs differs), three notification thresholds at
  50/80/100% of that amount, each emailing `EDMATE_ONCALL_EMAIL`. Comment at the top telling the
  human to skim `az consumption budget create --help` first, since budget CLI flags have moved
  between `az` versions.
- `infra/azure/blockers-watch.sh` — reads `.claude/blockers.md` from the repo root; true when a
  `## Open` heading is followed by at least one `### B-` entry before the next `## ` heading or EOF
  (same shape `closeout.py`/`board.py` already parse headings with, reused rather than invented).
  When true, calls `infra/azure/heartbeat.sh`'s Monitor-posting helper (factored into a small shared
  function both scripts source, so there is one Logs-Ingestion code path, not two) to write one row
  with `Source: "blocker"` and a bare open-count, never entry text. `DRY_RUN=1` behaves like
  heartbeat.sh's.
- `infra/azure/edmate-blockers-watch.service` — `Type=oneshot`, `ExecStart=.../blockers-watch.sh`,
  same `User=edmate` shape as the other two units.
- `infra/azure/edmate-blockers-watch.timer` — `OnCalendar=*-*-* 08,10,12,14,16,18,20,22:00:00`,
  `Timezone=America/Los_Angeles` (ports the "every 2 hours, 8am–11pm Pacific" cadence exactly, with
  no extra throttling logic needed in the script because the timer itself only fires 8 times a day
  in that window), `Persistent=false` (no need to catch up a missed heartbeat check after a reboot),
  `WantedBy=timers.target`.
- `.claude/tests/test_no_azure_identifiers.py` (**risk path, `.claude/**`, needs
  security-reviewer**) — greps every file under `infra/azure/**` and `docs/azure-vm.md` for a
  subscription-GUID shape (`[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}`), an IPv4 literal
  that is not a documented placeholder/example address, and the literal strings
  `EDMATE_ONCALL_PHONE=`/`EDMATE_ONCALL_EMAIL=` followed by a non-empty value (i.e. a filled-in
  example, not an env-var reference). Fails loudly (never silently skips — see the `docs/lessons.md`
  "a check that silently skips looks like a pass" lesson) if any file it expects to scan is missing.
- new fixtures under `infra/azure/test/` (a sibling to the scripts, never executed as input,
  matching the general "keep test fixtures separate from code that runs" hygiene): a fake
  `blockers.md` with an open entry, one with only a resolved entry, and a fake `monitor.env` with
  placeholder (obviously-fake) values for the dry-run tests to point `HOME`/the env file path at.

## Files to modify
- `docs/azure-vm.md` — a new "phase 1b" section (after §4, before §5) listing the human's one-time
  setup commands in order (monitor-setup.sh → fill in monitor.env → monitor-action-group.sh → the
  three alert-creation scripts → copy+enable the new systemd units), replacing §5's "run the watcher
  as a second Claude session" text with "the watcher now runs as a timer; see phase 1b" and a short
  note for an **already-created** 0.24 VM: cloud-init only runs once, so copy the three new files
  under `/etc/systemd/system/` and `systemctl daemon-reload` by hand. Remove the "Azure Monitor
  alerts... and a heartbeat line: board task 0.25" line from "Not done yet" and replace it with the
  one line still open after this task (moving the lead off the shared admin user, if still true).
- `infra/azure/cloud-init.yaml` — add the two new unit files to the `cp`/`systemctl enable` lines
  for a *new* VM created after this task merges, conditioned the same way `edmate-stack.service` is
  (`ConditionPathExists=.../monitor.env` on the timer's service, so a freshly created VM without
  monitor.env configured yet simply never fires it, no error).
- `infra/azure/create-vm.sh`'s header comment — one line noting the new `EDMATE_MONTHLY_CREDIT`,
  `EDMATE_ONCALL_PHONE`, `EDMATE_ONCALL_EMAIL` overrides live in the phase-1b scripts, not here (no
  behaviour change to this file itself).

## Out of bounds
Anything under `apps/`, `packages/` (other than reading for context), `content/`, `evals/`. No
change to `apps/worker/src/alerts/**` (see Scope check above). No change to the shared-admin-user
risk noted in `docs/azure-vm.md`'s "Known risks" (separate, larger task). No real `az`, `curl` to a
real endpoint, or `docker`/`systemctl` invocation against a live system, by any agent.

## Tests first
1. `bash -n` every new/changed `.sh` file.
2. `heartbeat.sh` under a temp `HOME`: (a) no monitor.env → local file written, line matches
   `^\d{4}-\d{2}-\d{2}T`, exit 0, nothing printed that looks like a URL; (b) a fixture monitor.env
   with placeholder (fake) DCE/DCR/stream values + `DRY_RUN=1` → exit 0, stdout contains the
   placeholder values verbatim (proving they were read, not hardcoded) and the literal IMDS token
   URL, never a real token (there is none to leak).
3. `blockers-watch.sh` against the two fixtures: the "has an open entry" fixture triggers the
   Monitor-write helper in `DRY_RUN=1` (assert the dry-run line shows `Source: blocker` and a count,
   never the fixture's entry text); the "only resolved" fixture does not trigger it at all.
4. Each `monitor-*.sh` script in `DRY_RUN=1` with fake env values: assert the printed `az` command
   contains the expected flags (table/DCR/action-group/metric names, the 50/80/100 thresholds for
   the budget script) and exit 0; assert none of the fake values used in the test look like a real
   Azure identifier (the test's own fixture data is obviously fake, e.g. `000...0` GUIDs and
   `10.0.0.1`-shaped-but-documented-as-fake addresses, so this doesn't trip test 5 below on the test
   file itself — keep fixtures in `infra/azure/test/`, scanned separately, never claimed as "the
   repo never names an account" subjects since they are visibly placeholders).
5. `.claude/tests/test_no_azure_identifiers.py` over the real committed files (not the test
   fixtures) — must pass clean.
6. `post-commit` hook: a throwaway git repo in a temp dir (never the real repo) with `core.hooksPath`
   pointed at a copy of `.githooks/`, one commit that touches a `docs/board/tasks.yaml`-shaped path
   and one that doesn't, asserting the hook only fires (calls a stubbed `heartbeat.sh`) on the first
   and that `git commit`'s own exit code is 0 either way even if the stub is made to fail.
7. Grep check on the two new unit files for required stanzas (`[Unit]`, `[Service]` or `[Timer]`,
   `[Install]`, and `OnCalendar=`/`Timezone=` on the timer) since no systemd is available here to
   validate them for real.
8. `python3 .githooks/secret-scan.py --all` and `python3 .claude/skills/merge-gate/merge_gate.py 0.25`
   before handoff, as usual.

## Risky paths touched (checked against risk-paths.txt)
- `.githooks/**` (new `post-commit`) → reviewers: security-reviewer
- `.claude/**` (new `.claude/tests/test_no_azure_identifiers.py`) → reviewers: security-reviewer
  (same reviewer as above; one pass covers both)
- `infra/azure/**`, `docs/azure-vm.md`, `scripts/monitor.env.example` are **not** in
  risk-paths.txt — not a listed risky-path group. The board already marks 0.25 `risk: risky`
  (a planning-stage flag, separate from the merge-gate path list), so the lead still logs a
  `risk: high` decision at merge regardless of which paths matched, per rule 6.
- No contracts change, no ADR needed (rule 2 does not apply: no change to `packages/contracts`,
  the tech stack, or prompt-pack behaviour).

## Open questions
None blocking. One note for the human, non-blocking: `docs/azure-vm.md`'s own "Known risks" lists
moving the lead off the shared `edmate` admin user under task 0.25's name, but the board entry for
0.25 only asks for heartbeat/alerts/watcher/budget. This plan leaves that risk exactly as it stands
today and flags it in the handoff so a future task (not invented here) can pick it up — say if you
want it folded into this task instead before the build starts.

## Phase A (~130 tool calls)
`infra/azure/heartbeat.sh`, `.githooks/post-commit`, `scripts/monitor.env.example`,
`monitor-setup.sh`, `monitor-action-group.sh`, `monitor-vm-down-alert.sh`,
`monitor-heartbeat-alert.sh`, the shared Monitor-posting helper heartbeat.sh and blockers-watch.sh
both source, `.claude/tests/test_no_azure_identifiers.py`, the heartbeat/hook/monitor-script tests
(1, 2, 4 partial — the alert scripts other than budget, 5, 6, 7's `[Service]` unit only doesn't
exist yet — skip), and the matching half of the `docs/azure-vm.md` phase-1b section (setup through
the two alert rules). Green commit; state after this phase: heartbeat and the two Monitor alerts
are code-complete and dry-run tested; the watcher and the budget alert are not yet built.

## Phase B (~90 tool calls)
`infra/azure/blockers-watch.sh`, `infra/azure/edmate-blockers-watch.service`,
`infra/azure/edmate-blockers-watch.timer`, `infra/azure/monitor-budget-alert.sh`, the remaining
fixtures and tests (3, 4's budget-script case, 7's timer/service check), `infra/azure/cloud-init.yaml`
and `infra/azure/create-vm.sh`'s header-comment update, and the rest of the `docs/azure-vm.md`
phase-1b section (watcher units, budget alert, the "already have a 0.24 VM" note, the §5 rewrite,
the "Not done yet" line). Reads this plan and Phase A's handoff first. Green commit; state after
this phase: every deliverable in the board entry is code-complete, tested the way Tests first
describes, and `docs/azure-vm.md` tells the human exactly what to run for real.

## Budget
Budget: 220 tool calls (2 phases, infra/azure + .githooks + .claude/tests + docs)

## Allowed tools
Read, Grep, Glob, Write, Edit, Bash (bash -n syntax checks; running the new dry-run tests and
fixtures under a temp HOME/temp git repo; `python3 .githooks/secret-scan.py --all`; `python3
.claude/skills/merge-gate/merge_gate.py 0.25`; no `az`, `curl` to a live endpoint, `docker`, or
`systemctl` against a real system)

## Exit conditions
Status: DONE when both phases' scripts pass their dry-run tests, the no-azure-identifiers test and
secret scan are clean, the merge gate passes, and docs/azure-vm.md's phase-1b section is complete.
Status: PARTIAL if a phase passes roughly 150 tool calls without finishing, or if anything surfaces
that would need a real `az` call, a live VM, or a file outside this plan's list to verify (stop,
commit what's green, hand off naming exactly what's left).
