#!/usr/bin/env bash
# lib/memory.sh — Wrapper sobre state.sh para episodic memory e cache.
# Mantém a CLI pública anterior:
#   memory.sh log_episodic <action> <context> <outcome> [importance]
#   memory.sh search_episodic <keyword> [max_results]
#   memory.sh cache_get <key>
#   memory.sh cache_set <key> <result_json> [ttl_seconds]
#   memory.sh cache_clear
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_NAME="${AGENT_NAME:-task-manager}"

# Compat retro: BASE_DIR continua respeitado e é traduzido para BRAION_AGENTS_DIR.
# BASE_DIR aponta para agents/<nome>; BRAION_AGENTS_DIR aponta para agents/. Derivar.
if [[ -n "${BASE_DIR:-}" && -z "${BRAION_AGENTS_DIR:-}" ]]; then
  export BRAION_AGENTS_DIR="$(cd "$BASE_DIR/.." && pwd)"
fi

# shellcheck source=./state.sh
source "$SCRIPT_DIR/state.sh"

log_episodic() {
  local action="${1:?Uso: log_episodic <action> <context> <outcome> [importance]}"
  local context="${2:?}"
  local outcome="${3:?}"
  local importance="${4:-1}"

  local timestamp date_str
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  date_str=$(date -u +"%Y-%m-%d")

  local json
  json=$(jq -nc \
    --arg date "$date_str" \
    --arg ts "$timestamp" \
    --arg action "$action" \
    --arg ctx "$context" \
    --arg out "$outcome" \
    --argjson imp "$importance" \
    '{date:$date,timestamp:$ts,action:$action,context:$ctx,outcome:$out,importance:$imp}')

  state_episodic_append "$AGENT_NAME" "$json"
}

search_episodic() {
  local keyword="${1:?Uso: search_episodic <keyword> [max_results]}"
  local max="${2:-10}"
  state_episodic_search "$AGENT_NAME" "$keyword" "$max"
}

cache_get() {
  local key="${1:?Uso: cache_get <key>}"
  state_cache_get "$AGENT_NAME" "$key"
}

cache_set() {
  local key="${1:?Uso: cache_set <key> <result_json> [ttl_seconds]}"
  local result="${2:?}"
  local ttl="${3:-300}"
  state_cache_set "$AGENT_NAME" "$key" "$result" "$ttl"
}

cache_clear() {
  state_cache_clear "$AGENT_NAME"
}

"$@"
