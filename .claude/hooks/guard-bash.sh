#!/bin/bash
# PreToolUse(Bash): hard git and secrets blocks for many agents on one repo. No "ask" rules.
input=$(cat)
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
cwd=$(jq -r '.cwd // empty' <<<"$input")
decide() { jq -n --arg d "$1" --arg r "$2" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'; exit 0; }

if grep -qE "git\s+push\b.*(\s-f\b|--force\b|--force-with-lease)" <<<"$cmd"; then
  decide deny "No force pushes: other agents and reviewers may be on this branch."
fi
# Agents may push main (the human's decision, 18 Oct 2026), but the public repo gets a secret scan first.
if grep -qE "git\s+push\b.*\s(origin\s+)?(main|HEAD:main)(\s|$)" <<<"$cmd"; then
  scan=$(cd "${CLAUDE_PROJECT_DIR:-$PWD}" && python3 .githooks/secret-scan.py --all 2>&1) || \
    decide deny "Secret scan flagged files; fix them before pushing main (the repo is public):
$scan"
fi
# No asks for merges or commits on main: the team lead decides (human decision, 18 Oct 2026).

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
if grep -qE "(^|[[:space:]/'\"])\.env(\.[A-Za-z0-9_-]+)?([[:space:]]|$|['\"])" <<<"$cmd" && ! grep -q "example" <<<"$cmd"; then
  decide deny "Command touches a .env file, which may hold real keys. Use env.example for documented variables."
fi
exit 0
