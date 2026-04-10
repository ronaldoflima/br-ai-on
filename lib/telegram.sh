#!/usr/bin/env bash
# lib/telegram.sh — Biblioteca compartilhada para envio de mensagens Telegram
#
# Uso como biblioteca (source):
#   source "$(dirname "$0")/../lib/telegram.sh"
#   tg_send "$chat_id" "mensagem"
#   tg_typing "$chat_id"
#
# Uso direto (qualquer agente):
#   bash lib/telegram.sh send "mensagem"
#   bash lib/telegram.sh send "mensagem" --chat-id 12345
#   bash lib/telegram.sh typing
#   bash lib/telegram.sh typing --chat-id 12345

_TG_BRAION="${_TG_BRAION:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)}"

_tg_load_env() {
  if [ -z "${_TG_ENV_LOADED:-}" ]; then
    [ -f "$_TG_BRAION/.env" ] && set -a && source "$_TG_BRAION/.env" && set +a
    _TG_ENV_LOADED=1
  fi
}

_tg_bot_token() {
  _tg_load_env
  echo "${TELEGRAM_BOT_TOKEN:-}"
}

_tg_default_chat_id() {
  _tg_load_env
  echo "${TELEGRAM_ALLOWED_CHAT_ID:-}"
}

tg_send() {
  local chat_id="$1" text="$2"
  local token
  token=$(_tg_bot_token)
  [ -z "$token" ] && return 0
  [ -z "$chat_id" ] && return 0
  [ -z "$text" ] && return 0

  local max=4000
  while [ "${#text}" -gt 0 ]; do
    local chunk="${text:0:$max}"
    text="${text:$max}"
    curl -s -X POST "https://api.telegram.org/bot${token}/sendMessage" \
      -d "chat_id=${chat_id}" \
      --data-urlencode "text=${chunk}" \
      -d "disable_web_page_preview=true" \
      > /dev/null
  done
}

tg_typing() {
  local chat_id="${1:-}"
  local token
  token=$(_tg_bot_token)
  [ -z "$token" ] && return 0
  [ -z "$chat_id" ] && return 0

  curl -s -X POST "https://api.telegram.org/bot${token}/sendChatAction" \
    -d "chat_id=${chat_id}" -d "action=typing" > /dev/null
}

tg_notify() {
  local text="$1" chat_id="${2:-}"
  [ -z "$chat_id" ] && chat_id=$(_tg_default_chat_id)
  tg_send "$chat_id" "$text"
}

# ── Modo direto (quando executado como comando) ──────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail

  _tg_usage() {
    cat <<'EOF'
lib/telegram.sh — Envia mensagens Telegram

Uso:
  bash lib/telegram.sh send "mensagem"              # envia para chat padrão
  bash lib/telegram.sh send "mensagem" --chat-id ID # envia para chat específico
  bash lib/telegram.sh typing                       # indicador de digitação
  bash lib/telegram.sh typing --chat-id ID

Variáveis de ambiente (ou .env):
  TELEGRAM_BOT_TOKEN        — token do bot (obrigatório)
  TELEGRAM_ALLOWED_CHAT_ID  — chat_id padrão
EOF
    exit "${1:-0}"
  }

  cmd="${1:-}"
  shift 2>/dev/null || true

  token=$(_tg_bot_token)
  [ -z "$token" ] && [ "$cmd" != "help" ] && [ "$cmd" != "--help" ] && [ "$cmd" != "-h" ] && {
    echo "ERROR: TELEGRAM_BOT_TOKEN não configurado" >&2; exit 1;
  }

  case "$cmd" in
    send)
      text="${1:-}"
      shift 2>/dev/null || true
      [ -z "$text" ] && { echo "ERROR: texto obrigatório" >&2; _tg_usage 1; }

      chat_id=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --chat-id) chat_id="${2:-}"; shift 2 ;;
          *) shift ;;
        esac
      done
      [ -z "$chat_id" ] && chat_id=$(_tg_default_chat_id)
      [ -z "$chat_id" ] && { echo "ERROR: chat_id não definido (use --chat-id ou TELEGRAM_ALLOWED_CHAT_ID)" >&2; exit 1; }

      tg_send "$chat_id" "$text"
      ;;
    typing)
      chat_id=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --chat-id) chat_id="${2:-}"; shift 2 ;;
          *) shift ;;
        esac
      done
      [ -z "$chat_id" ] && chat_id=$(_tg_default_chat_id)
      [ -z "$chat_id" ] && { echo "ERROR: chat_id não definido" >&2; exit 1; }

      tg_typing "$chat_id"
      ;;
    help|--help|-h)
      _tg_usage 0
      ;;
    *)
      echo "ERROR: comando desconhecido '$cmd'" >&2
      _tg_usage 1
      ;;
  esac
fi
