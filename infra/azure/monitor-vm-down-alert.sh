#!/usr/bin/env bash
# Idempotent create of the "VM down" metric alert: the built-in VM-availability heartbeat metric
# from the Azure Monitor Agent, severity 1, a 5-minute window, firing to the edmate-oncall action
# group. Catches the VM itself being unreachable; monitor-heartbeat-alert.sh catches a wedged-but-
# running VM independently. See docs/azure-vm.md phase 1b.
#
#   infra/azure/monitor-vm-down-alert.sh
#   DRY_RUN=1 infra/azure/monitor-vm-down-alert.sh   print the az command instead of running it
#
# Overrides: EDMATE_RG (edmate-agents), EDMATE_VM (edmate-lead), EDMATE_ACTION_GROUP (edmate-oncall).
set -euo pipefail

RG="${EDMATE_RG:-edmate-agents}"
VM="${EDMATE_VM:-edmate-lead}"
GROUP="${EDMATE_ACTION_GROUP:-edmate-oncall}"
ALERT="edmate-vm-down"
DRY="${DRY_RUN:-0}"

say() { printf 'monitor-vm-down-alert: %s\n' "$*" >&2; }

vm_id_expr="\$(az vm show -g $RG -n $VM --query id -o tsv)"
ag_id_expr="\$(az monitor action-group show -g $RG -n $GROUP --query id -o tsv)"

CMD=(az monitor metrics alert create -g "$RG" -n "$ALERT"
  --scopes "$vm_id_expr"
  --condition "avg VmAvailabilityMetric < 1"
  --severity 1
  --window-size 5m --evaluation-frequency 5m
  --action "$ag_id_expr")

if [ "$DRY" = "1" ]; then
  printf 'monitor-vm-down-alert: would run: %s\n' "${CMD[*]}"
  exit 0
fi

az account show -o none || { say "run 'az login' first, then 'az account set --subscription <the credit subscription>'."; exit 2; }
VM_ID=$(az vm show -g "$RG" -n "$VM" --query id -o tsv)
AG_ID=$(az monitor action-group show -g "$RG" -n "$GROUP" --query id -o tsv)
az monitor metrics alert create -g "$RG" -n "$ALERT" \
  --scopes "$VM_ID" \
  --condition "avg VmAvailabilityMetric < 1" \
  --severity 1 \
  --window-size 5m --evaluation-frequency 5m \
  --action "$AG_ID" -o none
say "alert $ALERT ready (severity 1, 5-minute window, action group $GROUP)."
