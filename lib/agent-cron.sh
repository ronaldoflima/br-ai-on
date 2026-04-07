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
OBSIDIAN_VAULT=${OBSIDIAN_VAULT:-$HOME/obsidian}
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
  [ -f "$config" ] || return 0
  awk '/^model:/{gsub(/"/,"",$2); print $2}' "$config" 2>/dev/null
}

get_agent_command() {
  local config=$1
  [ -f "$config" ] || return 0
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
    tmux send-keys -t "$session" "$CLAUDE --model $model --permission-mode acceptEdits" Enter
    log "START $session em $working_dir (model=$model)"
  fi

  # Aguarda Claude estar pronto (prompt ❯ visível), máximo 30s
  local waited=0
  while [ $waited -lt 30 ]; do
    sleep 1
    waited=$((waited + 1))
    if tmux capture-pane -t "$session" -p 2>/dev/null | grep -qP '\xe2\x9d\xaf'; then
      break
    fi
  done
  tmux send-keys -t "$session" -l "$prompt"
  tmux send-keys -t "$session" Enter

  # Watcher em background: mata o tmux quando Claude volta ao prompt ❯ (sessão concluída)
  local log_file="$LOG_FILE"
  local _session="$session"
  (
    sleep 30
    while tmux has-session -t "$_session" 2>/dev/null; do
      sleep 10
      # Usa grep '^❯' (início de linha) — mesmo critério de session_is_idle.
      # Confirma 2x com 5s de intervalo para evitar falso positivo durante execução.
      if tmux capture-pane -t "$_session" -p 2>/dev/null \
          | grep -v '^[[:space:]]*$' | grep -v '^─\+$' \
          | grep -v 'auto mode' | tail -1 | grep -q '^❯'; then
        sleep 5
        if tmux capture-pane -t "$_session" -p 2>/dev/null \
            | grep -v '^[[:space:]]*$' | grep -v '^─\+$' \
            | grep -v 'auto mode' | tail -1 | grep -q '^❯'; then
          tmux kill-session -t "$_session" 2>/dev/null
          echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE $_session — sessão encerrada automaticamente" >> "$log_file"
          break
        fi
      fi
    done
  ) &
  disown $!
}

# ── 0. Sincronizar Obsidian vault ─────────────────────────────────────────────
git_pull_vault() {
  local dir=$1
  local root
  root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || return 0
  git -C "$root" pull --quiet 2>/dev/null \
    && log "Obsidian: pull OK ($root)" \
    || log "Obsidian: pull falhou em $root (continuando com versão local)"
}

# Puxar vault padrão
[ -d "$OBSIDIAN_VAULT" ] && git_pull_vault "$OBSIDIAN_VAULT"

# Puxar repos git das pastas de integration rules (evita duplicatas)
if [ -f "$BRAION/config/integrations.json" ] && command -v jq >/dev/null 2>&1; then
  pulled_roots=""
  rule_count_sync=$(jq '.obsidian_rules | length' "$BRAION/config/integrations.json" 2>/dev/null || echo 0)
  for i in $(seq 0 $(( rule_count_sync - 1 ))); do
    enabled_sync=$(jq -r ".obsidian_rules[$i].enabled" "$BRAION/config/integrations.json" 2>/dev/null || echo "false")
    [ "$enabled_sync" = "true" ] || continue
    folder_sync=$(jq -r ".obsidian_rules[$i].folder" "$BRAION/config/integrations.json" 2>/dev/null || echo "")
    [ -d "$folder_sync" ] || continue
    root_sync=$(git -C "$folder_sync" rev-parse --show-toplevel 2>/dev/null) || continue
    echo "$pulled_roots" | grep -qF "$root_sync" && continue
    [ "$root_sync" = "$OBSIDIAN_VAULT" ] && continue
    git_pull_vault "$folder_sync"
    pulled_roots="$pulled_roots $root_sync"
  done
fi

# ── 1a. Obsidian inbox → roteamento via integrations.json (regras determinísticas) ──
INTEGRATIONS_FILE="$BRAION/config/integrations.json"
AI_ROUTE_FOLDERS=""

if [ -f "$INTEGRATIONS_FILE" ] && command -v jq >/dev/null 2>&1; then
  rule_count=$(jq '.obsidian_rules | length' "$INTEGRATIONS_FILE" 2>/dev/null || echo 0)

  for i in $(seq 0 $(( rule_count - 1 ))); do
    enabled=$(jq -r ".obsidian_rules[$i].enabled" "$INTEGRATIONS_FILE" 2>/dev/null || echo "false")
    [ "$enabled" = "true" ] || continue

    folder=$(jq -r ".obsidian_rules[$i].folder" "$INTEGRATIONS_FILE" 2>/dev/null || echo "")
    [ -d "$folder" ] || continue

    filter_type=$(jq -r ".obsidian_rules[$i].filter.type" "$INTEGRATIONS_FILE" 2>/dev/null || echo "none")
    filter_value=$(jq -r ".obsidian_rules[$i].filter.value" "$INTEGRATIONS_FILE" 2>/dev/null || echo "")
    agent=$(jq -r ".obsidian_rules[$i].agent" "$INTEGRATIONS_FILE" 2>/dev/null || echo "")
    [ -n "$agent" ] || continue

    # Regras com agent=inbox-router: delegar ao AI para roteamento inteligente
    if [ "$agent" = "inbox-router" ]; then
      AI_ROUTE_FOLDERS="$AI_ROUTE_FOLDERS $folder"
      continue
    fi

    while IFS= read -r -d '' note_file; do
      grep -q "^assigned_to:" "$note_file" 2>/dev/null && continue

      case "$filter_type" in
        tag)
          grep -q "#${filter_value}" "$note_file" 2>/dev/null || continue
          ;;
        property)
          awk '/^---/{found=!found} found && /^'"${filter_value}"':/' "$note_file" 2>/dev/null | grep -q . || continue
          ;;
      esac

      first_line=$(head -1 "$note_file" 2>/dev/null | sed 's/^#[[:space:]]*//' || echo "$(basename "$note_file")")
      content=$(cat "$note_file" 2>/dev/null || echo "")

      bash "$BRAION/lib/handoff.sh" send "inbox-router" "$agent" action null \
        "$first_line" \
        "$content" \
        "Processar conforme o conteúdo da nota" 2>/dev/null && {

        python3 -c "
import sys, re
path = sys.argv[1]; agent = sys.argv[2]
content = open(path).read()
if content.startswith('---'):
    content = content.replace('---\n', '---\nassigned_to: ' + agent + '\n', 1)
else:
    content = '---\nassigned_to: ' + agent + '\n---\n' + content
open(path, 'w').write(content)
" "$note_file" "$agent" 2>/dev/null

        forwarded_dir="$folder/forwarded"
        mkdir -p "$forwarded_dir"
        mv "$note_file" "$forwarded_dir/$(basename "$note_file")"
        log "Inbox: roteado $(basename "$note_file") → $agent"
      }
    done < <(find "$folder" -maxdepth 1 -name "*.md" -not -name ".*" -print0 2>/dev/null)
  done
fi

# ── 1b. Obsidian inbox → roteamento AI via inbox-router (notas sem regra direta) ──
inbox_router_model=$(get_agent_model "$BRAION/agents/inbox-router/config.yaml")
inbox_router_heartbeat="$BRAION/agents/inbox-router/state/heartbeat.json"

for check_dir in "$OBSIDIAN_INBOX" $AI_ROUTE_FOLDERS; do
  [ -d "$check_dir" ] || continue
  dir_count=$(grep -rL "assigned_to:" "$check_dir" --include="*.md" 2>/dev/null | grep -v '/\.' | wc -l | xargs || true)
  [ "${dir_count:-0}" -gt 0 ] || continue

  if session_running "braion-inbox-router"; then
    log "SKIP braion-inbox-router — sessão ativa, $dir_count nota(s) em $check_dir aguardam próximo ciclo"
    continue
  fi

  if ! heartbeat_is_processing "$inbox_router_heartbeat"; then
    log "SKIP braion-inbox-router — heartbeat processing recente"
    continue
  fi

  folder_param=""
  [ "$check_dir" != "$OBSIDIAN_INBOX" ] && folder_param="Folder: $check_dir. "

  log "Inbox: $dir_count nota(s) em $check_dir — iniciando inbox-router AI"
  start_session "braion-inbox-router" "$BRAION" \
    "Read $BRAION/skills/agent-inbox-router/SKILL.md and follow the instructions exactly. ${folder_param}Agent: inbox-router. BR.AI.ON base: $BRAION." \
    "${inbox_router_model:-$DEFAULT_MODEL}"
  break
done

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
