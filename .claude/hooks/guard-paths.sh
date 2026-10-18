#!/bin/bash
# PreToolUse(Edit|Write|MultiEdit|NotebookEdit): hard blocks on file writes (build plan rule 5).
#   deny  -> secrets and key files (.env, .env.*, except examples; .pem, .key, credentials)
input=$(cat)
path=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$input")
[ -z "$path" ] && exit 0
# Agent worktrees live under .claude/worktrees/<name>/ — match on the repo-relative part.
rel=$(sed -E 's#^.*/\.claude/worktrees/[^/]+/##; s#^'"${CLAUDE_PROJECT_DIR:-$PWD}"'/##' <<<"$path")

decide() { jq -n --arg d "$1" --arg r "$2" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'; exit 0; }

base=$(basename "$rel")
if [[ "$base" =~ ^\.env($|\.) && ! "$base" =~ example ]]; then
  decide deny "Edmate rule 5: never write secrets files ($rel). Use docker/env.example for documented variables."
fi
if [[ "$base" =~ \.(pem|key|p12|pfx)$ || "$base" =~ ^(id_rsa|id_ed25519|credentials\.json|service-account) ]]; then
  decide deny "Never write key or credential files ($rel) into the repo; keep them outside it (e.g. ~/.edmate-bot/)."
fi
# No "ask" rules: the team lead decides merges after the required reviewers (human decision,
# 18 Oct 2026). Risky paths are enforced at merge time by merge_gate.py, not at edit time.
exit 0
