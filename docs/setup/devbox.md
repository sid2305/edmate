# Always-on devbox (VM) for the agent team

An always-on Linux VM runs the team lead and its agents for hours, with nothing depending on your laptop staying awake. You watch and steer from the Claude app on your phone through Remote Control. Move here after the task 0.1 dry run and the GitHub setup (`docs/setup/github.md`). Nothing secret goes in this file or in the repo.

## 1. The machine
- **OS:** Ubuntu 24.04 LTS.
- **Size:** 4 vCPU, 8–16 GB RAM, 80 GB disk. That covers Docker Compose (Postgres, Redis, MinIO, web, worker) plus up to 3 parallel builders.
- **Provider:** any. Pick a region near you for low latency; the production region is a separate decision.
- **Access:** SSH keys only, no password login. No inbound ports except SSH; better still, reach SSH over a private network such as Tailscale. Remote Control needs no inbound ports, because the VM connects out.
- **Cost control:** stop or snapshot the VM when no build is running.

## 2. Install (on the VM, as a normal user with sudo)
```bash
sudo apt update && sudo apt install -y git jq tmux python3 python3-yaml unattended-upgrades
# Docker Engine + Compose plugin: follow docs.docker.com/engine/install/ubuntu, then:
sudo usermod -aG docker "$USER"
# Node 22 via nvm, pnpm via corepack
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash   # check the current install command on github.com/nvm-sh/nvm
source ~/.nvm/nvm.sh && nvm install 22
# Claude Code and the GitHub CLI
npm install -g @anthropic-ai/claude-code
# gh: follow github.com/cli/cli/blob/trunk/docs/install_linux.md
```
On the VM, global installs are fine: the VM exists only for this project. The "no global changes" rule protects your Mac.

## 3. What goes on the VM, and what never does
| Goes on the VM | Never on the VM |
| --- | --- |
| The bot's GitHub App private key, in `~/.edmate-bot/` (chmod 600) | Your personal GitHub token or SSH key |
| Dev-only model provider keys **with spending limits**, in `~/.edmate/env` (outside the repo) | Production keys, payment provider live keys |
| Your Claude Code login (needed for Remote Control) | Your email, other projects, browser sessions |

## 4. Get the repo and connect
```bash
git clone https://github.com/sid2305/edmate.git ~/edmate   # once the repo exists; pushes go through the bot token
cd ~/edmate && git config core.hooksPath .githooks          # secret scan on every commit
tmux new -s edmate                                          # survives SSH disconnects
claude                                                      # log in the first time
# inside Claude Code:  /rc   → open the link in the Claude app
```
Detach with `Ctrl-b d`; the session keeps running. Re-attach with `tmux attach -t edmate`.

## 5. Keep it healthy
- `unattended-upgrades` on for security patches; reboot during a quiet window.
- Snapshot before big changes. The repo is the source of truth, so a lost VM loses only work in progress.
- Rotate the bot key and dev model keys if the VM is ever shared or compromised. Rotate first, then clean up.
