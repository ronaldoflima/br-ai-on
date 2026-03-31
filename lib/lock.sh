#!/usr/bin/env bash
set -euo pipefail

LOCK_DIR="${LOCK_DIR:-/tmp/agents-workflow}"
LOCK_TIMEOUT="${LOCK_TIMEOUT:-30}"

mkdir -p "$LOCK_DIR"

acquire() {
  local agent="${1:?Uso: lock.sh acquire <agent_name> [resource]}"
  local resource="${2:-shared}"
  local lock_file="${LOCK_DIR}/${resource}.lock"
  local max_retries=3
  local retry=0

  while [[ $retry -lt $max_retries ]]; do
    if (set -o noclobber; echo "$agent $(date +%s) $$" > "$lock_file") 2>/dev/null; then
      echo "lock_acquired"
      return 0
    fi

    local holder age
    holder=$(cut -d' ' -f1 "$lock_file" 2>/dev/null || echo "unknown")
    age=$(( $(date +%s) - $(cut -d' ' -f2 "$lock_file" 2>/dev/null || echo "0") ))

    if [[ $age -gt $LOCK_TIMEOUT ]]; then
      rm -f "$lock_file"
      echo "stale_lock_removed holder=$holder age=${age}s"
      continue
    fi

    retry=$((retry + 1))
    echo "lock_busy holder=$holder retry=$retry/$max_retries"
    sleep 5
  done

  echo "lock_failed"
  return 1
}

release() {
  local agent="${1:?Uso: lock.sh release <agent_name> [resource]}"
  local resource="${2:-shared}"
  local lock_file="${LOCK_DIR}/${resource}.lock"

  if [[ -f "$lock_file" ]]; then
    local holder
    holder=$(cut -d' ' -f1 "$lock_file" 2>/dev/null || echo "")
    if [[ "$holder" == "$agent" ]]; then
      rm -f "$lock_file"
      echo "lock_released"
      return 0
    else
      echo "lock_not_owned holder=$holder requester=$agent"
      return 1
    fi
  fi

  echo "no_lock_found"
  return 0
}

status() {
  local resource="${1:-shared}"
  local lock_file="${LOCK_DIR}/${resource}.lock"

  if [[ -f "$lock_file" ]]; then
    local holder age
    holder=$(cut -d' ' -f1 "$lock_file")
    age=$(( $(date +%s) - $(cut -d' ' -f2 "$lock_file") ))
    echo "locked holder=$holder age=${age}s"
  else
    echo "unlocked"
  fi
}

"$@"
