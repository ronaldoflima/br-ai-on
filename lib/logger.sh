#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_NAME="${AGENT_NAME:-task-manager}"
LOG_DIR="${LOG_DIR:-logs}"
PROMPT_VERSION="${PROMPT_VERSION:-0.5.0}"

action="${1:?Uso: logger.sh <action> <message> [metadata_json]}"
message="${2:?Uso: logger.sh <action> <message> [metadata_json]}"
_default_meta='{}'
metadata="${3:-$_default_meta}"

timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
date_file=$(date -u +"%Y-%m-%d")
log_file="${LOG_DIR}/${AGENT_NAME}_${date_file}.jsonl"

mkdir -p "$LOG_DIR"

jq -nc \
  --arg ts "$timestamp" \
  --arg agent "$AGENT_NAME" \
  --arg action "$action" \
  --arg msg "$message" \
  --argjson meta "$metadata" \
  --arg pv "$PROMPT_VERSION" \
  '{timestamp:$ts,agent:$agent,action:$action,message:$msg,metadata:$meta,prompt_version:$pv,status:"success"}' \
  >> "${log_file}"

source "$SCRIPT_DIR/metrics.sh" 2>/dev/null || true
latency="${LATENCY_MS:-0}"
tokens_in="${TOKENS_IN:-0}"
tokens_out="${TOKENS_OUT:-0}"
cost="${COST_USD:-0}"
metrics_log "$AGENT_NAME" "$action" "success" "$latency" "$tokens_in" "$tokens_out" "$cost" "$metadata" 2>/dev/null || true