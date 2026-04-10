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

[ -z "${TELEGRAM_CHAT_ID:-}" ] && exit 0
[ -z "${TELEGRAM_BOT_TOKEN:-}" ] && exit 0
[ -z "$LAST_ASSISTANT_MESSAGE" ] && exit 0

BRAION="$(cd "$(dirname "$0")/.." && pwd)"
source "$BRAION/lib/telegram.sh"

tg_send "$LAST_ASSISTANT_MESSAGE" "$TELEGRAM_CHAT_ID"
