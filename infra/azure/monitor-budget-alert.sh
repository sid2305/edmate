#!/usr/bin/env bash
# Budget CLI flags have moved between az versions -- skim `az consumption budget create --help`
# on your installed az before relying on this script against a real subscription.
#
# Idempotent create of a monthly consumption budget on the current subscription, with email
# notifications at 50/80/100% of the amount. See docs/azure-vm.md phase 1b.
#
#   infra/azure/monitor-budget-alert.sh
#   DRY_RUN=1 infra/azure/monitor-budget-alert.sh   print the az command instead of running it
#
# Overrides: EDMATE_MONTHLY_CREDIT (90, matching the D2s_v5 estimate in docs/azure-vm.md),
# EDMATE_ONCALL_EMAIL (required; refuses without it, same as monitor-action-group.sh).
set -euo pipefail

AMOUNT="${EDMATE_MONTHLY_CREDIT:-90}"
EMAIL="${EDMATE_ONCALL_EMAIL:-}"
BUDGET="edmate-monthly-budget"
DRY="${DRY_RUN:-0}"

say() { printf 'monitor-budget-alert: %s\n' "$*" >&2; }

if [ -z "$EMAIL" ]; then
  say "set EDMATE_ONCALL_EMAIL before running this (no default -- none is ever known to this script)."
  exit 2
fi

sub_id_expr='$(az account show --query id -o tsv)'
CMD=(az consumption budget create-or-update --budget-name "$BUDGET"
  --amount "$AMOUNT" --time-grain Monthly
  --scope "/subscriptions/$sub_id_expr"
  --notifications "{
    \"Actual_50\": {\"enabled\": true, \"operator\": \"GreaterThanOrEqualTo\", \"threshold\": 50, \"contactEmails\": [\"$EMAIL\"]},
    \"Actual_80\": {\"enabled\": true, \"operator\": \"GreaterThanOrEqualTo\", \"threshold\": 80, \"contactEmails\": [\"$EMAIL\"]},
    \"Actual_100\": {\"enabled\": true, \"operator\": \"GreaterThanOrEqualTo\", \"threshold\": 100, \"contactEmails\": [\"$EMAIL\"]}
  }")

if [ "$DRY" = "1" ]; then
  printf 'monitor-budget-alert: would run: %s\n' "${CMD[*]}"
  exit 0
fi

az account show -o none || { say "run 'az login' first, then 'az account set --subscription <the credit subscription>'."; exit 2; }
SUB_ID=$(az account show --query id -o tsv)
az consumption budget create-or-update --budget-name "$BUDGET" \
  --amount "$AMOUNT" --time-grain Monthly \
  --scope "/subscriptions/$SUB_ID" \
  --notifications "{
    \"Actual_50\": {\"enabled\": true, \"operator\": \"GreaterThanOrEqualTo\", \"threshold\": 50, \"contactEmails\": [\"$EMAIL\"]},
    \"Actual_80\": {\"enabled\": true, \"operator\": \"GreaterThanOrEqualTo\", \"threshold\": 80, \"contactEmails\": [\"$EMAIL\"]},
    \"Actual_100\": {\"enabled\": true, \"operator\": \"GreaterThanOrEqualTo\", \"threshold\": 100, \"contactEmails\": [\"$EMAIL\"]}
  }" -o none
say "budget $BUDGET ready (\$$AMOUNT/month, 50/80/100% notifications to $EMAIL)."
