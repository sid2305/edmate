#!/usr/bin/env bash
# A non-LLM, systemd-timer port of the watcher's current cadence: docs/azure-vm.md's old §5 ran a
# second Claude Code session that checked .claude/blockers.md every 2 hours (8am-11pm Pacific) and
# notified the human's phone. This script makes the same check and, when true, posts a Monitor row
# with a bare open-count via the shared helper -- it never copies an entry's text anywhere (the
# file itself says "Local only (excluded from git; the repo is public)" and may hold business
# context that must stay off any cloud log). See docs/azure-vm.md phase 1b.
#
#   infra/azure/blockers-watch.sh            check .claude/blockers.md, post a row if anything is open
#   DRY_RUN=1 infra/azure/blockers-watch.sh  print the would-be POST instead of sending it
#
# Overrides: EDMATE_BLOCKERS_FILE (defaults to <repo root>/.claude/blockers.md).
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
. "$HERE/lib/monitor-ingest.sh"

BLOCKERS_FILE="${EDMATE_BLOCKERS_FILE:-$ROOT/.claude/blockers.md}"

# No blockers.md (every contributor laptop and CI: it's local-only, excluded from git) -- nothing
# to watch, exit 0 same as a clean check.
[ -f "$BLOCKERS_FILE" ] || exit 0

COUNT=$(awk '
  /^## Open/ { in_open=1; next }
  /^## / { in_open=0 }
  in_open && /^### B-/ { count++ }
  END { print count + 0 }
' "$BLOCKERS_FILE")

if [ "$COUNT" -gt 0 ]; then
  monitor_post_row "blocker:$COUNT"
fi
exit 0
