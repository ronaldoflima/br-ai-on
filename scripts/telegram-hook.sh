#!/usr/bin/env bash
# scripts/telegram-hook.sh
# Hook Stop para enviar respostas do Claude ao Telegram
# Executado pelo Claude Code quando termina de responder (apenas sessões telegram)

LAST_ASSISTANT_MESSAGE=$(jq -r '.last_assistant_message')

set -euo pipefail

SESSION_PREFIX="braion-telegram"
session="$SESSION_PREFIX" #TODO futuramente colocar com chat_id para isolar sessões por usuário, mas por enquanto só tem uma sessão global

# Verifica se o hook está rodando dentro da sessão telegram correta
[ -n "${TMUX:-}" ] || exit 0
current_session=$(tmux display-message -p '#S' 2>/dev/null || echo "")
[ "$current_session" = "$session" ] || exit 0

TELEGRAM_BOT_TOKEN=$(tmux show-environment -t "$session" TELEGRAM_BOT_TOKEN 2>/dev/null | cut -d= -f2-)
TELEGRAM_CHAT_ID=$(tmux show-environment -t "$session" TELEGRAM_CHAT_ID 2>/dev/null | cut -d= -f2-)

# Verifica se está em sessão telegram
[ -z "${TELEGRAM_CHAT_ID:-}" ] && exit 0
[ -z "${TELEGRAM_BOT_TOKEN:-}" ] && exit 0

[ -z "$LAST_ASSISTANT_MESSAGE" ] && exit 0

response=$LAST_ASSISTANT_MESSAGE

# Envia em chunks (máx 4000 chars por mensagem)
tg_send() {
  local chat_id="$1" text="$2"
  local max=4000
  while [ "${#text}" -gt 0 ]; do
    local chunk="${text:0:$max}"
    text="${text:$max}"
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${chat_id}" \
      --data-urlencode "text=${chunk}" \
      -d "disable_web_page_preview=true" \
      > /dev/null
  done
}

tg_send "$TELEGRAM_CHAT_ID" "$response"
