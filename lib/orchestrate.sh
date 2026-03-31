#!/usr/bin/env bash
set -euo pipefail

AGENTS_DIR="${AGENTS_DIR:-agents}"
SHARED_DIR="${AGENTS_DIR}/shared"
BOARD_FILE="${SHARED_DIR}/task_board.md"
MSG_FILE="${SHARED_DIR}/messages.jsonl"

create_task() {
  local id="${1:?Uso: orchestrate.sh create_task <id> <title> <target_agent> <priority> <details>}"
  local title="${2:?}"
  local target="${3:?}"
  local priority="${4:-medium}"
  local details="${5:-}"
  local timestamp
  timestamp=$(date -u +"%Y-%m-%d %H:%M")

  source lib/lock.sh
  acquire "orchestrator" "task_board" >/dev/null

  cat >> "$BOARD_FILE" << EOF

### [$id] $title
- **De:** orchestrator
- **Para:** $target
- **Status:** pending
- **Prioridade:** $priority
- **Criado:** $timestamp
- **Detalhes:** $details
- **Resultado:** (aguardando)
EOF

  release "orchestrator" "task_board" >/dev/null
  echo "task_created id=$id target=$target"
}

send_message() {
  local from="${1:?Uso: orchestrate.sh send_message <from> <to> <type> <message>}"
  local to="${2:?}"
  local type="${3:-info}"
  local message="${4:?}"
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  source lib/lock.sh
  acquire "$from" "messages" >/dev/null

  jq -nc \
    --arg ts "$timestamp" \
    --arg from "$from" \
    --arg to "$to" \
    --arg type "$type" \
    --arg msg "$message" \
    '{timestamp:$ts,from:$from,to:$to,type:$type,message:$msg}' \
    >> "$MSG_FILE"

  release "$from" "messages" >/dev/null
  echo "message_sent from=$from to=$to"
}

read_messages() {
  local agent="${1:?Uso: orchestrate.sh read_messages <agent_name>}"
  grep "\"to\":\"$agent\"" "$MSG_FILE" 2>/dev/null || echo "no_messages"
}

list_pending() {
  local agent="${1:-}"
  if [[ -n "$agent" ]]; then
    grep -A7 "Para:** $agent" "$BOARD_FILE" | grep -B7 "Status:** pending" || echo "no_pending_tasks"
  else
    grep -B2 "Status:** pending" "$BOARD_FILE" || echo "no_pending_tasks"
  fi
}

"$@"
