# Shared Azure Monitor Logs Ingestion helper, sourced (never executed) by heartbeat.sh and
# blockers-watch.sh so there is one Logs-Ingestion code path, not two. Posts one row to the
# EdmateHeartbeat_CL table (columns: TimeGenerated, Source) via the DCE, authenticated with the
# VM's system-assigned managed identity (an AAD bearer token from IMDS) -- no shared key or
# connection string ever written to disk. A failure here must never fail the caller: every exit
# path returns 0; see docs/azure-vm.md phase 1b.
#
# Reads EDMATE_MONITOR_DCE_ENDPOINT, EDMATE_MONITOR_DCR_IMMUTABLE_ID, EDMATE_MONITOR_STREAM_NAME
# from ${EDMATE_MONITOR_ENV_FILE:-$HOME/.config/edmate/monitor.env}; a missing file or a missing
# field is a silent no-op (the convenience path has nothing to do yet). DRY_RUN=1 prints the
# token-endpoint URL and the would-be POST request line (method, URL, headers minus the token
# value, body shape) instead of calling curl.
#
# 169.254.169.254 is Azure's fixed link-local IMDS address on every VM, the same on every Azure
# subscription -- not a resource identifier (secret-scan: allow - Azure IMDS platform constant,
# see .claude/tests/test_no_azure_identifiers.py).
IMDS_TOKEN_URL="http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fmonitor.azure.com%2F"

monitor_post_row() {
  local source_value="$1"
  local env_file="${EDMATE_MONITOR_ENV_FILE:-$HOME/.config/edmate/monitor.env}"
  [ -f "$env_file" ] || return 0

  local EDMATE_MONITOR_DCE_ENDPOINT="" EDMATE_MONITOR_DCR_IMMUTABLE_ID="" EDMATE_MONITOR_STREAM_NAME=""
  # shellcheck disable=SC1090
  . "$env_file"
  if [ -z "$EDMATE_MONITOR_DCE_ENDPOINT" ] || [ -z "$EDMATE_MONITOR_DCR_IMMUTABLE_ID" ] || [ -z "$EDMATE_MONITOR_STREAM_NAME" ]; then
    printf 'monitor-ingest: monitor.env is missing a field; skipping the Monitor write\n' >&2
    return 0
  fi

  local ts body url
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  body="[{\"TimeGenerated\":\"$ts\",\"Source\":\"$source_value\"}]"
  url="${EDMATE_MONITOR_DCE_ENDPOINT}/dataCollectionRules/${EDMATE_MONITOR_DCR_IMMUTABLE_ID}/streams/${EDMATE_MONITOR_STREAM_NAME}?api-version=2023-01-01"

  if [ "${DRY_RUN:-0}" = "1" ]; then
    printf 'monitor-ingest: token endpoint: %s\n' "$IMDS_TOKEN_URL"
    printf 'monitor-ingest: POST %s\n' "$url"
    printf 'monitor-ingest: headers: Content-Type: application/json, Authorization: Bearer <token>\n'
    printf 'monitor-ingest: body: %s\n' "$body"
    return 0
  fi

  local token
  token=$(curl -fsS -H "Metadata: true" "$IMDS_TOKEN_URL" 2>/dev/null | jq -r '.access_token // empty') || token=""
  if [ -z "$token" ]; then
    printf 'monitor-ingest: could not get an IMDS token; skipping the Monitor write\n' >&2
    return 0
  fi
  if ! curl -fsS -X POST "$url" -H "Content-Type: application/json" -H "Authorization: Bearer $token" -d "$body" >/dev/null 2>&1; then
    printf 'monitor-ingest: Monitor write failed; continuing\n' >&2
  fi
  return 0
}
