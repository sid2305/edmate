#!/usr/bin/env bash
# Start the Edmate team lead on the VM: Claude Code in a tmux session named "lead", through the
# backup launcher (subscription first, Foundry on a usage limit), with Remote Control on so the
# human can attach from a phone. Used by edmate-lead.service and by hand. See docs/azure-vm.md.
#
#   infra/azure/start-lead.sh           start the lead if it is not running
#   tmux attach -t lead                 watch or type into it; Ctrl-b d detaches
#
# EDMATE_LEAD_PROMPT   what the lead is told when it resumes after a restart
# EDMATE_LEAD_ARGS     extra claude flags, space separated (e.g. a permission mode)
set -euo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO"
export PATH="$HOME/.local/bin:$PATH"
# shellcheck disable=SC1091
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"

PROMPT="${EDMATE_LEAD_PROMPT:-Resumed on the VM after a restart. Check the board, the blockers file and the running worktrees, finish or restart what was in flight, then carry on as team lead.}"
# Claude Code keeps this directory's conversations here; with none yet, start fresh so the human can log in.
SESSIONS="$HOME/.claude/projects/$(printf '%s' "$REPO" | tr '/' '-')"

if [ "${1:-}" = "--inner" ]; then
  # shellcheck disable=SC2206
  extra=(${EDMATE_LEAD_ARGS:-})
  if [ -d "$SESSIONS" ] && ls "$SESSIONS"/*.jsonl >/dev/null 2>&1; then
    exec scripts/claude-backup.sh --remote-control edmate-lead "${extra[@]}" --continue "$PROMPT"
  fi
  exec scripts/claude-backup.sh --remote-control edmate-lead "${extra[@]}"
fi

if tmux has-session -t lead 2>/dev/null; then
  echo "lead is already running: tmux attach -t lead"
  exit 0
fi
tmux new-session -d -s lead -c "$REPO" \
  "'$REPO/infra/azure/start-lead.sh' --inner; echo 'lead exited; systemd restarts it in 60 s'; sleep 60"
echo "lead started in tmux: tmux attach -t lead"
