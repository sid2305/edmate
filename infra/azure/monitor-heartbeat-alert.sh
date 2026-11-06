#!/usr/bin/env bash
# Idempotent create of the log-query alert that fires when EdmateHeartbeat_CL has had no rows for
# 2 hours, to the edmate-oncall action group. This is the alert that actually satisfies "no
# heartbeat for 2 hours" independently of whether the VM itself is reachable (a wedged-but-running
# VM still gets caught; monitor-vm-down-alert.sh catches the VM being unreachable). See
# docs/azure-vm.md phase 1b.
#
#   infra/azure/monitor-heartbeat-alert.sh
#   DRY_RUN=1 infra/azure/monitor-heartbeat-alert.sh   print the az command instead of running it
#
# Overrides: EDMATE_RG (edmate-agents), EDMATE_WORKSPACE (edmate-logs), EDMATE_ACTION_GROUP (edmate-oncall).
set -euo pipefail

RG="${EDMATE_RG:-edmate-agents}"
WORKSPACE="${EDMATE_WORKSPACE:-edmate-logs}"
GROUP="${EDMATE_ACTION_GROUP:-edmate-oncall}"
ALERT="edmate-heartbeat-missing"
QUERY='EdmateHeartbeat_CL | where TimeGenerated > ago(2h) | summarize Rows = count()'
DRY="${DRY_RUN:-0}"

say() { printf 'monitor-heartbeat-alert: %s\n' "$*" >&2; }

ws_id_expr="\$(az monitor log-analytics workspace show -g $RG -n $WORKSPACE --query id -o tsv)"
ag_id_expr="\$(az monitor action-group show -g $RG -n $GROUP --query id -o tsv)"

CMD=(az monitor scheduled-query create -g "$RG" -n "$ALERT"
  --scopes "$ws_id_expr"
  --condition "count 'Rows' < 1"
  --condition-query "Rows=$QUERY"
  --evaluation-frequency 15m --window-size 2h
  --severity 1
  --action-groups "$ag_id_expr")

if [ "$DRY" = "1" ]; then
  printf 'monitor-heartbeat-alert: would run: %s\n' "${CMD[*]}"
  exit 0
fi

az account show -o none || { say "run 'az login' first, then 'az account set --subscription <the credit subscription>'."; exit 2; }
WS_ID=$(az monitor log-analytics workspace show -g "$RG" -n "$WORKSPACE" --query id -o tsv)
AG_ID=$(az monitor action-group show -g "$RG" -n "$GROUP" --query id -o tsv)
az monitor scheduled-query create -g "$RG" -n "$ALERT" \
  --scopes "$WS_ID" \
  --condition "count 'Rows' < 1" \
  --condition-query "Rows=$QUERY" \
  --evaluation-frequency 15m --window-size 2h \
  --severity 1 \
  --action-groups "$AG_ID" -o none
say "alert $ALERT ready (0 rows over 2h, action group $GROUP)."
