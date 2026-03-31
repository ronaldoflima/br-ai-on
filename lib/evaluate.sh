#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="${LOG_DIR:-$PROJECT_DIR/logs}"
EVAL_DIR="${PROJECT_DIR}/agents/evaluator/state"
METRICS_DIR="${METRICS_DIR:-$PROJECT_DIR/metrics}"

mkdir -p "$EVAL_DIR"

evaluate_deterministic() {
  local log_file="${1:?Uso: evaluate_deterministic <log_file>}"

  if [[ ! -f "$log_file" ]]; then
    echo '{"error":"log file not found"}'
    return 1
  fi

  jq -s '
    {
      file: input_filename,
      total_entries: length,
      checks: {
        has_timestamp: ([.[] | select(.timestamp != null)] | length),
        has_agent: ([.[] | select(.agent != null)] | length),
        has_action: ([.[] | select(.action != null)] | length),
        has_message: ([.[] | select(.message != null and (.message | length) > 0)] | length),
        has_status: ([.[] | select(.status != null)] | length),
        valid_json: length,
        errors: ([.[] | select(.status == "error")] | length),
        empty_messages: ([.[] | select(.message == "" or .message == null)] | length)
      },
      score: {
        formato: (if length > 0 then
          (([.[] | select(.timestamp != null and .agent != null and .action != null)] | length) / length * 5)
          else 0 end),
        completude: (if length > 0 then
          (([.[] | select(.message != null and (.message | length) > 5)] | length) / length * 5)
          else 0 end),
        errors_pct: (if length > 0 then
          (([.[] | select(.status == "error")] | length) / length * 100)
          else 0 end)
      }
    }
  ' "$log_file" 2>/dev/null || echo '{"error":"invalid jsonl"}'
}

evaluate_day() {
  local date_str="${1:-$(date -u +"%Y-%m-%d")}"
  # Descoberta dinâmica: inclui qualquer agente que tenha log no dia
  local agents=()
  for log_f in "${LOG_DIR}"/*_"${date_str}".jsonl; do
    [[ -f "$log_f" ]] || continue
    local aname
    aname=$(basename "$log_f" | sed "s/_${date_str}\.jsonl//")
    agents+=("$aname")
  done
  local eval_file="${EVAL_DIR}/evaluations.jsonl"
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  for agent in "${agents[@]}"; do
    local log_file="${LOG_DIR}/${agent}_${date_str}.jsonl"
    if [[ -f "$log_file" ]]; then
      local result
      result=$(evaluate_deterministic "$log_file")

      jq -nc \
        --arg ts "$timestamp" \
        --arg agent "$agent" \
        --arg date "$date_str" \
        --argjson result "$result" \
        '{timestamp:$ts,agent:$agent,date:$date,evaluation:$result}' \
        >> "$eval_file"

      echo "[$agent] Avaliado: $(echo "$result" | jq -r '.total_entries') entradas"
    else
      echo "[$agent] Sem logs para $date_str"
    fi
  done

  if [[ -f "${METRICS_DIR}/${date_str}.jsonl" ]]; then
    source "$SCRIPT_DIR/metrics.sh"
    local summary
    summary=$(metrics_summary "$date_str" 2>/dev/null || echo '{}')
    echo ""
    echo "=== Resumo de Métricas ==="
    echo "$summary" | jq '.'
  fi
}

generate_report() {
  local date_str="${1:-$(date -u +"%Y-%m-%d")}"
  local eval_file="${EVAL_DIR}/evaluations.jsonl"
  local report_file="${EVAL_DIR}/report_${date_str}.md"

  if [[ ! -f "$eval_file" ]]; then
    echo "Sem avaliações disponíveis"
    return 1
  fi

  {
    echo "# Relatório de Qualidade — $date_str"
    echo ""
    echo "## Avaliações por Agente"
    echo ""

    jq -sr --arg date "$date_str" '
      [.[] | select(.date == $date)] |
      if length == 0 then "Nenhuma avaliação para esta data.\n"
      else
        .[] |
        "### " + .agent + "\n" +
        "- Entradas: " + (.evaluation.total_entries | tostring) + "\n" +
        "- Formato score: " + (.evaluation.score.formato | tostring | .[0:4]) + "/5\n" +
        "- Completude score: " + (.evaluation.score.completude | tostring | .[0:4]) + "/5\n" +
        "- Erros: " + (.evaluation.score.errors_pct | tostring | .[0:5]) + "%\n\n"
      end
    ' "$eval_file"

    echo "## Ações Recomendadas"
    echo ""

    jq -sr --arg date "$date_str" '
      [.[] | select(.date == $date)] |
      [.[] | select(.evaluation.score.formato < 4 or .evaluation.score.completude < 4 or .evaluation.score.errors_pct > 10)] |
      if length == 0 then "Nenhuma ação necessária — todos os agentes dentro dos padrões.\n"
      else
        .[] |
        "- **" + .agent + "**: " +
        (if .evaluation.score.formato < 4 then "melhorar formato de logs; " else "" end) +
        (if .evaluation.score.completude < 4 then "mensagens incompletas; " else "" end) +
        (if .evaluation.score.errors_pct > 10 then "taxa de erro alta (" + (.evaluation.score.errors_pct | tostring | .[0:5]) + "%); " else "" end) +
        "\n"
      end
    ' "$eval_file"
  } > "$report_file"

  echo "Relatório gerado: $report_file"
}

generate_weekly_summary() {
  local end_date="${1:-$(date -u +"%Y-%m-%d")}"
  local eval_file="${EVAL_DIR}/evaluations.jsonl"
  local summary_file="${EVAL_DIR}/weekly_summary_${end_date}.json"

  if [[ ! -f "$eval_file" ]]; then
    echo '{"error":"no evaluations"}'
    return 1
  fi

  jq -s --arg end "$end_date" '
    [.[] | select(.date <= $end)] | sort_by(.date) | .[-35:] |
    group_by(.agent) | map({
      agent: .[0].agent,
      sessions: length,
      avg_formato: ([.[].evaluation.score.formato] | add / length),
      avg_completude: ([.[].evaluation.score.completude] | add / length),
      avg_errors_pct: ([.[].evaluation.score.errors_pct] | add / length),
      worst_day: (sort_by(.evaluation.score.formato) | .[0] | {date: .date, formato: .evaluation.score.formato}),
      trend: (if length >= 2 then
        ((.[-1].evaluation.score.formato - .[0].evaluation.score.formato) |
        if . > 0.5 then "improving" elif . < -0.5 then "degrading" else "stable" end)
      else "insufficient_data" end),
      top_issues: [
        (if ([.[].evaluation.score.formato] | add / length) < 4 then "formato" else empty end),
        (if ([.[].evaluation.score.completude] | add / length) < 4 then "completude" else empty end),
        (if ([.[].evaluation.score.errors_pct] | add / length) > 10 then "high_error_rate" else empty end)
      ]
    })
  ' "$eval_file" > "$summary_file" 2>/dev/null || echo '[]' > "$summary_file"

  echo "Weekly summary: $summary_file"
  cat "$summary_file"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  cmd="${1:-help}"
  shift || true
  case "$cmd" in
    check) evaluate_deterministic "$@" ;;
    day) evaluate_day "$@" ;;
    report) generate_report "$@" ;;
    weekly) generate_weekly_summary "$@" ;;
    *) echo "Uso: evaluate.sh {check|day|report|weekly} [args...]" ;;
  esac
fi