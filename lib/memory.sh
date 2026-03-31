#!/usr/bin/env bash
set -euo pipefail

AGENT_NAME="${AGENT_NAME:-task-manager}"
BASE_DIR="${BASE_DIR:-agents/${AGENT_NAME}}"
MEMORY_DIR="${BASE_DIR}/memory"
CACHE_DIR="${BASE_DIR}/state/cache"

log_episodic() {
  local action="${1:?Uso: log_episodic <action> <context> <outcome> [importance]}"
  local context="${2:?}"
  local outcome="${3:?}"
  local importance="${4:-1}"

  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local date_str
  date_str=$(date -u +"%Y-%m-%d")

  jq -nc \
    --arg date "$date_str" \
    --arg ts "$timestamp" \
    --arg action "$action" \
    --arg ctx "$context" \
    --arg out "$outcome" \
    --argjson imp "$importance" \
    '{date:$date,timestamp:$ts,action:$action,context:$ctx,outcome:$out,importance:$imp}' \
    >> "${MEMORY_DIR}/episodic.jsonl"
}

search_episodic() {
  local keyword="${1:?Uso: search_episodic <keyword> [max_results]}"
  local max="${2:-10}"

  grep -i "$keyword" "${MEMORY_DIR}/episodic.jsonl" 2>/dev/null | tail -n "$max"
}

cache_get() {
  local key="${1:?Uso: cache_get <key>}"
  local cache_file="${CACHE_DIR}/${key}.json"
  local default_ttl=300

  if [[ ! -f "$cache_file" ]]; then
    return 1
  fi

  local cached_at ttl now
  cached_at=$(jq -r '.cached_at' "$cache_file")
  ttl=$(jq -r '.ttl_seconds // 300' "$cache_file")
  now=$(date +%s)

  if (( now - cached_at > ttl )); then
    rm -f "$cache_file"
    return 1
  fi

  jq -r '.result' "$cache_file"
}

cache_set() {
  local key="${1:?Uso: cache_set <key> <result_json> [ttl_seconds]}"
  local result="${2:?}"
  local ttl="${3:-300}"

  local now
  now=$(date +%s)

  jq -nc \
    --argjson result "$result" \
    --argjson cached_at "$now" \
    --argjson ttl "$ttl" \
    '{result:$result,cached_at:$cached_at,ttl_seconds:$ttl}' \
    > "${CACHE_DIR}/${key}.json"
}

cache_clear() {
  rm -f "${CACHE_DIR}"/*.json 2>/dev/null || true
}

"$@"
