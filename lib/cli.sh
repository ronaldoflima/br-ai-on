#!/usr/bin/env bash
# lib/cli.sh — Abstração de backend AI CLI
#
# Variáveis de ambiente:
#   CLI_BACKEND   — claude (padrão) | codex
#   IDLE_DIR      — diretório de flags de idle (padrão: ~/.config/br-ai-on/idle)
#
# Funções:
#   cli_check_available                                     — valida CLI no PATH
#   cli_build_start_cmd <model> <perm_mode> <sp_file>       — monta comando de inicialização
#                       <verbose:true|false> [extra_dirs…]
#   cli_session_is_idle <session>                           — detecta idle no tmux
#   cli_session_clear_idle <session>                        — limpa flag de idle
#   cli_send_command <session> <command>                    — envia slash/prompt para sessão

CLI_BACKEND=${CLI_BACKEND:-claude}
_CLI_IDLE_DIR=${IDLE_DIR:-$HOME/.config/br-ai-on/idle}

cli_check_available() {
  command -v "$CLI_BACKEND" &>/dev/null
}

# cli_build_start_cmd <model> <perm_mode> <sp_file> <verbose> [extra_dirs…]
cli_build_start_cmd() {
  local model="${1:-claude-sonnet-4-6}"
  local perm_mode="${2:-acceptEdits}"
  local sp_file="${3:-}"
  local verbose="${4:-false}"
  shift 4 2>/dev/null || true

  case "$CLI_BACKEND" in
    claude)
      local cmd="claude"
      [ "$verbose" = "true" ] && cmd="$cmd --verbose"
      cmd="$cmd --model $model --permission-mode $perm_mode"
      for d in "$@"; do
        [ -n "$d" ] && cmd="$cmd --add-dir $d"
      done
      if [ -n "$sp_file" ] && [ -f "$sp_file" ]; then
        cmd="$cmd --append-system-prompt \"\$(cat $sp_file)\""
      fi
      echo "$cmd"
      ;;
    codex)
      # System prompt vai para AGENTS.md no working dir (caller deve preparar antes)
      local cmd="codex --model $model"
      echo "$cmd"
      ;;
    *)
      echo "claude --model $model"
      ;;
  esac
}

# cli_session_is_idle <session>
cli_session_is_idle() {
  local session="$1"
  tmux has-session -t "$session" 2>/dev/null || return 1

  case "$CLI_BACKEND" in
    claude)
      [ -f "$_CLI_IDLE_DIR/$session" ] && return 0
      local pane
      pane=$(tmux capture-pane -t "$session" -p 2>/dev/null)
      echo "$pane" | LC_ALL=C grep -qP '\xe2\x9d\xaf\xc2\xa0' || return 1
      ! echo "$pane" | grep -qE 'Running…|Thinking|Thundering'
      ;;
    codex)
      ! tmux list-panes -t "$session" -F '#{pane_pid}' 2>/dev/null \
        | xargs -I{} ps -o comm= -p {} 2>/dev/null \
        | grep -q 'codex'
      ;;
    *)
      return 1
      ;;
  esac
}

# cli_session_clear_idle <session>
cli_session_clear_idle() {
  rm -f "$_CLI_IDLE_DIR/$1"
}

# cli_send_command <session> <command>
# Para claude: envia slash command (/braion:agent-wrapup, etc.)
# Para codex: remove prefixo /braion: e envia como prompt de texto
cli_send_command() {
  local session="$1" command="$2"

  case "$CLI_BACKEND" in
    claude)
      tmux send-keys -t "$session" -l "$command"
      tmux send-keys -t "$session" Enter
      ;;
    codex)
      local text
      text=$(echo "$command" | sed 's|^/[^:]*:||')
      tmux send-keys -t "$session" -l "$text"
      tmux send-keys -t "$session" Enter
      ;;
    *)
      tmux send-keys -t "$session" -l "$command"
      tmux send-keys -t "$session" Enter
      ;;
  esac
}
