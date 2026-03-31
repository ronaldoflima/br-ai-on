#!/usr/bin/env bash
set -euo pipefail

LOCK_DIR="${LOCK_DIR:-/tmp/agents-workflow}"
AGENT_NAME="${1:?Uso: check_concurrency.sh <agent_name>}"

mkdir -p "$LOCK_DIR"

lock_file="${LOCK_DIR}/agent-${AGENT_NAME}.lock"

if [[ -f "$lock_file" ]]; then
  pid=$(cat "$lock_file" 2>/dev/null | cut -d' ' -f2 || echo "")
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    echo "BLOCKED: agent $AGENT_NAME already running (pid=$pid)" >&2
    exit 2
  else
    rm -f "$lock_file"
    echo "STALE: removed stale lock for $AGENT_NAME"
  fi
fi

echo "$AGENT_NAME $$ $(date +%s)" > "$lock_file"
echo "ACQUIRED: agent $AGENT_NAME session lock (pid=$$)"

cleanup() {
  rm -f "$lock_file"
}
trap cleanup EXIT
