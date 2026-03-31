#!/usr/bin/env bash
set -euo pipefail

METRICS_DIR="${METRICS_DIR:-metrics}"
mkdir -p "$METRICS_DIR"

# Preços da API Claude por milhão de tokens (USD)
declare -A _PRICE_IN=( ["claude-opus-4-6"]=15.0 ["claude-sonnet-4-6"]=3.0 ["claude-haiku-4-5"]=0.8 ["default"]=3.0 )
declare -A _PRICE_OUT=( ["claude-opus-4-6"]=75.0 ["claude-sonnet-4-6"]=15.0 ["claude-haiku-4-5"]=4.0 ["default"]=15.0 )

_cost_from_tokens() {
  local model="${1:-default}"
  local tin="${2:-0}"
  local tout="${3:-0}"
  local pin="${_PRICE_IN[$model]:-${_PRICE_IN[default]}}"
  local pout="${_PRICE_OUT[$model]:-${_PRICE_OUT[default]}}"
  awk "BEGIN { printf \"%.8f\", ($tin / 1000000 * $pin) + ($tout / 1000000 * $pout) }"
}

metrics_log() {
  local agent="${1:?Uso: metrics_log <agent> <action> <status> <latency_ms> <tokens_in> <tokens_out> [cost_usd] [metadata_json]}"
  local action="${2:?}"
  local status="${3:?}"
  local latency_ms="${4:?}"
  local tokens_in="${5:-0}"
  local tokens_out="${6:-0}"
  local cost_usd="${7:-0}"
  local _default_meta='{}'
  local metadata="${8:-$_default_meta}"
  local model="${MODEL:-default}"

  # Auto-calcula custo a partir de tokens quando cost_usd não fornecido
  if [[ "$cost_usd" == "0" ]] && [[ "$tokens_in" != "0" || "$tokens_out" != "0" ]]; then
    cost_usd=$(_cost_from_tokens "$model" "$tokens_in" "$tokens_out")
  fi

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
    --argjson cost "$cost_usd" \
    --argjson meta "$metadata" \
    '{timestamp:$ts,agent:$agent,action:$action,status:$status,model:$model,latency_ms:$latency,tokens_in:$tin,tokens_out:$tout,cost_usd:$cost,metadata:$meta}' \
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
      total_cost_usd: [.[].cost_usd] | add,
      total_tokens_in: [.[].tokens_in] | add,
      total_tokens_out: [.[].tokens_out] | add,
      avg_latency_ms: ([.[].latency_ms] | add / length),
      by_agent: (group_by(.agent) | map({
        agent: .[0].agent,
        requests: length,
        success: [.[] | select(.status=="success")] | length,
        errors: [.[] | select(.status=="error")] | length,
        cost_usd: [.[].cost_usd] | add,
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
      total_cost_usd: [.[].cost_usd] | add,
      avg_latency_ms: ([.[].latency_ms] | add / length),
      actions: (group_by(.action) | map({action: .[0].action, count: length}))
    }
  ' "$metrics_file"
}

metrics_budget_check() {
  local agent="${1:?Uso: metrics_budget_check <agent> <daily_limit_usd>}"
  local daily_limit="${2:?}"
  local date_file
  date_file=$(date -u +"%Y-%m-%d")
  local metrics_file="${METRICS_DIR}/${date_file}.jsonl"

  if [[ ! -f "$metrics_file" ]]; then
    echo '{"within_budget":true,"spent":0,"limit":'"$daily_limit"',"pct":0}'
    return 0
  fi

  jq -s --arg agent "$agent" --argjson limit "$daily_limit" '
    [.[] | select(.agent == $agent)] |
    ([.[].cost_usd] | add // 0) as $spent |
    {
      within_budget: ($spent < $limit),
      alert_80pct: ($spent >= ($limit * 0.8)),
      spent: $spent,
      limit: $limit,
      pct: (if $limit > 0 then ($spent / $limit * 100) else 0 end)
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
    budget) metrics_budget_check "$@" ;;
    *) echo "Uso: metrics.sh {log|summary|agent|budget} [args...]" ;;
  esac
fi