# The always-on agent VM on Azure

One Azure Linux VM runs the team lead, the dev stack and the worktrees, so the team no longer stops
when the Mac sleeps. It is the same Claude Code team, the same repo, hooks and merge gate; only the
machine changes. Human decision, 4 Nov 2026 (plan: the "Always-on agent team on Azure" doc).

What it does not change: the subscription's usage allowance is pooled per account, so the VM makes
the team available around the clock, not bigger. Foundry remains the backup for a closed window
(`docs/backup-provider.md`), billed to the Azure credit.

**Rules**
- The repo is public. Nothing under `infra/azure/` holds a secret, an IP address or a login. The
  clone URL comes from your checkout's git origin at create time. Logins happen by hand over SSH
  and stay on the VM.
- The VM has no inbound port except SSH, by key, from your current IP only. Remote Control from the
  phone needs no inbound port.
- The Azure subscription keeps its spending limit on; the VM runs inside the monthly credit
  (about $90 a month for a Standard_D2s_v5 with its disk at list prices; set EDMATE_VM_SIZE=Standard_D4s_v5 for about $160 if the dev stack and three builders need more than 8 GB).
- The VM never serves pilot students. It is the build machine; deploy is task 13.6.

## 1. Create the VM (from your Mac, about 15 minutes)

```bash
az login                                   # opens the browser once
az account list -o table                   # find the subscription with the credit
az account set --subscription "<its name>"
cd ~/edmate && git pull
infra/azure/create-vm.sh
```

The script creates a resource group `edmate-agents` in East US 2, a Standard_D2s_v5 (2 vCPU, 8 GB, plus a 6 GB swap file)
Ubuntu 24.04 VM named `edmate-lead` with a 128 GB Premium SSD, a system-assigned identity, an SSH
key in `~/.ssh` if you have none, and one firewall rule: port 22 from the IP you are on now. It then
prints the SSH command. First boot runs `infra/azure/cloud-init.yaml`: Docker, Node 22 through nvm,
pnpm, GitHub CLI, tmux, Claude Code, a clone of the repo in `/opt/edmate`, and two systemd units.

Moved to another network? `infra/azure/create-vm.sh allow-here` replaces the rule with your new IP.

## 2. Wait for first boot, then check it

```bash
ssh edmate@$(infra/azure/create-vm.sh ip)
cloud-init status --wait                   # "done" after about 10 minutes
ls /var/lib/cloud/edmate-ready && docker ps && node --version && claude --version
```

If `cloud-init status` says `error`, `sudo cat /var/log/cloud-init-output.log | tail -50` shows
which step failed; the steps are safe to rerun by hand as the `edmate` user.

## 3. One-time logins (on the VM, by hand, never scripted)

Each of these stores its token in the `edmate` user's home on the VM, nowhere else.

1. **GitHub**, so the lead can push branches and open PRs:
   ```bash
   gh auth login --git-protocol https --web   # prints a code; open the URL on your phone
   gh auth setup-git
   cd /opt/edmate && gh pr list --limit 1     # proves it
   ```
   Use a bot account with a fine-grained token if you want merges not to show as you; your own
   account works the same way the Mac does today.
2. **Claude Code**, with the subscription:
   ```bash
   cd /opt/edmate && tmux new -s lead
   claude                                     # prints a login URL and a code; open it on your phone
   ```
   Pick the permission mode you use on the Mac when it asks, type one short prompt such as
   "You are the team lead; read CLAUDE.md and the board, then report status", and once it replies,
   quit with `/exit`. Leave tmux with `Ctrl-b d`.
3. **Dev stack**, so builders can run e2e and sandbox checks (optional on day one):
   ```bash
   cd /opt/edmate && cp docker/env.example docker/.env
   sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -base64 32)|" docker/.env
   sudo systemctl start edmate-stack.service   # first build takes a few minutes
   docker compose -f docker/compose.yaml ps
   ```
   Leave the model key empty unless you want real replies on the VM; see `docs/try-it.md`.
4. **Foundry backup**: copy `scripts/foundry.env.example` to
   `~/.config/edmate/foundry.env` with mode 600, fill in the resource and deployment names, leave the
   key empty, and give the VM's identity access to the Foundry resource from your Mac. This unlocks
   `scripts/claude-backup.sh`'s Linux IMDS-fetch path (`fetch_imds_token()`, `docs/backup-provider.md`):
   with no key in the config and no Mac Keychain on Linux, the script fetches a short-lived token
   from the VM's own managed identity instead of failing or asking for a login.
   ```bash
   PRINCIPAL=$(az vm show -g edmate-agents -n edmate-lead --query identity.principalId -o tsv)
   az role assignment create --assignee "$PRINCIPAL" --role "Cognitive Services User" \
     --scope "$(az cognitiveservices account show -g <foundry rg> -n <foundry resource> --query id -o tsv)"
   ```
   Then on the VM `scripts/claude-backup.sh --foundry` should start and `/status` should show
   Microsoft Foundry. If it does not, the launcher falls back to the Entra path and says so; tell the
   console session what `/status` showed.

## 4. Start the lead for good

```bash
sudo systemctl enable --now edmate-lead.service
tmux attach -t lead                        # watch it; Ctrl-b d to leave it running
```

`infra/azure/start-lead.sh` starts Claude Code inside tmux through the backup launcher, with Remote
Control on under the name `edmate-lead`, so it appears in your phone's session list. After every
restart (a closed usage window, a crash, a reboot) it resumes the last conversation and tells the
lead to check the board, blockers and worktrees and carry on. systemd restarts it 60 seconds after
it exits, and the launcher decides at each start whether the subscription or Foundry is used.

To stop it: `sudo systemctl stop edmate-lead.service`. To change what the lead is told on resume or
add Claude flags, put `EDMATE_LEAD_PROMPT` or `EDMATE_LEAD_ARGS` in a drop-in:
`sudo systemctl edit edmate-lead.service`, then an `[Service]` block with `Environment=` lines.

## 5. Wire up Monitor alerts (phase 1b)

Board task 0.25. Run these once, from your Mac where `az login` already ran (step 1) — same
subscription, no VM access needed except to drop `monitor.env` in place. Every script below
supports `DRY_RUN=1` to print the `az` command instead of running it; none of it reads or writes a
real identifier into the repo (`.claude/tests/test_no_azure_identifiers.py` enforces that on every
PR).

```bash
infra/azure/monitor-setup.sh
```
creates (if missing) a Log Analytics workspace, a Data Collection Endpoint and Rule with a custom
table `EdmateHeartbeat_CL`, and grants the VM's managed identity the "Monitoring Metrics Publisher"
role on the DCR. It prints a DCE endpoint, a DCR immutable id and a stream name at the end — paste
those three into `monitor.env` on the VM, never into the repo:

```bash
ssh edmate@$(infra/azure/create-vm.sh ip)
mkdir -p ~/.config/edmate && chmod 700 ~/.config/edmate
cp /opt/edmate/scripts/monitor.env.example ~/.config/edmate/monitor.env
chmod 600 ~/.config/edmate/monitor.env
nano ~/.config/edmate/monitor.env          # fill in the three values monitor-setup.sh printed
exit
```

Back on your Mac, create the on-call action group and the two alert rules. Set `EDMATE_ONCALL_PHONE`
and `EDMATE_ONCALL_EMAIL` in your own shell first (your phone, country code and all, and your
email — the script refuses to run without them, and never defaults to or logs a value since none
is ever known to it ahead of time):

```bash
infra/azure/monitor-action-group.sh
infra/azure/monitor-vm-down-alert.sh        # fires if the VM itself goes unreachable, 5-minute window
infra/azure/monitor-heartbeat-alert.sh      # fires if EdmateHeartbeat_CL has had no row for 2 hours
```

The heartbeat row itself comes from `.githooks/post-commit`, already active on the VM's clone
(`core.hooksPath .githooks`, set by cloud-init): every commit that touches `docs/board/tasks.yaml`
calls `infra/azure/heartbeat.sh` in the background, which writes a local timestamp file and, once
`monitor.env` exists, one row to `EdmateHeartbeat_CL`. A missing `monitor.env` or a failed Monitor
write never fails the commit — it only affects whether the alert above has anything to watch.

Add the budget alert (same subscription, from your Mac). With `EDMATE_ONCALL_EMAIL` still set from
above:

```bash
infra/azure/monitor-budget-alert.sh
```
Notifies that address at 50/80/100% of `EDMATE_MONTHLY_CREDIT` (default 90, matching the
Standard_D2s_v5 estimate above; override it if your VM size or disk differ). Skim `az consumption
budget create --help` first — its flags have moved between `az` versions.

The watcher (§6 below) ships as two systemd units, `edmate-blockers-watch.service` and
`edmate-blockers-watch.timer`. A VM created after this task merges already has them (cloud-init
copies and enables the timer; its service only fires once `monitor.env` exists, same
`ConditionPathExists` pattern as `edmate-stack.service`). An **already-created 0.24 VM** needs them
copied in by hand, once, since cloud-init only runs on first boot:

```bash
ssh edmate@$(infra/azure/create-vm.sh ip)
cd /opt/edmate && git pull
sudo cp infra/azure/edmate-blockers-watch.service infra/azure/edmate-blockers-watch.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now edmate-blockers-watch.timer
systemctl list-timers edmate-blockers-watch.timer   # shows the next 2-hour-window firing
```

## 6. The watcher: now a timer, not a session

`infra/azure/blockers-watch.sh` ports the watcher's old cadence exactly (every 2 hours, 8am–11pm
Pacific) and its trigger (an unresolved `### B-` entry under `.claude/blockers.md`'s `## Open`
heading) without an LLM in the loop: the timer runs it, and when something is open it posts one
Monitor row with a bare count (`"blocker:N"`), never the entry text — `.claude/blockers.md` is
local-only and may hold business context that must never reach a cloud log. Your own console
session keeps running on the Mac either way; once everything else runs on the VM too, retire the
Mac's `caffeinate` and its copy of the worktrees.

## 7. Day to day

| Want | Do |
| --- | --- |
| See the lead | `tmux attach -t lead` over SSH, or Remote Control on the phone |
| Lead status | `systemctl status edmate-lead.service`; its provider log is `~/.config/edmate/backup.log` |
| Restart the lead | `sudo systemctl restart edmate-lead.service` |
| Dev stack | `systemctl status edmate-stack.service`, `docker compose -f docker/compose.yaml ps` |
| Update the VM's tools | `sudo apt update && sudo apt upgrade`; `claude update`; security patches apply nightly on their own |
| Stop paying | `az vm deallocate -g edmate-agents -n edmate-lead` (disk kept); `az vm start` brings it back |
| Remove everything | `az group delete -n edmate-agents` |

## Known risks (security review, 4 Nov 2026)

- The lead runs as `edmate`, the VM's admin user: passwordless sudo and the `docker` group, so a
  prompt injection that reaches the lead could become root on the VM. This is the same trust the
  lead has on the Mac today, and the VM holds nothing the Mac does not (the same `gh` and `claude`
  logins, a public repo, a dev stack with fake data). Accepted for phase 1; task 0.25 moves the lead
  to its own unprivileged user with a narrow sudo rule for the stack.
- cloud-init installs nvm (pinned to a tag) and Claude Code with `curl | bash`, unverified. Same as
  the Mac install; rerun `claude update` on the VM when you update the Mac.
- The `gh` and `claude` tokens live unencrypted in the `edmate` home. If you retire the VM, run
  `gh auth logout` and `claude /logout` first, or revoke the GitHub token and sign out of the
  Claude session from the account page; `az group delete` alone does not revoke them.

## Not done yet

- Moving the lead off the shared `edmate` admin user (see Known risks) — not yet assigned a task
  number.
- Foundry through the managed identity is coded and unit-tested (board task 0.26, stub `curl`/`claude`
  only — no real Azure call), but the real-VM check is still outstanding: grant the role assignment
  above, then on the VM run `scripts/claude-backup.sh --foundry` and confirm `/status` shows Microsoft
  Foundry with no `ANTHROPIC_FOUNDRY_API_KEY` set.
- A pool of VMs (0.27) only once each VM has its own model budget.
