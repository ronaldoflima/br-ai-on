#!/usr/bin/env bash
set -euo pipefail

METRICS_DIR="${METRICS_DIR:-metrics}"
mkdir -p "$METRICS_DIR"

metrics_log() {
  local agent="${1:?Uso: metrics_log <agent> <action> <status> <latency_ms> <tokens_in> <tokens_out> [metadata_json]}"
  local action="${2:?}"
  local status="${3:?}"
  local latency_ms="${4:?}"
  local tokens_in="${5:-0}"
  local tokens_out="${6:-0}"
  local _default_meta='{}'
  local metadata="${7:-$_default_meta}"
  local model="${MODEL:-default}"

  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local date_file
  date_file=$(date -u +"%Y-%m-%d")
  local metrics_file="${METRICS_DIR}/${date_file}.jsonl"

  jq -nc \
    --arg ts "$timestamp" \
    --arg agent "$agent" \
    --arg action "$action" \
    --arg status "$status" \
    --arg model "$model" \
    --argjson latency "$latency_ms" \
    --argjson tin "$tokens_in" \
    --argjson tout "$tokens_out" \
    --argjson meta "$metadata" \
    '{timestamp:$ts,agent:$agent,action:$action,status:$status,model:$model,latency_ms:$latency,tokens_in:$tin,tokens_out:$tout,metadata:$meta}' \
    >> "$metrics_file"
}

metrics_summary() {
  local date_file="${1:-$(date -u +"%Y-%m-%d")}"
  local metrics_file="${METRICS_DIR}/${date_file}.jsonl"

  if [[ ! -f "$metrics_file" ]]; then
    echo '{"error":"no metrics for this date"}'
    return 1
  fi

  jq -s '
    {
      date: "'$date_file'",
      total_requests: length,
      success: [.[] | select(.status=="success")] | length,
      errors: [.[] | select(.status=="error")] | length,
      total_tokens_in: [.[].tokens_in] | add,
      total_tokens_out: [.[].tokens_out] | add,
      avg_latency_ms: ([.[].latency_ms] | add / length),
      by_agent: (group_by(.agent) | map({
        agent: .[0].agent,
        requests: length,
        success: [.[] | select(.status=="success")] | length,
        errors: [.[] | select(.status=="error")] | length,
        avg_latency_ms: ([.[].latency_ms] | add / length)
      }))
    }
  ' "$metrics_file"
}

metrics_agent_summary() {
  local agent="${1:?Uso: metrics_agent_summary <agent> [date]}"
  local date_file="${2:-$(date -u +"%Y-%m-%d")}"
  local metrics_file="${METRICS_DIR}/${date_file}.jsonl"

  if [[ ! -f "$metrics_file" ]]; then
    echo '{"error":"no metrics for this date"}'
    return 1
  fi

  jq -s --arg agent "$agent" '
    [.[] | select(.agent == $agent)] |
    {
      agent: $agent,
      date: "'$date_file'",
      total_requests: length,
      success: [.[] | select(.status=="success")] | length,
      errors: [.[] | select(.status=="error")] | length,
      success_rate: (if length > 0 then ([.[] | select(.status=="success")] | length) / length * 100 else 0 end),
      avg_latency_ms: ([.[].latency_ms] | add / length),
      actions: (group_by(.action) | map({action: .[0].action, count: length}))
    }
  ' "$metrics_file"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  cmd="${1:-help}"
  shift || true
  case "$cmd" in
    log) metrics_log "$@" ;;
    summary) metrics_summary "$@" ;;
    agent) metrics_agent_summary "$@" ;;
    *) echo "Uso: metrics.sh {log|summary|agent} [args...]" ;;
  esac
fi
