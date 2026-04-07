#!/usr/bin/env sh
# claude-switch.sh — Fallback automático para Ollama quando Claude atinge rate limit
#
# USAGE: adicione ao seu .zshrc ou .bashrc:
#   source ~/br-ai-on/scripts/claude-switch.sh
#
# COMANDOS disponíveis após source:
#   claude          — wrapper inteligente (Anthropic ou Ollama automaticamente)
#   claude-rl       — marca manualmente rate limit (ativa Ollama)
#   claude-ok       — limpa rate limit (volta para Anthropic)
#   claude-status   — mostra qual backend está ativo
#   clo             — força Ollama diretamente (sem verificação)
#
# VARIÁVEIS de configuração (defina antes do source para sobrescrever):
#   CLAUDE_OLLAMA_MODEL  — modelo Ollama (padrão: glm-5:cloud)
#   CLAUDE_RL_TTL        — segundos até expirar rate limit (padrão: 3600)
#   CLAUDE_OLLAMA_URL    — URL do Ollama (padrão: http://localhost:11434)

_CLAUDE_RATELIMIT_FLAG="/tmp/.claude_ratelimit"
_CLAUDE_RATELIMIT_TTL="${CLAUDE_RL_TTL:-3600}"
_CLAUDE_DAILY_CHECK="/tmp/.claude_check_$(date +%Y-%m-%d)"
_CLAUDE_OLLAMA_MODEL="${CLAUDE_OLLAMA_MODEL:-glm-5:cloud}"
_CLAUDE_OLLAMA_URL="${CLAUDE_OLLAMA_URL:-http://localhost:11434}"

_claude_is_ratelimited() {
  [ -f "$_CLAUDE_RATELIMIT_FLAG" ] || return 1
  local age
  age=$(( $(date +%s) - $(stat -c %Y "$_CLAUDE_RATELIMIT_FLAG" 2>/dev/null || echo 0) ))
  [ "$age" -lt "$_CLAUDE_RATELIMIT_TTL" ]
}

_claude_auto_check() {
  [ -f "$_CLAUDE_DAILY_CHECK" ] && return 0
  local result
  result=$(timeout 10 command claude -p "." 2>&1)
  if echo "$result" | grep -qi "usage limit\|rate limit\|limit reached"; then
    touch "$_CLAUDE_RATELIMIT_FLAG"
    echo "rate_limited"
  fi
  touch "$_CLAUDE_DAILY_CHECK"
}

_claude_ollama() {
  ANTHROPIC_AUTH_TOKEN=ollama \
  ANTHROPIC_BASE_URL="$_CLAUDE_OLLAMA_URL" \
  ANTHROPIC_API_KEY="" \
  command claude --model "$_CLAUDE_OLLAMA_MODEL" "$@"
}

claude() {
  if _claude_is_ratelimited; then
    local age mins_left
    age=$(( $(date +%s) - $(stat -c %Y "$_CLAUDE_RATELIMIT_FLAG") ))
    mins_left=$(( (_CLAUDE_RATELIMIT_TTL - age) / 60 ))
    printf '\e[33m⚡ Claude em rate limit (~%dmin p/ reset) → Ollama (%s)\e[0m\n' \
      "$mins_left" "$_CLAUDE_OLLAMA_MODEL"
    _claude_ollama "$@"
    return
  fi

  case " $* " in
    *" -p "* | *" --print "*) ;;
    *)
      local check_result
      check_result=$(_claude_auto_check)
      if [ "$check_result" = "rate_limited" ]; then
        printf '\e[33m⚡ Claude em rate limit detectado → Ollama (%s)\e[0m\n' \
          "$_CLAUDE_OLLAMA_MODEL"
        _claude_ollama "$@"
        return
      fi
      ;;
  esac

  command claude "$@"
}

alias claude-rl='touch "$_CLAUDE_RATELIMIT_FLAG" && printf "\e[33m⚡ Rate limit marcado. Ollama ativo por %dmin.\e[0m\n" $(( _CLAUDE_RATELIMIT_TTL / 60 ))'
alias claude-ok='rm -f "$_CLAUDE_RATELIMIT_FLAG" "/tmp/.claude_check_$(date +%Y-%m-%d)" && printf "\e[32m✓ Rate limit limpo. Claude Anthropic ativo.\e[0m\n"'
alias claude-status='_claude_is_ratelimited && printf "\e[33m⚡ Rate limited — usando Ollama (%s)\e[0m\n" "$_CLAUDE_OLLAMA_MODEL" || printf "\e[32m✓ OK — usando Claude Anthropic\e[0m\n"'
alias clo='_claude_ollama'
