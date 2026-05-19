#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_NAME="${AGENT_NAME:-task-manager}"
PROMPT_VERSION="${PROMPT_VERSION:-0.5.0}"

# Compat retro: LOG_DIR continua respeitado; mapeia para BRAION_LOGS_DIR usado pelo state.sh.
if [[ -n "${LOG_DIR:-}" ]]; then
  export BRAION_LOGS_DIR="$LOG_DIR"
fi

action="${1:?Uso: logger.sh <action> <message> [metadata_json]}"
message="${2:?Uso: logger.sh <action> <message> [metadata_json]}"
_default_meta='{}'
metadata="${3:-$_default_meta}"

timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

entry=$(jq -nc \
  --arg ts "$timestamp" \
  --arg agent "$AGENT_NAME" \
  --arg action "$action" \
  --arg msg "$message" \
  --argjson meta "$metadata" \
  --arg pv "$PROMPT_VERSION" \
  '{timestamp:$ts,agent:$agent,action:$action,message:$msg,metadata:$meta,prompt_version:$pv,status:"success"}')

# shellcheck source=./state.sh
source "$SCRIPT_DIR/state.sh"
state_log_write "$AGENT_NAME" "$entry"

source "$SCRIPT_DIR/metrics.sh" 2>/dev/null || true
latency="${LATENCY_MS:-0}"
tokens_in="${TOKENS_IN:-0}"
tokens_out="${TOKENS_OUT:-0}"
cost="${COST_USD:-0}"
metrics_log "$AGENT_NAME" "$action" "success" "$latency" "$tokens_in" "$tokens_out" "$cost" "$metadata" 2>/dev/null || true
