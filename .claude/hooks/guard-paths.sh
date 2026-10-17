#!/bin/bash
# PreToolUse(Edit|Write|MultiEdit|NotebookEdit): enforce build-plan rules 2, 5 and 6 on file writes.
#   deny  -> secrets files (.env, .env.*, except examples)
#   ask   -> frozen contracts, safety code/content, the spec docs, this harness config
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
case "$rel" in
  packages/contracts/*)
    decide ask "Rule 2: packages/contracts is frozen after M0 (task 0.3). Changing it needs a human-approved ADR in docs/adr/." ;;
  packages/harness/src/guardrails/*|content/prompt-packs/*|content/skills/*|evals/suites/safety/*|evals/suites/locked/*)
    decide ask "Rule 6: safety-critical path ($rel). Needs safety-reviewer + your human-approved label on the PR." ;;
  packages/harness/src/access/*|packages/payments/*|apps/web/app/api/webhooks/*)
    decide ask "Rule 6: access filter or payments code ($rel). Needs security-reviewer + your human-approved label on the PR." ;;
  docs/edmate-prd.md|docs/edmate-harness-build-plan.md)
    decide ask "These are the spec. Tech stack / contracts changes need an ADR; task-status edits belong in docs/board/tasks.yaml." ;;
  .claude/settings.json|.claude/hooks/*)
    decide ask "Editing the agent harness config itself ($rel)." ;;
esac
exit 0
