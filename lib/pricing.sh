#!/usr/bin/env bash
# Tabela de preços da API Anthropic (por milhão de tokens)
# Fonte: https://www.anthropic.com/pricing (atualizado 2026-03)

declare -A PRICING_INPUT=(
  ["claude-opus-4-6"]=15.00
  ["claude-sonnet-4-6"]=3.00
  ["claude-haiku-4-5"]=0.80
  ["claude-haiku-4-5-20251001"]=0.80
  ["default"]=3.00
)

declare -A PRICING_OUTPUT=(
  ["claude-opus-4-6"]=75.00
  ["claude-sonnet-4-6"]=15.00
  ["claude-haiku-4-5"]=4.00
  ["claude-haiku-4-5-20251001"]=4.00
  ["default"]=15.00
)

# cost_from_tokens <model> <tokens_in> <tokens_out>
# Retorna custo em USD com 8 casas decimais
cost_from_tokens() {
  local model="${1:-default}"
  local tokens_in="${2:-0}"
  local tokens_out="${3:-0}"

  local price_in="${PRICING_INPUT[$model]:-${PRICING_INPUT[default]}}"
  local price_out="${PRICING_OUTPUT[$model]:-${PRICING_OUTPUT[default]}}"

  awk "BEGIN { printf \"%.8f\", ($tokens_in / 1000000 * $price_in) + ($tokens_out / 1000000 * $price_out) }"
}

# pricing_table_json — emite tabela de preços como JSON
pricing_table_json() {
  echo '{"models":['
  local first=true
  for model in "claude-opus-4-6" "claude-sonnet-4-6" "claude-haiku-4-5"; do
    [[ "$first" == true ]] && first=false || echo ','
    local pin="${PRICING_INPUT[$model]}"
    local pout="${PRICING_OUTPUT[$model]}"
    printf '{"model":"%s","input_per_mtok":%s,"output_per_mtok":%s}' "$model" "$pin" "$pout"
  done
  echo ']}'
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  cmd="${1:-help}"
  shift || true
  case "$cmd" in
    cost) cost_from_tokens "$@" ;;
    table) pricing_table_json ;;
    *) echo "Uso: pricing.sh {cost <model> <tokens_in> <tokens_out> | table}" ;;
  esac
fi
