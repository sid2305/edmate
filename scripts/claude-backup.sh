#!/usr/bin/env bash
# Start Claude Code on the subscription, or on the backup provider (Claude models in the human's
# Microsoft Foundry resource) when the subscription's usage window is exhausted.
# See docs/backup-provider.md. Human decision, 22 Oct 2026.
#
#   scripts/claude-backup.sh [--check | --foundry | --subscription] [claude args...]
#
#   (no flag)        probe the subscription with one tiny Haiku call; on a usage-limit error
#                    start Claude Code on Foundry, otherwise on the subscription
#   --check          probe and report, start nothing
#   --foundry        skip the probe, start on Foundry
#   --subscription   skip the probe, start on the subscription
#
# Everything else is passed to `claude` (e.g. `--continue` to resume the last session).
# Secrets come from ~/.config/edmate/foundry.env (outside the public repo) or the Mac Keychain;
# this script never prints a key and never writes one anywhere.
set -euo pipefail

CONFIG="${EDMATE_FOUNDRY_ENV:-$HOME/.config/edmate/foundry.env}"
LOG="${EDMATE_BACKUP_LOG:-$HOME/.config/edmate/backup.log}"
KEYCHAIN_ITEM="edmate-foundry-key"
PROBE_SECONDS=90

mode=auto
case "${1:-}" in
  --check) mode=check; shift ;;
  --foundry) mode=foundry; shift ;;
  --subscription) mode=subscription; shift ;;
esac

say() { printf 'claude-backup: %s\n' "$*" >&2; }
note() {
  mkdir -p "$(dirname "$LOG")"
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG"
}

# Probe the subscription with one Haiku call. Returns 0 = fine, 1 = usage limit, 2 = other error.
probe_subscription() {
  local out rc
  # A nested Claude Code refuses to start; the probe is a separate process.
  out=$(env -u CLAUDECODE -u CLAUDE_CODE_USE_FOUNDRY \
        perl -e 'alarm shift; exec @ARGV' "$PROBE_SECONDS" \
        claude -p 'Reply with the single word ok.' --model haiku --max-turns 1 \
          --output-format text 2>&1) && rc=0 || rc=$?
  # Only the subscription's own usage-limit wording switches to paid backup. A bare rate limit,
  # 429 or network error is "other" and stops, so a transient hiccup never spends Azure credit.
  if printf '%s' "$out" | grep -qiE 'usage limit|hit your limit|limit reached|limit will reset|out of extra usage'; then
    return 1
  fi
  if [ "$rc" -ne 0 ]; then
    say "subscription probe failed for a reason other than usage limits (exit $rc):"
    printf '%s\n' "$out" | tail -5 >&2
    return 2
  fi
  return 0
}

load_foundry_env() {
  if [ ! -f "$CONFIG" ]; then
    say "no $CONFIG. Create it from scripts/foundry.env.example (see docs/backup-provider.md)."
    exit 3
  fi
  local perms
  perms=$(stat -f '%Lp' "$CONFIG" 2>/dev/null || stat -c '%a' "$CONFIG")
  if [ "$perms" != "600" ]; then
    say "$CONFIG must be chmod 600 (it is $perms)."
    exit 3
  fi
  if [ -w "$(dirname "$CONFIG")" ] && [ "$(stat -f '%u' "$(dirname "$CONFIG")" 2>/dev/null || stat -c '%u' "$(dirname "$CONFIG")")" != "$(id -u)" ]; then
    say "$(dirname "$CONFIG") is not owned by you; refusing to source the config from it."
    exit 3
  fi
  set -a
  # shellcheck disable=SC1090
  . "$CONFIG"
  set +a
  if [ -z "${ANTHROPIC_FOUNDRY_RESOURCE:-}" ] || [ "$ANTHROPIC_FOUNDRY_RESOURCE" = "your-resource-name" ]; then
    say "ANTHROPIC_FOUNDRY_RESOURCE is not set in $CONFIG."
    exit 3
  fi
  case "$ANTHROPIC_FOUNDRY_RESOURCE" in
    *://*|*.*) say "ANTHROPIC_FOUNDRY_RESOURCE must be the resource name alone, not a URL or host."; exit 3 ;;
  esac
  for v in ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL ANTHROPIC_DEFAULT_HAIKU_MODEL; do
    if [ -z "${!v:-}" ]; then say "$v is not set in $CONFIG."; exit 3; fi
  done
  if [ -z "${ANTHROPIC_FOUNDRY_API_KEY:-}" ] && [ -z "${ANTHROPIC_FOUNDRY_AUTH_TOKEN:-}" ]; then
    if key=$(security find-generic-password -s "$KEYCHAIN_ITEM" -w 2>/dev/null) && [ -n "$key" ]; then
      export ANTHROPIC_FOUNDRY_API_KEY="$key"
      auth=keychain
    else
      auth=entra
    fi
  else
    auth=env
  fi
  export CLAUDE_CODE_USE_FOUNDRY=1
  export ANTHROPIC_MODEL="${EDMATE_BACKUP_MAIN_MODEL:-$ANTHROPIC_DEFAULT_SONNET_MODEL}"
  export ANTHROPIC_SMALL_FAST_MODEL="$ANTHROPIC_DEFAULT_HAIKU_MODEL"
  if [ "${ENABLE_PROMPT_CACHING_1H:-0}" != "1" ]; then unset ENABLE_PROMPT_CACHING_1H; fi
  export EDMATE_PROVIDER=foundry
}

start_foundry() {
  load_foundry_env
  say "starting on Microsoft Foundry (resource $ANTHROPIC_FOUNDRY_RESOURCE, auth $auth, main model $ANTHROPIC_MODEL)."
  say "Azure credit is billed per token: builders on Sonnet, finish running work, no third slot."
  note "foundry start auth=$auth main=$ANTHROPIC_MODEL argc=$#"
  exec claude "$@"
}

start_subscription() {
  export EDMATE_PROVIDER=subscription
  say "starting on the Claude subscription."
  note "subscription start argc=$#"
  exec claude "$@"
}

case "$mode" in
  foundry) start_foundry "$@" ;;
  subscription) start_subscription "$@" ;;
  check|auto)
    probe_rc=0; probe_subscription || probe_rc=$?
    case "$probe_rc" in
      0) say "subscription OK."
         [ "$mode" = check ] && exit 0
         start_subscription "$@" ;;
      1) say "subscription usage limit hit."; note "probe limit"
         [ "$mode" = check ] && { say "the backup would start on Foundry."; exit 1; }
         start_foundry "$@" ;;
      *) say "not switching to Foundry on an unknown error; fix the probe or pass --foundry."; exit 2 ;;
    esac ;;
esac
