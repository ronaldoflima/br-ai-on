#!/usr/bin/env bash
# scripts/telegram-bridge.sh
# Telegram ↔ Claude Code bridge via tmux long-polling
#
# Uso: bash scripts/telegram-bridge.sh
#      Mantém sessões tmux com prefixo "braion-telegram-<chat_id>"
#
# Comandos Telegram:
#   /start   — mensagem de boas-vindas
#   /clear   — limpa contexto do Claude (/clear)
#   /reset   — destrói e recria a sessão
#   /status  — mostra estado da sessão
#   qualquer texto — enviado ao Claude

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
BRAION="$(cd "$(dirname "$0")/.." && pwd)"
echo "BRAION: $BRAION"
[ -f "$BRAION/.env" ] && set -a && source "$BRAION/.env" && set +a

BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
ALLOWED_CHAT="${TELEGRAM_ALLOWED_CHAT_ID:-}"
CLAUDE="claude"
DEFAULT_MODEL="${DEFAULT_MODEL:-claude-sonnet-4-6}"
SESSION_PREFIX="braion-telegram"
OFFSET_FILE="/tmp/tgbridge-offset-$(whoami).txt"
LOG_FILE="$BRAION/logs/telegram-bridge.log"
IDLE_TIMEOUT=180   # segundos aguardando resposta do Claude
RESPONSE_LINES=300 # máximo de linhas a capturar

mkdir -p "$(dirname "$LOG_FILE")"

# ── Utilidades ────────────────────────────────────────────────────────────────
source "$BRAION/lib/telegram.sh"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

strip_ansi() {
  sed 's/\x1B\[[0-9;]*[mGKHFJABCDEFnsu]//g; s/\x1B[()][A-Z]//g; s/\r//g'
}

clean_response() {
  strip_ansi \
    | grep -v '^[[:space:]]*$' \
    | grep -v '^─\+$' \
    | grep -v 'auto mode' \
    | grep -v 'accept edits' \
    | grep -v '⏵⏵' \
    | grep -v '│.*tokens' \
    | grep -v '^❯' \
    | sed '/^$/N;/^\n$/d'
}

# ── Gestão de sessões tmux ─────────────────────────────────────────────────
session_running() {
  tmux has-session -t "$1" 2>/dev/null
}

session_is_idle() {
  local session="$1"
  tmux has-session -t "$session" 2>/dev/null || return 1
  # O prompt idle do Claude Code usa NBSP (c2 a0) após ❯, enquanto o echo do
  # input do usuário usa espaço regular (20). LC_ALL=C garante match byte-a-byte.
  tmux capture-pane -t "$session" -p 2>/dev/null \
    | LC_ALL=C grep -qP '\xe2\x9d\xaf\xc2\xa0'
}

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

  # System prompt carregado de arquivo (fallback inline se arquivo não existir)
  local tg_prompt=$(cat $BRAION/prompts/system-prompts/chat-telegram.md 2>/dev/null || echo "You are a helpful assistant. Keep responses concise for Telegram/chat, format for mobile, NO tables/ASCII art. Use bullets and short paragraphs. Be concise.")
  log "tmux send-keys -t \"$session\" \"$CLAUDE --permission-mode acceptEdits --append-system-prompt '$tg_prompt'\" Enter"
  tmux send-keys -t "$session" "$CLAUDE --verbose --permission-mode acceptEdits --append-system-prompt '$tg_prompt'" Enter

  # Aguarda prompt ❯ (máx 5s)
  local waited=0
  while [ $waited -lt 5 ]; do
    sleep 1
    waited=$((waited + 1))
    if tmux capture-pane -t "$session" -p 2>/dev/null | grep -qP '\xe2\x9d\xaf'; then
      log "READY $session (${waited}s)"
      return 0
    fi
  done
  log "WARN $session — prompt não detectado após ${waited}s, continuando"
  return 0
}

# ── Enviar mensagem e aguardar processamento ───────────────────────────────────
# Captura a resposta do Claude diretamente do tmux.
send_and_wait() {
  local session="$1" message="$2"

  # Captura posição inicial do prompt antes de enviar
  local before_prompt
  before_prompt=$(tmux capture-pane -t "$session" -p 2>/dev/null | tail -1)

  # Envia mensagem
  tmux send-keys -t "$session" -l "$message"
  tmux send-keys -t "$session" Enter

  # Aguarda Claude começar a processar (❯ some) — até 10s
  local w=0
  while [ $w -lt 10 ]; do
    sleep 1; w=$((w + 1))
    session_is_idle "$session" || break
  done

  # Aguarda Claude terminar (❯ reaparece) — até IDLE_TIMEOUT
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
    | grep -v "^$CLAUDE " \
    | grep -v "^─\+$")

  echo "$response"
}

# ── Handlers de comandos ──────────────────────────────────────────────────────
handle_start() {
  local chat_id="$1" session="$2"
  ensure_session "$session" "$chat_id"
  tg_send "$chat_id" "🤖 *BR.AI.ON* conectado
Sessão: \`$session\`

Envie qualquer mensagem para o Claude Code.

Comandos:
• /clear — limpar contexto
• /reset — reiniciar sessão
• /status — estado da sessão
• /pause — pausar agentes
• /unpause — retomar agentes
• /deploy — deploy da branch main
• /deploy <branch> — deploy de branch específica"
}

handle_clear() {
  local chat_id="$1" session="$2"
  if ! session_running "$session"; then
    tg_send "$chat_id" "⚠️ Sem sessão ativa. Envie uma mensagem para iniciar."
    return
  fi
  tmux send-keys -t "$session" "/clear" Enter
  sleep 2
  tg_send "$chat_id" "✅ Contexto limpo."
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
  tg_send "$chat_id" "🔄 Sessão reiniciada."
}

handle_status() {
  local chat_id="$1" session="$2"
  if ! session_running "$session"; then
    tg_send "$chat_id" "💤 Sem sessão ativa."
    return
  fi
  if session_is_idle "$session"; then
    tg_send "$chat_id" "✅ Sessão \`$session\` ativa e aguardando."
  else
    tg_send "$chat_id" "⏳ Sessão \`$session\` processando..."
  fi
}

handle_pause() {
  local chat_id="$1"
  touch "$BRAION/.paused"
  tg_send "$chat_id" "⏸ BR.AI.ON pausado. Agentes não serão iniciados até /unpause."
  log "PAUSE — arquivo .paused criado"
}

handle_unpause() {
  local chat_id="$1"
  if [ -f "$BRAION/.paused" ]; then
    rm -f "$BRAION/.paused"
    tg_send "$chat_id" "▶️ BR.AI.ON retomado. Agentes voltam ao ciclo normal."
    log "UNPAUSE — arquivo .paused removido"
  else
    tg_send "$chat_id" "ℹ️ BR.AI.ON já estava ativo (sem arquivo .paused)."
  fi
}

handle_deploy() {
  local chat_id="$1" branch="${2:-main}"
  log "DEPLOY — branch=$branch iniciado por chat_id=$chat_id"
  tg_send "$chat_id" "🚀 Deploy iniciado (branch: \`$branch\`)..."

  local output errors=""

  tg_send "$chat_id" "📦 Fazendo checkout e pull..."
  local git_cmds="git fetch origin && git checkout \"$branch\" && git pull origin \"$branch\""
  [ "$branch" != "main" ] && git_cmds="$git_cmds && git pull origin main"
  if ! output=$(cd "$BRAION" && eval "$git_cmds" 2>&1); then
    errors="$output"
    tg_send "$chat_id" "❌ Erro no git:
\`\`\`
${errors:0:800}
\`\`\`"
    log "DEPLOY ERROR git: $errors"
    return
  fi

  tg_send "$chat_id" "📦 Instalando dependências..."
  if ! output=$(cd "$BRAION/dashboard" && npm install 2>&1); then
    tg_send "$chat_id" "❌ Erro no npm install:
\`\`\`
${output:0:800}
\`\`\`"
    log "DEPLOY ERROR npm install: $output"
    return
  fi

  tg_send "$chat_id" "🔨 Building..."
  if ! output=$(cd "$BRAION/dashboard" && npm run build 2>&1); then
    tg_send "$chat_id" "❌ Erro no npm build:
\`\`\`
${output:0:800}
\`\`\`"
    log "DEPLOY ERROR npm build: $output"
    return
  fi

  tg_send "$chat_id" "🔄 Reiniciando serviço..."
  local uid
  uid=$(id -u)
  if ! output=$(XDG_RUNTIME_DIR="/run/user/${uid}" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${uid}/bus" systemctl --user stop braion 2>&1 && XDG_RUNTIME_DIR="/run/user/${uid}" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${uid}/bus" systemctl --user start braion 2>&1); then
    tg_send "$chat_id" "❌ Erro no systemctl:
\`\`\`
${output:0:800}
\`\`\`"
    log "DEPLOY ERROR systemctl: $output"
    return
  fi

  tg_send "$chat_id" "✅ Deploy concluído! Branch \`$branch\` em produção."
  log "DEPLOY OK — branch=$branch"
}

handle_message() {
  local chat_id="$1" session="$2" text="$3"

  ensure_session "$session" "$chat_id"

  if ! session_is_idle "$session"; then
    tg_send "$chat_id" "⏳ Claude ainda está processando a mensagem anterior. Aguarde."
    return
  fi

  tg_typing "$chat_id"

  log "MSG $session: ${text:0:80}"
  local response
  response=$(send_and_wait "$session" "$text")

  if [ -n "$response" ]; then
    tg_send "$chat_id" "$response"
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

  log "START telegram-bridge (@br_ai_on_bot) — offset=$offset"

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
        tg_send "$chat_id" "⛔ Acesso não autorizado."
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
        /*)           tg_send "$chat_id" "Comando desconhecido. Use /start, /clear, /reset, /status, /pause, /unpause ou /deploy [branch]." ;;
        *)            handle_message "$chat_id" "$session" "$text" ;;
      esac

    done
  done
}

main "$@"
