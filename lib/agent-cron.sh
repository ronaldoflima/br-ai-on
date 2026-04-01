#!/usr/bin/env bash
# lib/agent-cron.sh — Orquestrador sem LLM
# Roda a cada 5 minutos via cron.
#
# Fluxo:
#   0. Sync Obsidian vault
#   1. Obsidian inbox → roteamento (task-manager)
#   2. Handoffs pendentes → inicia agente destinatário
#   3. Agentes "alive" due → inicia via scheduler

set -euo pipefail

BRAION=$(cd "$(dirname "$0")/.." && pwd)
OBSIDIAN_VAULT=${OBSIDIAN_VAULT:-$HOME/pessoal/obsidian-files}
OBSIDIAN_BASE=${OBSIDIAN_BASE:-geral}
OBSIDIAN_INBOX=${OBSIDIAN_INBOX:-$OBSIDIAN_VAULT/$OBSIDIAN_BASE/agents/inbox}
CLAUDE=${CLAUDE:-$(command -v claude || echo claude)}
DEFAULT_MODEL=${DEFAULT_MODEL:-claude-sonnet-4-6}
LOG_FILE=${LOG_FILE:-$BRAION/logs/agent-cron.log}
STALE_THRESHOLD=${STALE_THRESHOLD:-900}

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG_FILE"
}

# ── Pause check ───────────────────────────────────────────────────────────────
if [ -f "$BRAION/.paused" ]; then
  log "PAUSED — arquivo .paused existe, saindo sem iniciar agentes"
  exit 0
fi

session_running() {
  tmux has-session -t "$1" 2>/dev/null
}

session_is_idle() {
  local session=$1
  tmux has-session -t "$session" 2>/dev/null || return 1

  tmux capture-pane -t "$session" -p 2>/dev/null \
    | grep -v '^[[:space:]]*$' | grep -v '^─\+$' \
    | grep -v 'auto mode' | tail -1 | grep -q '^❯'
}

session_is_stale() {
  local session=$1
  tmux has-session -t "$session" 2>/dev/null || return 1

  local activity now elapsed
  activity=$(tmux display-message -t "$session" -p '#{window_activity}' 2>/dev/null || echo 0)
  [ "${activity:-0}" -le 0 ] && return 1

  now=$(date -u +%s)
  elapsed=$(( now - activity ))
  [ "$elapsed" -gt "$STALE_THRESHOLD" ]
}

kill_stale_session() {
  local session=$1
  if session_is_idle "$session"; then
    log "KILL $session — claude em prompt idle, sessão concluída"
    tmux kill-session -t "$session" 2>/dev/null
    return 0
  fi
  if session_is_stale "$session"; then
    local activity elapsed
    activity=$(tmux display-message -t "$session" -p '#{window_activity}' 2>/dev/null || echo 0)
    elapsed=$(( $(date -u +%s) - activity ))
    log "KILL $session — sem atividade há ${elapsed}s (> ${STALE_THRESHOLD}s)"
    tmux kill-session -t "$session" 2>/dev/null
    return 0
  fi
  return 1
}

heartbeat_is_processing() {
  local heartbeat_file=$1
  [ -f "$heartbeat_file" ] || return 0

  local status last_ping now elapsed
  status=$(jq -r '.status // ""' "$heartbeat_file" 2>/dev/null || echo "")
  [ "$status" != "processing" ] && return 0

  last_ping=$(jq -r '.last_ping // ""' "$heartbeat_file" 2>/dev/null || echo "")
  [ -z "$last_ping" ] && return 0

  now=$(date -u +%s)
  elapsed=$(( now - $(date -u -d "$last_ping" +%s 2>/dev/null || echo 0) ))

  if [ "$elapsed" -lt "$STALE_THRESHOLD" ]; then
    return 1
  fi
  return 0
}

get_agent_model() {
  local config=$1
  awk '/^model:/{gsub(/"/,"",$2); print $2}' "$config" 2>/dev/null
}

get_agent_command() {
  local config=$1
  # Lê campo command: do config.yaml, remove quotes
  awk '/^command:/{gsub(/^command:[[:space:]]*/,""); gsub(/^"|"$/,""); print}' "$config" 2>/dev/null
}

start_session() {
  local session=$1 working_dir=$2 prompt=$3 model=${4:-$DEFAULT_MODEL} custom_cmd="${5:-}"

  if session_running "$session"; then
    kill_stale_session "$session" || { log "SKIP $session — sessão tmux ativa"; return 0; }
  fi

  tmux new-session -d -s "$session" -c "$working_dir"

  # Se tem comando customizado, usa ele; senão usa o claude padrão
  if [ -n "$custom_cmd" ]; then
    tmux send-keys -t "$session" "$custom_cmd" Enter
    log "START $session em $working_dir (command=$custom_cmd)"
  else
    tmux send-keys -t "$session" "$CLAUDE --model $model --permission-mode auto --allowedTools '*'" Enter
    log "START $session em $working_dir (model=$model)"
  fi

  sleep 5
  tmux send-keys -t "$session" -l "$prompt"
  tmux send-keys -t "$session" Enter
}

# ── 0. Sincronizar Obsidian vault ─────────────────────────────────────────────
if [ -d "$OBSIDIAN_VAULT/.git" ]; then
  git -C "$OBSIDIAN_VAULT" pull --quiet 2>/dev/null \
    && log "Obsidian: pull OK" \
    || log "Obsidian: pull falhou (continuando com versão local)"
fi

# ── 1. Obsidian inbox → roteamento pelo task-manager ─────────────────────────
inbox_count=0
if [ -d "$OBSIDIAN_INBOX" ]; then
  inbox_count=$(grep -rL "assigned_to:" "$OBSIDIAN_INBOX" --include="*.md" 2>/dev/null | grep -v '/\.' | wc -l | xargs || true)
fi
if [ "${inbox_count:-0}" -gt 0 ]; then
  log "Inbox: $inbox_count nota(s) encontrada(s)"
  heartbeat="$BRAION/agents/_defaults/task-manager/state/heartbeat.json"
  tarefas_model=$(get_agent_model "$BRAION/agents/_defaults/task-manager/config.yaml")
  if heartbeat_is_processing "$heartbeat"; then
    start_session "braion-task-manager" "$BRAION" \
      "Read $BRAION/skills/agent-inbox-router/SKILL.md and follow the instructions exactly. Agent: task-manager. BR.AI.ON base: $BRAION." \
      "${tarefas_model:-$DEFAULT_MODEL}"
  else
    log "SKIP braion-task-manager — heartbeat processing recente"
  fi
fi

# ── 2. Handoffs pendentes → iniciar agente responsivo ─────────────────────────
notify_user_handoff() {
  local handoff_file=$1
  local from description
  from=$(awk '/^from:/{print $2}' "$handoff_file" 2>/dev/null || echo "?")
  description=$(sed -n '/^## Descricao/,/^## /p' "$handoff_file" 2>/dev/null \
    | grep -v '^##' | sed '/^[[:space:]]*$/d' | head -3 | tr '\n' ' ')
  log "Handoff to user from $from: $description"
}

for config in "$BRAION/agents"/*/config.yaml; do
  agent_dir=$(dirname "$config")
  agent=$(basename "$agent_dir")
  [ "$agent" = "shared" ] && continue

  inbox_dir="$agent_dir/handoffs/inbox"
  [ -d "$inbox_dir" ] || continue

  working_dir=$(awk '/^directory:/{print $2}' "$config" 2>/dev/null || echo "")
  [ -z "$working_dir" ] && working_dir="$BRAION"

  for handoff_file in "$inbox_dir"/HO-*.md; do
    [ -f "$handoff_file" ] || continue

    filename=$(basename "$handoff_file")
    ho_id=$(echo "$filename" | sed -n 's/\(HO-[0-9]*-[0-9]*\)_.*/\1/p')

    expects=$(awk '/^expects:/{print $2}' "$handoff_file" 2>/dev/null || echo "")
    to=$(awk '/^to:/{print $2}' "$handoff_file" 2>/dev/null || echo "")

    # Handoffs para o usuário: notifica e arquiva sem iniciar sessão
    if [ "$to" = "user" ]; then
      log "Handoff $ho_id → user: notificando e arquivando"
      notify_user_handoff "$handoff_file"
      mkdir -p "$agent_dir/handoffs/archive"
      mv "$handoff_file" "$agent_dir/handoffs/archive/$filename"
      continue
    fi

    # Handoffs expects:info são notificações — arquiva sem iniciar sessão
    if [ "$expects" = "info" ]; then
      log "Handoff $ho_id expects:info — arquivando sem sessão"
      mkdir -p "$agent_dir/handoffs/archive"
      mv "$handoff_file" "$agent_dir/handoffs/archive/$filename"
      continue
    fi

    session="braion-${agent}-${ho_id}"

    if session_running "$session"; then
      kill_stale_session "$session" || { log "SKIP $session — sessão ativa"; continue; }
    fi

    # if [ -f "$agent_dir/handoffs/in_progress/$filename" ]; then
    #   log "SKIP $session — handoff em in_progress (possível crash em recuperação)"
    #   continue
    # fi

    # Se o agente tem sessão alive ativa, aguarda ela terminar para evitar escrita concorrente em state/
    if session_running "braion-${agent}"; then
      kill_stale_session "braion-${agent}" || { log "SKIP $session — sessão alive braion-${agent} ativa, handoff será processado no próximo ciclo"; continue; }
    fi

    log "Handoff: iniciando $session para $handoff_file"

    prompt="Read $BRAION/skills/agent-handoff/SKILL.md and follow the instructions exactly. Agent: $agent. Handoff: $handoff_file. BR.AI.ON base: $BRAION. Working directory: $working_dir."
    agent_model=$(get_agent_model "$config")
    agent_cmd=$(get_agent_command "$config")

    start_session "$session" "$working_dir" "$prompt" "${agent_model:-$DEFAULT_MODEL}" "$agent_cmd"
  done
done

# ── 3. Agentes alive due → iniciar via scheduler ─────────────────────────────
scheduler_output=$(python3 "$BRAION/lib/agent-scheduler.py" 2>/dev/null || echo '{"due":[]}')
due_count=$(echo "$scheduler_output" | jq '.due | length' 2>/dev/null || echo 0)

if [ "$due_count" -gt 0 ]; then
  log "Scheduler: $due_count agente(s) due"

  run_alone_active=false
  marked_agents=""

  echo "$scheduler_output" | jq -r '
    .due[]? | [.name, (.directory // ""), (.model // "claude-sonnet-4-6"), (.run_alone // false | tostring), (.command // "")] | @tsv
  ' 2>/dev/null | while IFS=$'\t' read -r agent_name agent_dir agent_model run_alone agent_cmd; do
    [ -z "$agent_name" ] && continue

    session="braion-${agent_name}"
    heartbeat="$BRAION/agents/${agent_name}/state/heartbeat.json"

    if session_running "$session"; then
      log "SKIP $session — sessão tmux ativa (alive)"
      continue
    fi

    if ! heartbeat_is_processing "$heartbeat"; then
      log "SKIP $session — heartbeat processing recente (alive)"
      continue
    fi

    if [ "$run_alone" = "true" ]; then
      active_sessions=$(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep -c '^braion-' || true)
      if [ "${active_sessions:-0}" -gt 0 ]; then
        log "SKIP $session — run_alone mas há $active_sessions sessão(ões) ativa(s)"
        continue
      fi
    fi

    [ -z "$agent_dir" ] && agent_dir="$BRAION"

    prompt="Read $BRAION/skills/agent-init/SKILL.md and follow the instructions exactly. Agent: $agent_name. BR.AI.ON base: $BRAION. Working directory: $agent_dir."

    start_session "$session" "$agent_dir" "$prompt" "${agent_model:-$DEFAULT_MODEL}" "$agent_cmd"

    python3 "$BRAION/lib/agent-scheduler.py" --mark-ran "$agent_name" > /dev/null 2>&1
    log "Alive: $agent_name iniciado e marcado como ran"
  done
fi

log "Ciclo concluído"
