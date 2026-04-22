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

# Carrega variáveis do .env se existir
if [ -f "$BRAION/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$BRAION/.env"
  set +a
fi
OBSIDIAN_VAULT=${OBSIDIAN_VAULT:-$HOME/obsidian}
OBSIDIAN_BASE=${OBSIDIAN_BASE:-geral}
OBSIDIAN_INBOX=${OBSIDIAN_INBOX:-$OBSIDIAN_VAULT/$OBSIDIAN_BASE/agents/inbox}
LOG_FILE="$BRAION/logs/agent-cron.log"
STALE_THRESHOLD=${STALE_THRESHOLD:-900}
WAITING_TIMEOUT=${WAITING_TIMEOUT:-1800}
REVIEW_TIMEOUT=${REVIEW_TIMEOUT:-259200}

mkdir -p "$(dirname "$LOG_FILE")"

source "$BRAION/lib/telegram.sh"
source "$BRAION/lib/cli.sh"
DEFAULT_MODEL=${DEFAULT_MODEL:-$(cli_default_model)}

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG_FILE"
}

# ── 0a. Telegram bridge ───────────────────────────────────────────────────────
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  if ! pgrep -u "$(whoami)" -f "telegram-bridge.sh" > /dev/null 2>&1; then
    log "Telegram bridge não está rodando — iniciando em background"
    nohup bash "$BRAION/scripts/telegram-bridge.sh" >> "$BRAION/logs/telegram-bridge.log" 2>&1 &
    disown $!
  fi
fi

# ── Pause check ───────────────────────────────────────────────────────────────
if [ -f "$BRAION/.paused" ]; then
  log "PAUSED — arquivo .paused existe, saindo sem iniciar agentes"
  exit 0
fi

session_running() {
  tmux has-session -t "$1" 2>/dev/null
}

IDLE_DIR="${IDLE_DIR:-$HOME/.config/br-ai-on/idle}"

session_is_idle()    { cli_session_is_idle    "$1"; }
session_clear_idle() { cli_session_clear_idle "$1"; }

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

heartbeat_is_awaiting_review() {
  local heartbeat_file=$1
  [ -f "$heartbeat_file" ] || return 1
  local status
  status=$(jq -r '.status // ""' "$heartbeat_file" 2>/dev/null || echo "")
  [ "$status" = "awaiting_review" ]
}

heartbeat_review_expired() {
  local heartbeat_file=$1
  [ -f "$heartbeat_file" ] || return 0
  local waiting_since now elapsed
  waiting_since=$(jq -r '.waiting_since // ""' "$heartbeat_file" 2>/dev/null || echo "")
  [ -z "$waiting_since" ] && return 0
  now=$(date -u +%s)
  elapsed=$(( now - $(date -u -d "$waiting_since" +%s 2>/dev/null || echo 0) ))
  [ "$elapsed" -gt "$REVIEW_TIMEOUT" ]
}

kill_stale_session() {
  local session=$1

  local agent_name
  agent_name=$(echo "$session" | sed 's/^braion-//' | sed 's/-HO-.*//')
  local heartbeat="$BRAION/agents/${agent_name}/state/heartbeat.json"

  if heartbeat_is_awaiting_review "$heartbeat"; then
    if heartbeat_review_expired "$heartbeat"; then
      log "KILL $session — review timeout expirado (> ${REVIEW_TIMEOUT}s)"
      tmux kill-session -t "$session" 2>/dev/null
      return 0
    fi
    return 1
  fi

  if session_is_idle "$session"; then
    log "KILL $session — $CLI_BACKEND em prompt idle, sessão concluída"
    session_clear_idle "$session"
    tmux kill-session -t "$session" 2>/dev/null
    return 0
  fi

  if heartbeat_is_waiting "$heartbeat"; then
    if heartbeat_waiting_expired "$heartbeat"; then
      log "KILL $session — waiting timeout expirado (> ${WAITING_TIMEOUT}s)"
      local waiting_for
      waiting_for=$(jq -r '.waiting_for // ""' "$heartbeat" 2>/dev/null || echo "")
      if [[ "$waiting_for" == JOB-* ]]; then
        bash "$BRAION/lib/job.sh" fail "$waiting_for" "$agent_name" "waiting_timeout" 2>/dev/null || true
        log "JOB $waiting_for — $agent_name marcado como falha (timeout)"
      fi
      tmux kill-session -t "$session" 2>/dev/null
      return 0
    fi
    return 1
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

heartbeat_is_waiting() {
  local heartbeat_file=$1
  [ -f "$heartbeat_file" ] || return 1
  local status
  status=$(jq -r '.status // ""' "$heartbeat_file" 2>/dev/null || echo "")
  [ "$status" = "waiting" ]
}

heartbeat_waiting_expired() {
  local heartbeat_file=$1
  [ -f "$heartbeat_file" ] || return 0
  local waiting_since now elapsed
  waiting_since=$(jq -r '.waiting_since // ""' "$heartbeat_file" 2>/dev/null || echo "")
  [ -z "$waiting_since" ] && return 0
  now=$(date -u +%s)
  elapsed=$(( now - $(date -u -d "$waiting_since" +%s 2>/dev/null || echo 0) ))
  [ "$elapsed" -gt "$WAITING_TIMEOUT" ]
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

get_agent_permission_mode() {
  local config=$1
  [ -f "$config" ] || return 0
  local raw
  raw=$(python3 -c "
import yaml, sys, os
backend = os.environ.get('CLI_BACKEND', 'claude')
try:
    cfg = yaml.safe_load(open('$config')) or {}
    runtime = cfg.get('runtime', {}) or {}
    val = runtime.get('permission_mode')
    if val is None:
        val = runtime.get(backend, {}).get('permission_mode')
    if val is None and backend != 'claude':
        val = runtime.get('claude', {}).get('permission_mode')
    print(val if val is not None else '')
except Exception:
    print('')
" 2>/dev/null)
  cli_permission_mode_map "$raw"
}

read_rotated_state() {
  local dir="$1" n="${2:-5}" legacy_file="${3:-}"
  if [ -d "$dir" ]; then
    ls "$dir"/*.md 2>/dev/null | sort | tail -n "$n" | while read f; do
      cat "$f"
      echo ""
    done
  elif [ -n "$legacy_file" ] && [ -f "$legacy_file" ]; then
    cat "$legacy_file"
  fi
}

state_cleanup() {
  local cutoff_date
  cutoff_date=$(date -u -d "30 days ago" +%Y-%m-%d)
  for agent_dir in "$BRAION"/agents/*/state; do
    [ -d "$agent_dir" ] || continue
    for subdir in current_objective decisions completed_tasks; do
      local dir="$agent_dir/$subdir"
      [ -d "$dir" ] || continue
      for f in "$dir"/*.md; do
        [ -f "$f" ] || continue
        local basename
        basename=$(basename "$f" .md)
        [[ "$basename" < "$cutoff_date" ]] && rm "$f"
      done
    done
  done
}

build_agent_system_prompt() {
  local agent=$1 config=${2:-}
  local content=""

  local identity="$BRAION/agents/$agent/IDENTITY.md"
  [ -f "$identity" ] && content=$(cat "$identity")

  local user_md="$BRAION/USER.md"
  [ -f "$user_md" ] && content="${content}"$'\n\n'"$(cat "$user_md")"

  local agents_md="$BRAION/AGENTS.md"
  [ -f "$agents_md" ] && content="${content}"$'\n\n'"$(cat "$agents_md")"

  local agent_dir="$BRAION/agents/$agent"

  # Estado persistente (rotativo com fallback legado)
  local state_block=""
  local obj_content dec_content tasks_content
  obj_content=$(read_rotated_state "$agent_dir/state/current_objective" 1 "$agent_dir/state/current_objective.md")
  dec_content=$(read_rotated_state "$agent_dir/state/decisions" 5 "$agent_dir/state/decisions.md")
  tasks_content=$(read_rotated_state "$agent_dir/state/completed_tasks" 5 "$agent_dir/state/completed_tasks.md")
  [ -n "$obj_content" ]   && state_block="${state_block}"$'\n\n### Objetivo Atual\n'"${obj_content}"
  [ -n "$dec_content" ]   && state_block="${state_block}"$'\n\n### Decisões Recentes\n'"${dec_content}"
  [ -n "$tasks_content" ] && state_block="${state_block}"$'\n\n### Tarefas Concluídas Recentes\n'"${tasks_content}"
  [ -n "$state_block" ] && content="${content}"$'\n\n## Estado da Sessão Anterior'"${state_block}"

  # Memória
  local mem_block=""
  local sem_file="$agent_dir/memory/semantic.md"
  local epi_file="$agent_dir/memory/episodic.jsonl"
  [ -f "$sem_file" ] && mem_block="${mem_block}"$'\n\n### Memória Semântica\n'"$(cat "$sem_file")"
  [ -f "$epi_file" ] && mem_block="${mem_block}"$'\n\n### Episódios Recentes\n'"$(tail -n 10 "$epi_file")"
  [ -n "$mem_block" ] && content="${content}"$'\n\n## Memória'"${mem_block}"

  # Handoffs pendentes
  local inbox_dir="$agent_dir/handoffs/inbox"
  if [ -d "$inbox_dir" ]; then
    local handoff_block=""
    for hf in "$inbox_dir"/HO-*.md; do
      [ -f "$hf" ] || continue
      handoff_block="${handoff_block}"$'\n\n---\n'"$(cat "$hf")"
    done
    if [ -n "$handoff_block" ]; then
      local ts
      ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      content="${content}"$'\n\n## Handoffs Pendentes (lidos em '"$ts"')'"${handoff_block}"
    fi
  fi

  if [ -n "$config" ] && [ -f "$config" ]; then
    local custom
    custom=$(python3 -c "
import yaml, sys, os
braion = os.environ.get('BRAION', os.path.dirname(os.path.dirname(os.path.abspath('$config'))))
backend = os.environ.get('CLI_BACKEND', 'claude')
try:
    cfg = yaml.safe_load(open('$config')) or {}

    # collaborators capabilities
    collaborators = cfg.get('collaborators') or []
    if collaborators:
        lines = ['## Colaboradores']
        for col in collaborators:
            name = col.get('agent', '')
            if not name:
                continue
            col_config = os.path.join(braion, 'agents', name, 'config.yaml')
            try:
                col_cfg = yaml.safe_load(open(col_config)) or {}
                caps = col_cfg.get('capabilities') or []
                reason = col.get('reason', '')
                line = f'- **{name}**: ' + '; '.join(caps)
                if reason:
                    line += f' ({reason})'
                lines.append(line)
            except Exception:
                pass
        if len(lines) > 1:
            print('\n'.join(lines))

    # runtime.system_prompt
    runtime = cfg.get('runtime', {}) or {}
    sp = runtime.get('system_prompt')
    if not sp:
        sp = runtime.get(backend, {}).get('system_prompt', '')
    if not sp and backend != 'claude':
        sp = runtime.get('claude', {}).get('system_prompt', '')
    if not sp: sys.exit(0)
    if os.path.isfile(sp): sp = open(sp).read().strip()
    if sp: print(sp)
except Exception: pass
" 2>/dev/null)
    [ -n "$custom" ] && content="${content}"$'\n\n'"${custom}"
  fi

  printf '%s' "$content"
}

start_session() {
  local session=$1 working_dir=${2:-$BRAION} prompt=$3 model=${4:-$DEFAULT_MODEL} perm_mode=${5:-$(cli_permission_mode_default)} custom_cmd=${6:-} sp_content=${7:-}
  [ -z "$working_dir" ] && working_dir="$BRAION"
  [ -d "$working_dir" ] || { log "WARN $session — diretório '$working_dir' não existe, usando $BRAION"; working_dir="$BRAION"; }

  if session_running "$session"; then
    log "SKIP $session — sessão tmux ativa"
    return 0
  fi

  session_clear_idle "$session"
  tmux new-session -d -s "$session" -c "$working_dir" "/bin/zsh || /bin/bash || sh"
  sleep 1  # aguarda shell inicializar antes de enviar comandos

  if [ -n "$custom_cmd" ]; then
    tmux send-keys -t "$session" "$custom_cmd" Enter
    log "START $session em $working_dir (command=$custom_cmd)"
  else
    local sp_file=""
    if [ -n "$sp_content" ]; then
      # mktemp evita colisão de permissão com arquivos criados por outros usuários
      sp_file=$(mktemp "/tmp/braion-sp-${session}-XXXXXX.txt" 2>/dev/null) || sp_file="/tmp/braion-sp-${session}-$$.txt"
      printf '%s' "$sp_content" > "$sp_file"
    fi
    local cmd
    cmd=$(cli_build_start_cmd "$model" "$perm_mode" "$sp_file" "false" "$BRAION" "$HOME/.config/br-ai-on")
    log "START $session: \"$cmd\""
    tmux send-keys -t "$session" "$cmd" Enter
  fi

  # Aguarda backend estar pronto — hook flag ou fallback, máximo 120s
  cli_wait_ready "$session" 120 || true
  tmux send-keys -t "$session" -l "$prompt"
  tmux send-keys -t "$session" Enter

  # Verifica se o backend está processando o prompt (tokens > 0 ou pane mudou).
  # cli_wait_ready já consumiu o idle flag, então não podemos usar session_is_idle
  # para detectar início do processamento — usamos conteúdo do pane.
  local submit_waited=0
  local pane_before
  pane_before=$(tmux capture-pane -t "$session" -p 2>/dev/null | tail -3)
  while [ $submit_waited -lt 10 ]; do
    sleep 2
    submit_waited=$((submit_waited + 2))
    local pane_now
    pane_now=$(tmux capture-pane -t "$session" -p 2>/dev/null | tail -3)
    if [ "$pane_now" != "$pane_before" ]; then
      break  # pane mudou → Claude está processando
    fi
  done
  # Se pane não mudou após 10s, o Enter não foi aceito — tenta novamente
  local pane_final
  pane_final=$(tmux capture-pane -t "$session" -p 2>/dev/null | tail -3)
  if [ "$pane_final" = "$pane_before" ]; then
    log "RETRY $session — pane sem mudança após envio do prompt, reenviando Enter"
    tmux send-keys -t "$session" Enter
  fi

  # Watcher em background: invoca /braion:agent-wrapup quando backend fica idle.
  # Se o wrapup entrar em modo review (awaiting_review), aguarda interação do
  # usuário ou timeout antes de encerrar.
  local log_file="$LOG_FILE"
  local _session="$session"
  local _idle_dir="$IDLE_DIR"
  local _agent_name
  _agent_name=$(echo "$session" | sed 's/^braion-//' | sed 's/-HO-.*//')
  local _heartbeat="$BRAION/agents/${_agent_name}/state/heartbeat.json"
  local _review_timeout="$REVIEW_TIMEOUT"
  (
    _idle() {
      [ -f "$_idle_dir/$_session" ]
    }

    _heartbeat_status() {
      jq -r '.status // ""' "$_heartbeat" 2>/dev/null || echo ""
    }

    _review_expired() {
      local ws now elapsed
      ws=$(jq -r '.waiting_since // ""' "$_heartbeat" 2>/dev/null || echo "")
      [ -z "$ws" ] && return 0
      now=$(date -u +%s)
      elapsed=$(( now - $(date -u -d "$ws" +%s 2>/dev/null || echo 0) ))
      [ "$elapsed" -gt "$_review_timeout" ]
    }

    sleep 30
    wrapup_sent=false
    while tmux has-session -t "$_session" 2>/dev/null; do
      sleep 5
      if _idle; then
        local status
        status=$(_heartbeat_status)

        if [ "$status" = "awaiting_review" ]; then
          if _review_expired; then
            echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] REVIEW_TIMEOUT $_session — review timeout expirado, enviando wrapup final" >> "$log_file"
            rm -f "$_idle_dir/$_session"
            cli_send_slash_command "$_session" '/braion:agent-wrapup'
            sleep 60
            rm -f "$_idle_dir/$_session"
            tmux kill-session -t "$_session" 2>/dev/null
            echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE $_session — sessão encerrada após review timeout" >> "$log_file"
            break
          fi
          continue
        fi

        if [ "$wrapup_sent" = false ]; then
          rm -f "$_idle_dir/$_session"
          cli_send_slash_command "$_session" '/braion:agent-wrapup'
          wrapup_sent=true
          echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] WRAPUP $_session — /braion:agent-wrapup enviado" >> "$log_file"
          sleep 60
        else
          rm -f "$_idle_dir/$_session"
          tmux kill-session -t "$_session" 2>/dev/null
          echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE $_session — sessão encerrada após wrapup" >> "$log_file"
          break
        fi
      else
        if [ "$wrapup_sent" = true ] && [ "$(_heartbeat_status)" = "awaiting_review" ]; then
          wrapup_sent=false
          echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] REVIEW_INTERACT $_session — interação detectada, reset wrapup flag" >> "$log_file"
        fi
      fi
    done
  ) &
  disown $!
}

# ── -1. Limpar sessões stale ──────────────────────────────────────────────────
while IFS= read -r stale_session; do
  [ -n "$stale_session" ] || continue
  kill_stale_session "$stale_session" || true
done < <(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^braion-' | grep -v '^braion-telegram$' || true)

# ── -0.5. Limpeza diária de state rotativos ──────────────────────────────────
local_cleanup_guard="/tmp/braion-state-cleanup-$(date -u +%Y-%m-%d)"
if [ ! -f "$local_cleanup_guard" ]; then
  state_cleanup
  touch "$local_cleanup_guard"
  log "State cleanup executado (cutoff: 30 dias)"
fi

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
  inbox_sp=$(build_agent_system_prompt "inbox-router" "$BRAION/agents/inbox-router/config.yaml")
  start_session "braion-inbox-router" "$BRAION" \
    "Read $BRAION/commands/braion/agent-inbox-router.md and follow the instructions exactly. ${folder_param}Agent: inbox-router. BR.AI.ON base: $BRAION." \
    "${inbox_router_model:-$DEFAULT_MODEL}" "$(cli_permission_mode_default)" "" "$inbox_sp"
  break
done

# ── 2. Handoffs pendentes → iniciar agente responsivo ─────────────────────────
notify_user_handoff() {
  local handoff_file=$1
  local from ho_id description
  from=$(awk '/^from:/{print $2}' "$handoff_file" 2>/dev/null || echo "?")
  ho_id=$(awk '/^id:/{print $2}' "$handoff_file" 2>/dev/null || echo "?")
  description=$(sed -n '/^## Descricao/,/^## /p' "$handoff_file" 2>/dev/null \
    | grep -v '^##' | sed '/^[[:space:]]*$/d' | head -3 | tr '\n' ' ')
  log "Handoff to user from $from: $description"

  [ -z "${TELEGRAM_BOT_TOKEN:-}" ] && return 0

  local session="braion-telegram"

  if ! session_running "$session"; then
    log "Telegram session $session não ativa — iniciando"
    tmux new-session -d -s "$session" -c "$BRAION" "/bin/zsh || /bin/bash || sh"
    tmux set-environment -t "$session" TELEGRAM_CHAT_ID "${TELEGRAM_ALLOWED_CHAT_ID:-}" 2>/dev/null || true
    tmux set-environment -t "$session" TELEGRAM_BOT_TOKEN "$TELEGRAM_BOT_TOKEN" 2>/dev/null || true
    local tg_sp_file="/tmp/braion-sp-${session}.txt"
    printf '%s' 'Output: for Telegram, format for mobile. No tables/ASCII art. Use bullets and short paragraphs. Be concise.' > "$tg_sp_file"
    local tg_cmd
    tg_cmd=$(cli_build_start_cmd "$DEFAULT_MODEL" "$(cli_permission_mode_map bypass)" "$tg_sp_file" "true")
    tmux send-keys -t "$session" "$tg_cmd" Enter
    cli_wait_ready "$session" 30 || true
  fi

  if ! session_is_idle "$session"; then
    log "Handoff $ho_id → telegram direto (sessão $session ocupada)"
    tg_notify "📬 Handoff ${ho_id} de ${from}: ${description}"
    return 0
  fi

  session_clear_idle "$session"
  local prompt="Leia o handoff em ${handoff_file} e comunique ao usuário. É de ${from} (${ho_id}). Resuma de forma concisa para Telegram."
  tmux send-keys -t "$session" -l "$prompt"
  tmux send-keys -t "$session" Enter
  log "Handoff $ho_id → sessão $session para processamento"
  return 0
}

for config in "$BRAION/agents"/*/config.yaml; do
  agent_dir=$(dirname "$config")
  agent=$(basename "$agent_dir")
  [ "$agent" = "shared" ] && continue

  inbox_dir="$agent_dir/handoffs/inbox"
  [ -d "$inbox_dir" ] || continue

  working_dir=$(awk '/^working_directory:/{print $2}' "$config" 2>/dev/null || echo "")
  working_dir="${working_dir/#\~/$HOME}"
  [ -z "$working_dir" ] && working_dir="$BRAION"

  for handoff_file in "$inbox_dir"/HO-*.md; do
    [ -f "$handoff_file" ] || continue

    filename=$(basename "$handoff_file")
    ho_id=$(echo "$filename" | sed -n 's/\(HO-[0-9]*-[0-9]*\)_.*/\1/p')

    expects=$(awk '/^expects:/{print $2}' "$handoff_file" 2>/dev/null || echo "")
    to=$(awk '/^to:/{print $2}' "$handoff_file" 2>/dev/null || echo "")
    job_id=$(awk '/^job_id:/{print $2}' "$handoff_file" 2>/dev/null || echo "")

    # Handoffs para o usuário: arquiva e envia ao braion-telegram para comunicar
    if [ "$to" = "user" ]; then
      log "Handoff $ho_id → user: arquivando e notificando via telegram"
      mkdir -p "$agent_dir/handoffs/archive"
      mv "$handoff_file" "$agent_dir/handoffs/archive/$filename"
      notify_user_handoff "$agent_dir/handoffs/archive/$filename"
      continue
    fi

    # Handoffs expects:info — checar se é reply para sessão waiting antes de arquivar
    if [ "$expects" = "info" ] && [ -z "$job_id" ]; then
      heartbeat="$agent_dir/state/heartbeat.json"
      if session_running "braion-${agent}" && heartbeat_is_waiting "$heartbeat"; then
        log "Handoff $ho_id → injetando em sessão waiting braion-${agent}"
        claimed_path=$(bash "$BRAION/lib/handoff.sh" claim "$agent" "$handoff_file" 2>/dev/null || echo "")
        cli_send_slash_command "braion-${agent}" "/braion:agent-inbox-router ${claimed_path}"
        continue
      fi
      log "Handoff $ho_id expects:info — arquivando sem sessão"
      mkdir -p "$agent_dir/handoffs/archive"
      mv "$handoff_file" "$agent_dir/handoffs/archive/$filename"
      continue
    fi

    # Reply de job — checar se job completou antes de acordar
    # Apenas se o handoff é um REPLY (from != criador do job), não handoff de saída
    from_agent=$(awk '/^from:/{print $2}' "$handoff_file" 2>/dev/null || echo "")
    job_created_by=""
    if [ -n "$job_id" ]; then
      job_created_by=$(bash "$BRAION/lib/job.sh" status "$job_id" 2>/dev/null | jq -r '.created_by' 2>/dev/null || echo "")
    fi
    if [ -n "$job_id" ] && [ "$from_agent" != "$job_created_by" ]; then
      heartbeat="$agent_dir/state/heartbeat.json"

      # Se sessão ativa e waiting — injetar reply quando job completo
      if session_running "braion-${agent}" && heartbeat_is_waiting "$heartbeat"; then
        job_status_val=$(bash "$BRAION/lib/job.sh" status "$job_id" 2>/dev/null | jq -r '.status' 2>/dev/null || echo "unknown")
        if [ "$job_status_val" = "completed" ] || [ "$job_status_val" = "partial_failure" ]; then
          log "JOB $job_id $job_status_val — injetando replies em braion-${agent}"
          for reply_file in "$inbox_dir"/HO-*.md; do
            [ -f "$reply_file" ] || continue
            reply_job=$(awk '/^job_id:/{print $2}' "$reply_file" 2>/dev/null || echo "")
            if [ "$reply_job" = "$job_id" ]; then
              claimed_reply=$(bash "$BRAION/lib/handoff.sh" claim "$agent" "$reply_file" 2>/dev/null || echo "")
              cli_send_slash_command "braion-${agent}" "/braion:agent-inbox-router ${claimed_reply}"
              sleep 2
            fi
          done
          continue
        fi
        log "JOB $job_id still $job_status_val — aguardando mais replies para $agent"
        continue
      fi

      # Se sessão NÃO ativa e job incompleto — aguarda
      job_status_val=$(bash "$BRAION/lib/job.sh" status "$job_id" 2>/dev/null | jq -r '.status' 2>/dev/null || echo "unknown")
      if [ "$job_status_val" != "completed" ] && [ "$job_status_val" != "partial_failure" ]; then
        log "JOB $job_id still $job_status_val — aguardando mais replies"
        continue
      fi
    fi

    session="braion-${agent}-${ho_id}"

    if session_running "$session"; then
      log "SKIP $session — sessão ativa"
      continue
    fi

    # Se o agente tem sessão alive ativa, aguarda ela terminar para evitar escrita concorrente em state/
    if session_running "braion-${agent}"; then
      log "SKIP $session — sessão alive braion-${agent} ativa, handoff será processado no próximo ciclo"
      continue
    fi

    log "Handoff: iniciando $session para $handoff_file"

    prompt="Read $BRAION/commands/braion/agent-handoff.md and follow the instructions exactly. Agent: $agent. Handoff: $handoff_file. BR.AI.ON base: $BRAION. Working directory: $working_dir."
    agent_model=$(get_agent_model "$config")
    agent_cmd=$(get_agent_command "$config")
    agent_perm=$(get_agent_permission_mode "$config")
    agent_sp=$(build_agent_system_prompt "$agent" "$config")

    start_session "$session" "$working_dir" "$prompt" "${agent_model:-$DEFAULT_MODEL}" "${agent_perm:-$(cli_permission_mode_default)}" "$agent_cmd" "$agent_sp"
  done
done

# ── 3. Agentes alive due → iniciar via scheduler ─────────────────────────────
scheduler_output=$(python3 "$BRAION/lib/agent-scheduler.py" 2>/dev/null || echo '{"due":[]}')
due_count=$(echo "$scheduler_output" | jq '.due | length' 2>/dev/null || echo 0)

if [ "$due_count" -gt 0 ]; then
  log "Scheduler: $due_count agente(s) due"

  run_alone_active=false
  marked_agents=""

  _default_model=$(cli_default_model)
  _default_perm=$(cli_permission_mode_default)
  echo "$scheduler_output" | jq -r --arg dm "$_default_model" --arg dp "$_default_perm" '
    .due[]? | [.name, (.directory // ""), (.model // $dm), (.run_alone // false | tostring), (.command // ""), (.permission_mode // $dp)] | join("\u001f")
  ' 2>/dev/null | while IFS=$'\x1f' read -r agent_name agent_dir agent_model run_alone agent_cmd agent_perm; do
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
      active_sessions=$(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^braion-' | grep -v '^braion-telegram$' | wc -l)
      if [ "${active_sessions:-0}" -gt 0 ]; then
        log "SKIP $session — run_alone mas há $active_sessions sessão(ões) ativa(s)"
        continue
      fi
    fi

    [ -z "$agent_dir" ] && agent_dir="$BRAION"

    alive_sp=$(build_agent_system_prompt "$agent_name" "$BRAION/agents/${agent_name}/config.yaml")

    prompt="Read $BRAION/commands/braion/agent-init.md and follow the instructions exactly. Agent: $agent_name. BR.AI.ON base: $BRAION. Working directory: $agent_dir."

    _mapped_perm=$(cli_permission_mode_map "${agent_perm:-$_default_perm}")
    start_session "$session" "$agent_dir" "$prompt" "${agent_model:-$DEFAULT_MODEL}" "$_mapped_perm" "$agent_cmd" "$alive_sp"

    python3 "$BRAION/lib/agent-scheduler.py" --mark-ran "$agent_name" > /dev/null 2>&1
    log "Alive: $agent_name iniciado e marcado como ran"
  done
fi

log "Ciclo concluído"
