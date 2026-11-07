#!/usr/bin/env bash
# Create (if missing) the Azure Monitor plumbing heartbeat.sh and blockers-watch.sh write to: a Log
# Analytics workspace, a Data Collection Endpoint, a Data Collection Rule with a custom table
# EdmateHeartbeat_CL (TimeGenerated, Source string), and the VM's managed identity granted
# "Monitoring Metrics Publisher" on that DCR. Idempotent: every step checks before it creates.
# Operates on whatever subscription `az account show` currently has set -- never a literal
# subscription id. See docs/azure-vm.md phase 1b.
#
#   infra/azure/monitor-setup.sh            create (or find) the workspace, DCE, DCR and role grant
#   DRY_RUN=1 infra/azure/monitor-setup.sh   print the az commands instead of running them
#
# Overrides: EDMATE_RG (edmate-agents), EDMATE_LOCATION (eastus2), EDMATE_VM (edmate-lead),
# EDMATE_WORKSPACE (edmate-logs), EDMATE_DCE (edmate-heartbeat-dce), EDMATE_DCR (edmate-heartbeat-dcr).
set -euo pipefail

RG="${EDMATE_RG:-edmate-agents}"
LOC="${EDMATE_LOCATION:-eastus2}"
VM="${EDMATE_VM:-edmate-lead}"
WORKSPACE="${EDMATE_WORKSPACE:-edmate-logs}"
DCE="${EDMATE_DCE:-edmate-heartbeat-dce}"
DCR="${EDMATE_DCR:-edmate-heartbeat-dcr}"
TABLE="EdmateHeartbeat_CL"
DRY="${DRY_RUN:-0}"

say() { printf 'monitor-setup: %s\n' "$*" >&2; }

run() {
  if [ "$DRY" = "1" ]; then
    printf 'monitor-setup: would run: %s\n' "$*"
    return 0
  fi
  "$@"
}

ensure_workspace() {
  if [ "$DRY" = "1" ] || ! az monitor log-analytics workspace show -g "$RG" -n "$WORKSPACE" -o none 2>/dev/null; then
    run az monitor log-analytics workspace create -g "$RG" -n "$WORKSPACE" -l "$LOC" -o none
  else
    say "workspace $WORKSPACE already exists"
  fi
}

ensure_dce() {
  if [ "$DRY" = "1" ] || ! az monitor data-collection endpoint show -g "$RG" -n "$DCE" -o none 2>/dev/null; then
    run az monitor data-collection endpoint create -g "$RG" -n "$DCE" -l "$LOC" --public-network-access Enabled -o none
  else
    say "DCE $DCE already exists"
  fi
}

ensure_dcr() {
  local ws_id dce_id
  RULE_FILE=$(mktemp)
  if [ "$DRY" = "1" ]; then
    ws_id="\$(az monitor log-analytics workspace show -g $RG -n $WORKSPACE --query id -o tsv)"
    dce_id="\$(az monitor data-collection endpoint show -g $RG -n $DCE --query id -o tsv)"
  else
    ws_id=$(az monitor log-analytics workspace show -g "$RG" -n "$WORKSPACE" --query id -o tsv)
    dce_id=$(az monitor data-collection endpoint show -g "$RG" -n "$DCE" --query id -o tsv)
  fi
  cat > "$RULE_FILE" <<JSON
{
  "location": "$LOC",
  "properties": {
    "dataCollectionEndpointId": "$dce_id",
    "streamDeclarations": {
      "Custom-$TABLE": {
        "columns": [
          { "name": "TimeGenerated", "type": "datetime" },
          { "name": "Source", "type": "string" }
        ]
      }
    },
    "destinations": { "logAnalytics": [ { "workspaceResourceId": "$ws_id", "name": "edmateWorkspace" } ] },
    "dataFlows": [
      {
        "streams": [ "Custom-$TABLE" ],
        "destinations": [ "edmateWorkspace" ],
        "outputStream": "Custom-$TABLE"
      }
    ]
  }
}
JSON
  if [ "$DRY" = "1" ] || ! az monitor data-collection rule show -g "$RG" -n "$DCR" -o none 2>/dev/null; then
    run az monitor data-collection rule create -g "$RG" -n "$DCR" --rule-file "$RULE_FILE" -o none
  else
    say "DCR $DCR already exists"
  fi
}

grant_identity() {
  local principal_id dcr_id
  if [ "$DRY" = "1" ]; then
    principal_id="\$(az vm show -g $RG -n $VM --query identity.principalId -o tsv)"
    dcr_id="\$(az monitor data-collection rule show -g $RG -n $DCR --query id -o tsv)"
  else
    principal_id=$(az vm show -g "$RG" -n "$VM" --query identity.principalId -o tsv)
    dcr_id=$(az monitor data-collection rule show -g "$RG" -n "$DCR" --query id -o tsv)
  fi
  run az role assignment create --assignee "$principal_id" --role "Monitoring Metrics Publisher" --scope "$dcr_id" -o none
}

print_summary() {
  if [ "$DRY" = "1" ]; then
    printf 'monitor-setup: would print the DCE endpoint, DCR immutable id and stream name (Custom-%s)\n' "$TABLE"
    return 0
  fi
  local dce_endpoint dcr_immutable
  dce_endpoint=$(az monitor data-collection endpoint show -g "$RG" -n "$DCE" --query logsIngestion.endpoint -o tsv)
  dcr_immutable=$(az monitor data-collection rule show -g "$RG" -n "$DCR" --query immutableId -o tsv)
  say "paste these into ~/.config/edmate/monitor.env on the VM (never into the repo):"
  say "  EDMATE_MONITOR_DCE_ENDPOINT=$dce_endpoint"
  say "  EDMATE_MONITOR_DCR_IMMUTABLE_ID=$dcr_immutable"
  say "  EDMATE_MONITOR_STREAM_NAME=Custom-$TABLE"
}

main() {
  if [ "$DRY" != "1" ]; then
    az account show -o none || { say "run 'az login' first, then 'az account set --subscription <the credit subscription>'."; exit 2; }
    say "subscription: $(az account show --query name -o tsv)"
  fi
  ensure_workspace
  ensure_dce
  ensure_dcr
  grant_identity
  print_summary
}

main "$@"
