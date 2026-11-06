#!/usr/bin/env bash
# Idempotent create/update of one Azure Monitor action group, "edmate-oncall": one SMS action and
# one email action, both reaching the human's own phone/email. Every alert script
# (monitor-vm-down-alert.sh, monitor-heartbeat-alert.sh, monitor-budget-alert.sh) points at this
# group. Operates on whatever subscription `az account show` currently has set. See
# docs/azure-vm.md phase 1b.
#
#   infra/azure/monitor-action-group.sh <phone> <email>
#   infra/azure/monitor-action-group.sh                  (reads EDMATE_ONCALL_PHONE/EDMATE_ONCALL_EMAIL)
#   DRY_RUN=1 infra/azure/monitor-action-group.sh ...     print the az command instead of running it
#
# Refuses with a clear message if either the phone or the email is unset: this script never
# defaults to or prints a real number or address, because none is ever known to it in advance.
# Overrides: EDMATE_RG (edmate-agents), EDMATE_ACTION_GROUP (edmate-oncall).
set -euo pipefail

RG="${EDMATE_RG:-edmate-agents}"
GROUP="${EDMATE_ACTION_GROUP:-edmate-oncall}"
PHONE="${1:-${EDMATE_ONCALL_PHONE:-}}"
EMAIL="${2:-${EDMATE_ONCALL_EMAIL:-}}"
DRY="${DRY_RUN:-0}"

say() { printf 'monitor-action-group: %s\n' "$*" >&2; }

if [ -z "$PHONE" ] || [ -z "$EMAIL" ]; then
  say "need a phone and an email: pass them as arguments, or set EDMATE_ONCALL_PHONE/EDMATE_ONCALL_EMAIL."
  exit 2
fi

# Country code only, digits, no punctuation (az's --sms-receivers wants country-code and
# phone-number separately); the human passes e.g. "1 5551234567".
read -r COUNTRY_CODE NUMBER <<<"$PHONE"
if [ -z "${NUMBER:-}" ]; then
  say "phone must be \"<country-code> <number>\", e.g. \"1 5551234567\"."
  exit 2
fi

CMD=(az monitor action-group create -g "$RG" -n "$GROUP" --short-name edmate
  --action sms oncall-sms "$COUNTRY_CODE" "$NUMBER"
  --action email oncall-email "$EMAIL")

if [ "$DRY" = "1" ]; then
  printf 'monitor-action-group: would run: %s\n' "${CMD[*]}"
  exit 0
fi

az account show -o none || { say "run 'az login' first, then 'az account set --subscription <the credit subscription>'."; exit 2; }
"${CMD[@]}" -o none
say "action group $GROUP ready (SMS + email to the on-call phone)."
