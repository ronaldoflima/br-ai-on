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
CLI_BACKEND=${CLI_BACKEND:-${CLAUDE:-claude}}
DEFAULT_MODEL=${DEFAULT_MODEL:-claude-sonnet-4-6}
LOG_FILE="$BRAION/logs/agent-cron.log"
STALE_THRESHOLD=${STALE_THRESHOLD:-900}
WAITING_TIMEOUT=${WAITING_TIMEOUT:-1800}

mkdir -p "$(dirname "$LOG_FILE")"

source "$BRAION/lib/telegram.sh"
source "$BRAION/lib/cli.sh"

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

IDLE_DIR="$HOME/.config/br-ai-on/idle"

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

kill_stale_session() {
  local session=$1
  if session_is_idle "$session"; then
    log "KILL $session — claude em prompt idle, sessão concluída"
    session_clear_idle "$session"
    tmux kill-session -t "$session" 2>/dev/null
    return 0
  fi

  local agent_name
  agent_name=$(echo "$session" | sed 's/^braion-//' | sed 's/-HO-.*//')
  local heartbeat="$BRAION/agents/${agent_name}/state/heartbeat.json"

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
  python3 -c "
import yaml, sys
try:
    cfg = yaml.safe_load(open('$config'))
    print(cfg.get('runtime', {}).get('claude', {}).get('permission_mode', 'acceptEdits'))
except Exception:
    print('acceptEdits')
" 2>/dev/null
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

  if [ -n "$config" ] && [ -f "$config" ]; then
    local custom
    custom=$(python3 -c "
import yaml, sys, os
try:
    cfg = yaml.safe_load(open('$config'))
    sp = cfg.get('runtime', {}).get('claude', {}).get('system_prompt', '')
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
  local session=$1 working_dir=${2:-$BRAION} prompt=$3 model=${4:-$DEFAULT_MODEL} perm_mode=${5:-acceptEdits} custom_cmd=${6:-} sp_content=${7:-}
  [ -z "$working_dir" ] && working_dir="$BRAION"
  [ -d "$working_dir" ] || { log "WARN $session — diretório '$working_dir' não existe, usando $BRAION"; working_dir="$BRAION"; }

  if session_running "$session"; then
    log "SKIP $session — sessão tmux ativa"
    return 0
  fi

  session_clear_idle "$session"
  tmux new-session -d -s "$session" -c "$working_dir" "/bin/zsh || /bin/bash || sh"

  if [ -n "$custom_cmd" ]; then
    tmux send-keys -t "$session" "$custom_cmd" Enter
    log "START $session em $working_dir (command=$custom_cmd)"
  else
    local sp_file=""
    if [ -n "$sp_content" ]; then
      sp_file="/tmp/braion-sp-${session}.txt"
      printf '%s' "$sp_content" > "$sp_file"
    fi
    local cmd
    cmd=$(cli_build_start_cmd "$model" "$perm_mode" "$sp_file" "false" "$BRAION" "$HOME/.config/br-ai-on")
    log "START $session: \"$cmd\""
    tmux send-keys -t "$session" "$cmd" Enter
  fi

  # Aguarda Claude estar pronto — hook flag ou fallback grep, máximo 120s
  local waited=0
  while [ $waited -lt 120 ]; do
    sleep 2
    waited=$((waited + 2))
    if session_is_idle "$session"; then
      session_clear_idle "$session"
      break
    fi
  done
  tmux send-keys -t "$session" -l "$prompt"
  tmux send-keys -t "$session" Enter

  # Verifica se Claude recebeu o prompt (sai do estado idle em até 10s)
  local submit_waited=0
  while [ $submit_waited -lt 10 ]; do
    sleep 2
    submit_waited=$((submit_waited + 2))
    if ! session_is_idle "$session"; then
      break
    fi
  done
  # Se ainda idle após 10s, Claude não processou o Enter — tenta novamente
  if session_is_idle "$session"; then
    log "RETRY $session — Claude não saiu do idle após envio do prompt, reenviando Enter"
    tmux send-keys -t "$session" Enter
  fi

  # Watcher em background: invoca /braion:agent-wrapup quando Claude fica idle,
  # aguarda o wrapup terminar e então mata a sessão.
  local log_file="$LOG_FILE"
  local _session="$session"
  local _idle_dir="$IDLE_DIR"
  (
    _idle() {
      [ -f "$_idle_dir/$_session" ]
    }

    sleep 30
    wrapup_sent=false
    while tmux has-session -t "$_session" 2>/dev/null; do
      sleep 5
      if _idle; then
        if [ "$wrapup_sent" = false ]; then
          rm -f "$_idle_dir/$_session"
          cli_send_command "$_session" '/braion:agent-wrapup'
          wrapup_sent=true
          echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] WRAPUP $_session — /braion:agent-wrapup enviado" >> "$log_file"
          sleep 60
        else
          rm -f "$_idle_dir/$_session"
          tmux kill-session -t "$_session" 2>/dev/null
          echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE $_session — sessão encerrada após wrapup" >> "$log_file"
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
  inbox_sp=$(build_agent_system_prompt "inbox-router" "$BRAION/agents/inbox-router/config.yaml")
  start_session "braion-inbox-router" "$BRAION" \
    "Read $BRAION/commands/braion/agent-inbox-router.md and follow the instructions exactly. ${folder_param}Agent: inbox-router. BR.AI.ON base: $BRAION." \
    "${inbox_router_model:-$DEFAULT_MODEL}" "acceptEdits" "" "$inbox_sp"
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
    tg_cmd=$(cli_build_start_cmd "$DEFAULT_MODEL" "bypassPermissions" "$tg_sp_file" "true")
    tmux send-keys -t "$session" "$tg_cmd" Enter
    local waited=0
    while [ $waited -lt 30 ]; do
      sleep 2; waited=$((waited + 2))
      if session_is_idle "$session"; then
        session_clear_idle "$session"
        break
      fi
    done
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

  working_dir=$(awk '/^directory:/{print $2}' "$config" 2>/dev/null || echo "")
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
        cli_send_command "braion-${agent}" "/braion:agent-inbox-router ${claimed_path}"
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
              cli_send_command "braion-${agent}" "/braion:agent-inbox-router ${claimed_reply}"
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

    start_session "$session" "$working_dir" "$prompt" "${agent_model:-$DEFAULT_MODEL}" "${agent_perm:-acceptEdits}" "$agent_cmd" "$agent_sp"
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
    .due[]? | [.name, (.directory // ""), (.model // "claude-sonnet-4-6"), (.run_alone // false | tostring), (.command // ""), (.permission_mode // "acceptEdits")] | join("\u001f")
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

    start_session "$session" "$agent_dir" "$prompt" "${agent_model:-$DEFAULT_MODEL}" "${agent_perm:-acceptEdits}" "$agent_cmd" "$alive_sp"

    python3 "$BRAION/lib/agent-scheduler.py" --mark-ran "$agent_name" > /dev/null 2>&1
    log "Alive: $agent_name iniciado e marcado como ran"
  done
fi

log "Ciclo concluído"
