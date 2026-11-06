#!/usr/bin/env bash
# Writes a local heartbeat timestamp and, only when the VM has monitor.env configured, sends one
# row to Azure Monitor (Logs Ingestion API, via the shared helper in lib/monitor-ingest.sh). The
# post-commit hook calls this in the background on every docs/board/tasks.yaml commit; reaching
# Monitor is a convenience path, never a safety guard, so this script always exits 0. See
# docs/azure-vm.md phase 1b.
#
#   infra/azure/heartbeat.sh            write the heartbeat, post to Monitor if configured
#   DRY_RUN=1 infra/azure/heartbeat.sh  same, but print the would-be Monitor request instead of sending it
#
# EDMATE_STATE_DIR overrides the local state directory ($HOME/.local/state/edmate); tests use it
# to point HOME-shaped paths at a temp dir without touching the real $HOME.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
. "$HERE/lib/monitor-ingest.sh"

STATE_DIR="${EDMATE_STATE_DIR:-$HOME/.local/state/edmate}"
STATE_FILE="$STATE_DIR/heartbeat"

mkdir -p "$STATE_DIR"
date -u +%Y-%m-%dT%H:%M:%SZ > "$STATE_FILE"

monitor_post_row "heartbeat"
exit 0
