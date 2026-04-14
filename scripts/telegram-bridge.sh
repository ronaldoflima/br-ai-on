#!/usr/bin/env bash
# scripts/telegram-bridge.sh
# Telegram ↔ AI CLI bridge via tmux long-polling
#
# Uso: bash scripts/telegram-bridge.sh
#      Mantém sessões tmux com prefixo "braion-telegram-<chat_id>"
#
# Comandos Telegram:
#   /start   — mensagem de boas-vindas
#   /clear   — limpa contexto do backend AI (/clear)
#   /reset   — destrói e recria a sessão
#   /status  — mostra estado da sessão
#   qualquer texto — enviado ao backend AI

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
BRAION="$(cd "$(dirname "$0")/.." && pwd)"
echo "BRAION: $BRAION"
[ -f "$BRAION/.env" ] && set -a && source "$BRAION/.env" && set +a

BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
ALLOWED_CHAT="${TELEGRAM_ALLOWED_CHAT_ID:-}"
SESSION_PREFIX="braion-telegram"
OFFSET_FILE="/tmp/tgbridge-offset-$(whoami).txt"
LOG_FILE="$BRAION/logs/telegram-bridge.log"
IDLE_TIMEOUT=180   # segundos aguardando resposta do backend AI
RESPONSE_LINES=300 # máximo de linhas a capturar

mkdir -p "$(dirname "$LOG_FILE")"

# ── Utilidades ────────────────────────────────────────────────────────────────
source "$BRAION/lib/telegram.sh"
source "$BRAION/lib/cli.sh"
DEFAULT_MODEL="${DEFAULT_MODEL:-$(cli_default_model)}"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

strip_ansi() {
  sed 's/\x1B\[[0-9;]*[mGKHFJABCDEFnsu]//g; s/\x1B[()][A-Z]//g; s/\r//g'
}

clean_response() {
  local glyph
  glyph=$(cli_prompt_glyph)
  local filter="cat"
  [ -n "$glyph" ] && filter="grep -v \"^$glyph\""
  strip_ansi \
    | grep -v '^[[:space:]]*$' \
    | grep -v '^─\+$' \
    | grep -v 'auto mode' \
    | grep -v 'accept edits' \
    | grep -v '⏵⏵' \
    | grep -v '│.*tokens' \
    | eval "$filter" \
    | sed '/^$/N;/^\n$/d'
}

# ── Gestão de sessões tmux ─────────────────────────────────────────────────
session_running() {
  tmux has-session -t "$1" 2>/dev/null
}

session_is_idle() { cli_session_is_idle "$1"; }

ensure_session() {
  local session="$1" chat_id="$2"

  if session_running "$session"; then
    return 0
  fi

  log "START $session"
  tmux new-session -d -s "$session" -c "$BRAION" "/bin/zsh || /bin/bash || sh"

  # Exporta variáveis de ambiente para o hook telegram
  tmux set-environment -t "$session" TELEGRAM_CHAT_ID "$chat_id" 2>/dev/null || true
  tmux set-environment -t "$session" TELEGRAM_BOT_TOKEN "$BOT_TOKEN" 2>/dev/null || true

  local prompt_file="$BRAION/prompts/system-prompts/chat-telegram.md"
  local cmd
  cmd=$(cli_build_start_cmd "$DEFAULT_MODEL" "$(cli_permission_mode_map bypass)" "$prompt_file" "true")
  log "START $CLI_BACKEND via cli_build_start_cmd em $session"
  tmux send-keys -t "$session" "$cmd" Enter

  # Aguarda backend estar pronto (máx 5s)
  if cli_wait_ready "$session" 5; then
    log "READY $session"
  else
    log "WARN $session — prompt não detectado após 5s, continuando"
  fi
  return 0
}

# ── Enviar mensagem e aguardar processamento ───────────────────────────────────
# Captura a resposta do backend AI diretamente do tmux.
send_and_wait() {
  local session="$1" message="$2"

  # Captura posição inicial do prompt antes de enviar
  local before_prompt
  before_prompt=$(tmux capture-pane -t "$session" -p 2>/dev/null | tail -1)

  # Envia mensagem
  tmux send-keys -t "$session" -l "$message"
  tmux send-keys -t "$session" Enter

  # Aguarda backend começar a processar — até 10s
  local w=0
  while [ $w -lt 10 ]; do
    sleep 1; w=$((w + 1))
    session_is_idle "$session" || break
  done

  # Aguarda backend terminar — até IDLE_TIMEOUT
  local waited=0
  while [ $waited -lt $IDLE_TIMEOUT ]; do
    sleep 2; waited=$((waited + 2))
    if session_is_idle "$session"; then
      break
    fi
  done

  # Captura resposta do tmux
  local response
  response=$(tmux capture-pane -t "$session" -p -S -"$RESPONSE_LINES" 2>/dev/null \
    | clean_response \
    | sed '/^'"$before_prompt"'/,$d' \
    | head -n -1 \
    | grep -v "^$CLI_BACKEND " \
    | grep -v "^─\+$")

  echo "$response"
}

# ── Handlers de comandos ──────────────────────────────────────────────────────
handle_start() {
  local chat_id="$1" session="$2"
  ensure_session "$session" "$chat_id"
  tg_send "🤖 *BR.AI.ON* conectado
Sessão: \`$session\`
Backend: \`$CLI_BACKEND\`

Envie qualquer mensagem para o backend AI.

Comandos:
• /clear — limpar contexto
• /reset — reiniciar sessão
• /status — estado da sessão
• /pause — pausar agentes
• /unpause — retomar agentes
• /deploy — deploy da branch main
• /deploy <branch> — deploy de branch específica" "$chat_id"
}

handle_clear() {
  local chat_id="$1" session="$2"
  if ! session_running "$session"; then
    tg_send "⚠️ Sem sessão ativa. Envie uma mensagem para iniciar." "$chat_id"
    return
  fi
  cli_send_clear "$session"
  sleep 2
  tg_send "✅ Contexto limpo." "$chat_id"
  log "CLEAR $session"
}

handle_reset() {
  local chat_id="$1" session="$2"
  if session_running "$session"; then
    tmux kill-session -t "$session" 2>/dev/null || true
    log "RESET $session — sessão destruída"
  fi
  sleep 1
  ensure_session "$session" "$chat_id"
  tg_send "🔄 Sessão reiniciada." "$chat_id"
}

handle_status() {
  local chat_id="$1" session="$2"
  if ! session_running "$session"; then
    tg_send "💤 Sem sessão ativa." "$chat_id"
    return
  fi
  if session_is_idle "$session"; then
    tg_send "✅ Sessão \`$session\` ativa e aguardando (backend: $CLI_BACKEND)." "$chat_id"
  else
    tg_send "⏳ Sessão \`$session\` processando (backend: $CLI_BACKEND)..." "$chat_id"
  fi
}

handle_pause() {
  local chat_id="$1"
  touch "$BRAION/.paused"
  tg_send "⏸ BR.AI.ON pausado. Agentes não serão iniciados até /unpause." "$chat_id"
  log "PAUSE — arquivo .paused criado"
}

handle_unpause() {
  local chat_id="$1"
  if [ -f "$BRAION/.paused" ]; then
    rm -f "$BRAION/.paused"
    tg_send "▶️ BR.AI.ON retomado. Agentes voltam ao ciclo normal." "$chat_id"
    log "UNPAUSE — arquivo .paused removido"
  else
    tg_send "ℹ️ BR.AI.ON já estava ativo (sem arquivo .paused)." "$chat_id"
  fi
}

handle_deploy() {
  local chat_id="$1" branch="${2:-main}"
  log "DEPLOY — branch=$branch iniciado por chat_id=$chat_id"
  tg_send "🚀 Deploy iniciado (branch: \`$branch\`)..." "$chat_id"

  local output errors=""

  tg_send "📦 Fazendo checkout e pull..." "$chat_id"
  if ! output=$(cd "$BRAION" && git fetch origin 2>&1); then
    tg_send "❌ Erro no git fetch:
\`\`\`
${output:0:800}
\`\`\`" "$chat_id"
    log "DEPLOY ERROR git fetch: $output"
    return
  fi

  local origin_ahead
  origin_ahead=$(cd "$BRAION" && git rev-list main..origin/main --count 2>/dev/null || echo 0)
  if [ "$origin_ahead" -gt 0 ]; then
    tg_send "⚠️ origin/main tem ${origin_ahead} commit(s) à frente do local. Faça pull de main antes de deployar." "$chat_id"
    log "DEPLOY ABORT — origin/main ${origin_ahead} commit(s) à frente"
    return
  fi

  local git_cmds="git checkout \"$branch\" && git pull origin \"$branch\""
  [ "$branch" != "main" ] && git_cmds="$git_cmds && git pull origin main"
  if ! output=$(cd "$BRAION" && eval "$git_cmds" 2>&1); then
    errors="$output"
    tg_send "❌ Erro no git:
\`\`\`
${errors:0:800}
\`\`\`" "$chat_id"
    log "DEPLOY ERROR git: $errors"
    return
  fi

  tg_send "📦 Instalando dependências..." "$chat_id"
  if ! output=$(cd "$BRAION/dashboard" && npm install 2>&1); then
    tg_send "❌ Erro no npm install:
\`\`\`
${output:0:800}
\`\`\`" "$chat_id"
    log "DEPLOY ERROR npm install: $output"
    return
  fi

  tg_send "🔨 Building..." "$chat_id"
  rm -rf "$BRAION/dashboard/.next"
  if ! output=$(cd "$BRAION/dashboard" && npm run build 2>&1); then
    tg_send "❌ Erro no npm build:
\`\`\`
${output:0:800}
\`\`\`" "$chat_id"
    log "DEPLOY ERROR npm build: $output"
    return
  fi

  tg_send "🔄 Reiniciando serviço..." "$chat_id"
  local uid
  uid=$(id -u)
  if ! output=$(XDG_RUNTIME_DIR="/run/user/${uid}" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${uid}/bus" systemctl --user stop braion 2>&1 && XDG_RUNTIME_DIR="/run/user/${uid}" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${uid}/bus" systemctl --user start braion 2>&1); then
    tg_send "❌ Erro no systemctl:
\`\`\`
${output:0:800}
\`\`\`" "$chat_id"
    log "DEPLOY ERROR systemctl: $output"
    return
  fi

  tg_send "✅ Deploy concluído! Branch \`$branch\` em produção." "$chat_id"
  log "DEPLOY OK — branch=$branch"
}

handle_message() {
  local chat_id="$1" session="$2" text="$3"

  ensure_session "$session" "$chat_id"

  if ! session_is_idle "$session"; then
    tg_send "⏳ Backend AI ainda está processando a mensagem anterior. Aguarde." "$chat_id"
    return
  fi

  tg_typing "$chat_id"

  log "MSG $session: ${text:0:80}"
  local response
  response=$(send_and_wait "$session" "$text")

  if [ -n "$response" ]; then
    tg_send "$response" "$chat_id"
    log "DONE $session — resposta enviada (${#response} chars)"
  else
    log "WARN $session — resposta vazia. Aguardando hook"
  fi
}

# ── Loop principal de long-polling ────────────────────────────────────────────
main() {
  [ -z "$BOT_TOKEN" ] && { echo "TELEGRAM_BOT_TOKEN não definido"; exit 1; }

  local offset
  offset=$(cat "$OFFSET_FILE" 2>/dev/null || echo 0)

  log "START telegram-bridge (@br_ai_on_bot) — offset=$offset — backend=$CLI_BACKEND"

  while true; do
    local updates
    updates=$(curl -s --max-time 35 \
      "https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30&allowed_updates=%5B%22message%22%5D" \
      2>/dev/null || echo '{"ok":false}')

    if [ "$(echo "$updates" | jq -r '.ok' 2>/dev/null)" != "true" ]; then
      log "WARN getUpdates falhou, aguardando 5s"
      sleep 5
      continue
    fi

    local count
    count=$(echo "$updates" | jq '.result | length' 2>/dev/null || echo 0)

    if [ "$count" -eq 0 ]; then
      continue
    fi

    # Processa cada update sequencialmente
    local i=0
    while [ $i -lt "$count" ]; do
      local update update_id chat_id text
      update=$(echo "$updates" | jq -c ".result[$i]")
      update_id=$(echo "$update" | jq -r '.update_id')
      chat_id=$(echo "$update" | jq -r '.message.chat.id // empty' 2>/dev/null)
      text=$(echo "$update" | jq -r '.message.text // empty' 2>/dev/null)

      offset=$((update_id + 1))
      echo "$offset" > "$OFFSET_FILE"

      i=$((i + 1))

      [ -z "$chat_id" ] || [ -z "$text" ] && continue

      # Verificar acesso
      if [ -n "$ALLOWED_CHAT" ] && [ "$chat_id" != "$ALLOWED_CHAT" ]; then
        log "DENY chat_id=$chat_id"
        tg_send "⛔ Acesso não autorizado." "$chat_id"
        continue
      fi

      local session="${SESSION_PREFIX}" #TODO futuramente colocar com chat_id para isolar sessões por usuário, mas por enquanto só tem uma sessão global

      case "$text" in
        /start)       handle_start   "$chat_id" "$session" ;;
        /clear)       handle_clear   "$chat_id" "$session" ;;
        /reset)       handle_reset   "$chat_id" "$session" ;;
        /status)      handle_status  "$chat_id" "$session" ;;
        /pause)       handle_pause   "$chat_id" ;;
        /unpause)     handle_unpause "$chat_id" ;;
        /deploy)      handle_deploy  "$chat_id" "main" ;;
        /deploy\ *)   handle_deploy  "$chat_id" "${text#/deploy }" ;;
        /*)           tg_send "Comando desconhecido. Use /start, /clear, /reset, /status, /pause, /unpause ou /deploy [branch]." "$chat_id" ;;
        *)            handle_message "$chat_id" "$session" "$text" ;;
      esac

    done
  done
}

main "$@"
