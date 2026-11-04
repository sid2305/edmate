#!/usr/bin/env bash
# Create (or re-open SSH to) the always-on Edmate agent VM. Run from your own machine after `az login`.
# See docs/azure-vm.md. No secrets: the VM is reached by SSH key only, from your current IP only.
#
#   infra/azure/create-vm.sh            create the resource group, VM, identity and the SSH rule
#   infra/azure/create-vm.sh allow-here allow SSH from the IP you are on now (after you move networks)
#   infra/azure/create-vm.sh ip         print the VM's public IP
#
# Overrides: EDMATE_RG (edmate-agents), EDMATE_LOCATION (eastus2), EDMATE_VM (edmate-lead),
# EDMATE_VM_SIZE (Standard_D4s_v5). The admin user is always `edmate` (cloud-init.yaml assumes it).
set -euo pipefail

RG="${EDMATE_RG:-edmate-agents}"
LOC="${EDMATE_LOCATION:-eastus2}"
NAME="${EDMATE_VM:-edmate-lead}"
SIZE="${EDMATE_VM_SIZE:-Standard_D4s_v5}"
ADMIN=edmate
HERE=$(cd "$(dirname "$0")" && pwd)
NSG="${NAME}NSG"

say() { printf 'create-vm: %s\n' "$*" >&2; }

my_ip() {
  local ip
  ip=$(curl -fsS --max-time 10 https://api.ipify.org)
  case "$ip" in
    *[!0-9.]*|"") say "could not read your public IPv4 address"; exit 2 ;;
  esac
  printf '%s' "$ip"
}

allow_here() {
  local ip
  ip=$(my_ip)
  az network nsg rule create -g "$RG" --nsg-name "$NSG" -n ssh-from-home --priority 100 \
    --access Allow --protocol Tcp --direction Inbound --destination-port-ranges 22 \
    --source-address-prefixes "$ip/32" -o none
  say "SSH allowed from $ip only."
}

vm_ip() { az vm show -d -g "$RG" -n "$NAME" --query publicIps -o tsv; }

case "${1:-create}" in
  allow-here) allow_here ;;
  ip) vm_ip ;;
  create)
    az account show -o none || { say "run 'az login' first, then 'az account set --subscription <the credit subscription>'."; exit 2; }
    say "subscription: $(az account show --query name -o tsv)"
    az group create -n "$RG" -l "$LOC" -o none
    repo_url=$(git -C "$HERE" remote get-url origin)
    case "$repo_url" in
      https://*) ;;
      *) say "origin must be an https URL for the VM to clone it without a key (got: $repo_url)"; exit 2 ;;
    esac
    userdata=$(mktemp)
    trap 'rm -f "$userdata"' EXIT
    sed "s|__REPO_URL__|$repo_url|" "$HERE/cloud-init.yaml" > "$userdata"
    say "creating $NAME ($SIZE, Ubuntu 24.04, 128 GB Premium SSD, system identity, no inbound rules yet); it will clone $repo_url"
    az vm create -g "$RG" -n "$NAME" -l "$LOC" \
      --image Ubuntu2404 --size "$SIZE" \
      --os-disk-size-gb 128 --storage-sku Premium_LRS \
      --admin-username "$ADMIN" --authentication-type ssh --generate-ssh-keys \
      --assign-identity \
      --public-ip-sku Standard --nsg-rule NONE \
      --custom-data "$userdata" \
      --query '{name:name, location:location, size:hardwareProfile.vmSize}' -o table
    allow_here
    say "VM is booting and installing its toolchain (about 10 minutes). Then:"
    say "  ssh $ADMIN@$(vm_ip)"
    say "  cloud-init status --wait"
    ;;
  *) say "usage: create-vm.sh [create | allow-here | ip]"; exit 2 ;;
esac
