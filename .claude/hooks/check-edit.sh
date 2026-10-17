#!/bin/bash
# PostToolUse(Edit|Write|MultiEdit): fast checks whose failure is fed back to Claude (exit 2).
#   1. Rule 3 — packages/harness must not import frameworks, DB, queues or provider SDKs (ports only).
#   2. Rule 5 — no credentials or personal data in files (.githooks/secret-scan.py).
input=$(cat)
path=$(jq -r '.tool_input.file_path // empty' <<<"$input")
[ -z "$path" ] || [ ! -f "$path" ] && exit 0
rel=$(sed -E 's#^.*/\.claude/worktrees/[^/]+/##; s#^'"${CLAUDE_PROJECT_DIR:-$PWD}"'/##' <<<"$path")
problems=""

if [[ "$rel" == packages/harness/* && "$rel" =~ \.(ts|tsx|mts|cts)$ ]]; then
  bad=$(grep -nE "(from|import\(|require\()\s*['\"](next|next/[^'\"]*|react-dom[^'\"]*|drizzle-orm[^'\"]*|pg|postgres|ioredis|redis|bullmq|ai|@ai-sdk/[^'\"]*|openai|@anthropic-ai/[^'\"]*|@google/gen[^'\"]*|@openrouter/[^'\"]*)['\"]" "$path")
  [ -n "$bad" ] && problems+="Rule 3 (harness stays pure): packages/harness may only depend on @edmate/contracts and ports — move this to db/gateway/worker and inject it:
$bad
"
fi

# Same scanner as the git pre-commit hook and CI, so the three never disagree.
secrets=$(python3 "${CLAUDE_PROJECT_DIR:-$PWD}/.githooks/secret-scan.py" "$path" | grep -E '^  \S')
[ -n "$secrets" ] && problems+="Rule 5: possible credentials or personal data in $rel (the repo is public). Remove it and load secrets from the environment or the key vault; only fake test data may carry a 'secret-scan: allow <reason>' marker:
$secrets
"

[ -z "$problems" ] && exit 0
echo "$problems" >&2
exit 2
