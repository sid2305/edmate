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
  (about $160 a month for a Standard_D4s_v5 with its disk at list prices, less with a reservation).
- The VM never serves pilot students. It is the build machine; deploy is task 13.6.

## 1. Create the VM (from your Mac, about 15 minutes)

```bash
az login                                   # opens the browser once
az account list -o table                   # find the subscription with the credit
az account set --subscription "<its name>"
cd ~/edmate && git pull
infra/azure/create-vm.sh
```

The script creates a resource group `edmate-agents` in East US 2, a Standard_D4s_v5 (4 vCPU, 16 GB)
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
4. **Foundry backup** (optional, phase 2): copy `scripts/foundry.env.example` to
   `~/.config/edmate/foundry.env` with mode 600, fill in the resource and deployment names, leave the
   key empty, and give the VM's identity access to the Foundry resource from your Mac:
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

## 5. Move the console and watcher (when you are ready)

Your own console session can keep running on the Mac. The blockers watcher is a Claude session
today; run it on the VM the same way as the lead (`tmux new -s watcher`, `claude --remote-control
edmate-watcher`), or leave it on the Mac until the Mac's role ends. Once everything runs on the VM,
retire the Mac's `caffeinate` and its copy of the worktrees.

## 6. Day to day

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

- Azure Monitor alerts (VM down, lead idle) and a heartbeat line: board task 0.25.
- Foundry through the managed identity is wired but untested until the role assignment above runs:
  board task 0.26.
- A pool of VMs (0.27) only once each VM has its own model budget.
