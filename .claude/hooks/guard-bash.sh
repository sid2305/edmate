#!/bin/bash
# PreToolUse(Bash): git safety for many agents on one repo (rule 1: one task, one branch, one PR).
input=$(cat)
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
cwd=$(jq -r '.cwd // empty' <<<"$input")
decide() { jq -n --arg d "$1" --arg r "$2" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'; exit 0; }

if grep -qE "git\s+push\b.*(\s-f\b|--force\b|--force-with-lease)" <<<"$cmd"; then
  decide deny "No force pushes: other agents and reviewers may be on this branch."
fi
if grep -qE "git\s+push\b.*\s(origin\s+)?(main|HEAD:main)(\s|$)" <<<"$cmd"; then
  decide deny "Never push to main. Push the task branch (m<milestone>/<task-id>-<slug>) and open a PR."
fi
if grep -qE "git\s+(merge|rebase)\b" <<<"$cmd" && [ "$(git -C "${cwd:-.}" branch --show-current 2>/dev/null)" = main ]; then
  decide ask "Merging into main locally. PR merges are a human call — confirm."
fi
if grep -qE "git\s+commit\b" <<<"$cmd" && [ "$(git -C "${cwd:-.}" branch --show-current 2>/dev/null)" = main ]; then
  # The team lead's own bookkeeping (board, decision log) may go straight to main; anything else asks.
  files=$( { git -C "${cwd:-.}" diff --cached --name-only; git -C "${cwd:-.}" diff --name-only; } 2>/dev/null | sort -u)
  if [ -z "$files" ] || grep -qvE '^docs/(board|decisions)/' <<<"$files"; then
    decide ask "Committing directly on main. Only docs/board/ and docs/decisions/ updates go straight to main; task work belongs on a task branch."
  fi
fi

# Only the human adds `human-approved` (the risky-PR sign-off). Agents may not add or forge it.
if grep -qE "human-approved" <<<"$cmd" && grep -qE "\bgh\b" <<<"$cmd"; then
  decide deny "Only the user adds the human-approved label. Ask them to review the PR instead."
fi

# Merges go through the merge gate (docs/architecture.html § Merge policy).
if grep -qE "\bgh\s+pr\s+merge\b" <<<"$cmd"; then
  pr=$(grep -oE "gh\s+pr\s+merge\s+#?[0-9]+" <<<"$cmd" | grep -oE "[0-9]+$")
  [ -z "$pr" ] && decide deny "Pass the PR number explicitly (gh pr merge <number> --squash) so the merge gate can check it."
  out=$(cd "${CLAUDE_PROJECT_DIR:-$PWD}" && python3 .claude/skills/merge-gate/merge_gate.py --pr "$pr" 2>&1); rc=$?
  [ $rc -eq 0 ] || decide deny "Merge gate did not pass (exit $rc):
$out"
fi
if grep -qE "(^|[\s/'\"])\.env(\.[A-Za-z0-9_-]+)?(\s|$|['\"])" <<<"$cmd" && ! grep -q "example" <<<"$cmd"; then
  decide ask "Command touches a .env file, which may hold real keys."
fi
exit 0
