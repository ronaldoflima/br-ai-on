#!/usr/bin/env bash
# lib/cli.sh — Abstração de backend AI CLI
#
# Este arquivo é a ÚNICA fronteira entre o projeto e o CLI AI concreto.
# Nenhum outro script deve ter `claude`, `codex`, flags específicas,
# paths `~/.claude/`, nomes de modelo ou strings de UI hardcoded.
#
# Variáveis de ambiente:
#   CLI_BACKEND   — claude (padrão) | codex | gemini (futuro)
#                   Fallback: $CLAUDE (compat com código antigo)
#   IDLE_DIR      — diretório de flags de idle
#                   (padrão: ~/.config/br-ai-on/idle)
#
# Interface pública (use só estas funções em outros scripts):
#
#   Capability / Availability
#     cli_check_available                 — valida binário no PATH
#     cli_default_model                   — modelo default do backend
#     cli_valid_models                    — lista de modelos válidos (um por linha)
#     cli_fallback_model                  — modelo de fallback (cheaper/smaller)
#
#   Session lifecycle
#     cli_build_start_cmd <model> <perm_mode> <sp_file> <verbose> [extra_dirs…]
#     cli_send_command <session> <cmd>    — envia texto cru p/ sessão tmux
#     cli_send_slash_command <session> <slash>  — envia slash command (traduz p/ backend)
#     cli_send_clear <session>            — envia comando de /clear context
#     cli_wait_ready <session> [timeout]  — bloqueia até sessão estar pronta (default 120s)
#
#   State detection
#     cli_session_is_idle <session>       — sessão está em prompt aguardando input?
#     cli_session_clear_idle <session>    — remove flag de idle
#     cli_prompt_glyph                    — glyph do prompt (ex: ❯ no claude)
#     cli_busy_patterns                   — regex de estados "ocupado"
#
#   Paths / Filesystem
#     cli_config_dir                      — ~/.claude | ~/.codex | ~/.gemini
#     cli_commands_install_dir            — onde instalar slash commands custom
#     cli_hook_config_path                — settings.json do backend (ou vazio)
#     cli_projects_dir                    — dir onde o CLI persiste sessões/histórico
#
#   Hooks
#     cli_hook_register <event> <script> [timeout]  — registra hook no backend
#                                                     (ex: event=stop-like)
#     cli_hook_event_name <generic>       — traduz evento genérico p/ nome do backend
#
#   Permissions / Modes
#     cli_permission_mode_map <generic>   — auto|confirm|bypass → modo do backend
#     cli_permission_mode_default         — modo padrão do backend

CLI_BACKEND=${CLI_BACKEND:-${CLAUDE:-claude}}
_CLI_IDLE_DIR=${IDLE_DIR:-$HOME/.config/br-ai-on/idle}

# ── Availability ──────────────────────────────────────────────────────────────

cli_check_available() {
  command -v "$CLI_BACKEND" &>/dev/null
}

cli_default_model() {
  case "$CLI_BACKEND" in
    claude) echo "claude-sonnet-4-6" ;;
    codex)  echo "gpt-5-codex" ;;
    gemini) echo "gemini-2.5-pro" ;;
    *)      echo "claude-sonnet-4-6" ;;
  esac
}

cli_fallback_model() {
  case "$CLI_BACKEND" in
    claude) echo "claude-haiku-4-5" ;;
    codex)  echo "gpt-5-mini" ;;
    gemini) echo "gemini-2.5-flash" ;;
    *)      echo "claude-haiku-4-5" ;;
  esac
}

cli_valid_models() {
  case "$CLI_BACKEND" in
    claude)
      printf '%s\n' \
        "claude-opus-4-6" \
        "claude-sonnet-4-6" \
        "claude-haiku-4-5" \
        "claude-opus-4-5" \
        "claude-sonnet-4-5"
      ;;
    codex)
      printf '%s\n' "gpt-5-codex" "gpt-5-mini" "o4-mini"
      ;;
    gemini)
      printf '%s\n' "gemini-2.5-pro" "gemini-2.5-flash"
      ;;
    *)
      printf '%s\n' "claude-sonnet-4-6"
      ;;
  esac
}

# ── Session lifecycle ─────────────────────────────────────────────────────────

# cli_build_start_cmd <model> <perm_mode> <sp_file> <verbose> [extra_dirs…]
# perm_mode usa valores NATIVOS do backend (caller pode normalizar via cli_permission_mode_map).
cli_build_start_cmd() {
  local model="${1:-$(cli_default_model)}"
  local perm_mode="${2:-$(cli_permission_mode_default)}"
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
      local cmd="codex --model $model"
      echo "$cmd"
      ;;
    gemini)
      local cmd="gemini --model $model"
      echo "$cmd"
      ;;
    *)
      echo "$CLI_BACKEND --model $model"
      ;;
  esac
}

# cli_send_command <session> <text>
# Envia texto cru para o prompt da sessão tmux.
cli_send_command() {
  local session="$1" text="$2"
  tmux send-keys -t "$session" -l "$text"
  tmux send-keys -t "$session" Enter
}

# cli_send_slash_command <session> <slash>
# Traduz slash command no formato /ns:name para o backend.
#   claude: envia como slash (nativo)
#   outros: strip "/ns:" e envia como prompt texto
cli_send_slash_command() {
  local session="$1" slash="$2"
  case "$CLI_BACKEND" in
    claude)
      cli_send_command "$session" "$slash"
      ;;
    *)
      local text
      text=$(echo "$slash" | sed 's|^/[^:]*:||')
      cli_send_command "$session" "$text"
      ;;
  esac
}

# cli_send_clear <session> — limpa contexto conversacional
cli_send_clear() {
  local session="$1"
  case "$CLI_BACKEND" in
    claude) tmux send-keys -t "$session" "/clear" Enter ;;
    codex)  tmux send-keys -t "$session" "/clear" Enter ;;
    gemini) tmux send-keys -t "$session" "/clear" Enter ;;
    *)      tmux send-keys -t "$session" "/clear" Enter ;;
  esac
}

# cli_wait_ready <session> [timeout_s]
# Bloqueia até sessão mostrar prompt idle. Default 120s.
# Retorna 0 se pronta, 1 se timeout.
cli_wait_ready() {
  local session="$1" timeout="${2:-120}"
  local waited=0 step=2
  while [ "$waited" -lt "$timeout" ]; do
    sleep "$step"
    waited=$((waited + step))
    if cli_session_is_idle "$session"; then
      cli_session_clear_idle "$session"
      return 0
    fi
  done
  return 1
}

# ── State detection ───────────────────────────────────────────────────────────

# Glyph do prompt idle do backend (bytes brutos; use LC_ALL=C para match).
cli_prompt_glyph() {
  case "$CLI_BACKEND" in
    claude) printf '\xe2\x9d\xaf\xc2\xa0' ;;  # ❯ + NBSP
    codex)  printf '' ;;                       # codex não tem glyph fixo
    gemini) printf '' ;;
    *)      printf '' ;;
  esac
}

# Regex (egrep) de patterns que indicam sessão ocupada (NÃO idle).
cli_busy_patterns() {
  case "$CLI_BACKEND" in
    claude) echo 'Running…|Thinking|Thundering' ;;
    codex)  echo 'Running|Thinking' ;;
    gemini) echo 'Thinking|Processing' ;;
    *)      echo 'Running|Thinking' ;;
  esac
}

# cli_session_is_idle <session>
cli_session_is_idle() {
  local session="$1"
  tmux has-session -t "$session" 2>/dev/null || return 1

  case "$CLI_BACKEND" in
    claude)
      # Preferência: flag do Stop hook
      [ -f "$_CLI_IDLE_DIR/$session" ] && return 0
      # Fallback: capture-pane + glyph
      local pane glyph busy
      pane=$(tmux capture-pane -t "$session" -p 2>/dev/null)
      glyph=$(cli_prompt_glyph)
      busy=$(cli_busy_patterns)
      echo "$pane" | LC_ALL=C grep -qF "$glyph" || return 1
      ! echo "$pane" | grep -qE "$busy"
      ;;
    codex|gemini)
      # Sem glyph fixo ainda: fallback por PID do processo
      ! tmux list-panes -t "$session" -F '#{pane_pid}' 2>/dev/null \
        | xargs -I{} ps -o comm= -p {} 2>/dev/null \
        | grep -q "$CLI_BACKEND"
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

# ── Paths / Filesystem ────────────────────────────────────────────────────────

cli_config_dir() {
  case "$CLI_BACKEND" in
    claude) echo "$HOME/.claude" ;;
    codex)  echo "$HOME/.codex" ;;
    gemini) echo "$HOME/.gemini" ;;
    *)      echo "$HOME/.$CLI_BACKEND" ;;
  esac
}

cli_commands_install_dir() {
  case "$CLI_BACKEND" in
    claude) echo "$HOME/.claude/commands" ;;
    codex)  echo "$HOME/.codex/prompts" ;;
    gemini) echo "$HOME/.gemini/commands" ;;
    *)      echo "$(cli_config_dir)/commands" ;;
  esac
}

cli_hook_config_path() {
  case "$CLI_BACKEND" in
    claude) echo "$HOME/.claude/settings.json" ;;
    codex)  echo "" ;;  # codex ainda não tem settings.json
    gemini) echo "" ;;
    *)      echo "" ;;
  esac
}

cli_projects_dir() {
  case "$CLI_BACKEND" in
    claude) echo "$HOME/.claude/projects" ;;
    codex)  echo "$HOME/.codex/sessions" ;;
    gemini) echo "$HOME/.gemini/sessions" ;;
    *)      echo "" ;;
  esac
}

# ── Hooks ─────────────────────────────────────────────────────────────────────

# Traduz evento genérico para nome nativo do backend.
#   stop-like    — dispara quando o CLI termina de responder
cli_hook_event_name() {
  local generic="$1"
  case "$CLI_BACKEND" in
    claude)
      case "$generic" in
        stop-like) echo "Stop" ;;
        *)         echo "$generic" ;;
      esac
      ;;
    *)
      echo "$generic"
      ;;
  esac
}

# cli_hook_register <generic_event> <hook_script> [timeout_s]
# Registra hook no settings do backend. Retorna 0 em sucesso, não-zero em falha.
# Se backend não suporta hooks, retorna 2 (skip).
cli_hook_register() {
  local generic_event="$1" hook_script="$2" timeout="${3:-5}"
  local settings_file
  settings_file=$(cli_hook_config_path)

  [ -z "$settings_file" ] && return 2
  [ -f "$settings_file" ] || return 1
  command -v jq &>/dev/null || return 1

  local event_name needle
  event_name=$(cli_hook_event_name "$generic_event")
  needle=$(basename "$hook_script")

  if jq -e ".hooks.\"$event_name\"[]?.hooks[]? | select(.command | contains(\"$needle\"))" "$settings_file" >/dev/null 2>&1; then
    return 0  # já registrado
  fi

  case "$CLI_BACKEND" in
    claude)
      python3 - "$settings_file" "$event_name" "$hook_script" "$timeout" <<'PYEOF'
import sys, json
path, event, script, timeout = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
with open(path) as f:
    s = json.load(f)
s.setdefault("hooks", {}).setdefault(event, [])
arr = s["hooks"][event]
if not arr:
    arr.append({"matcher": ".*", "hooks": []})
arr[0].setdefault("hooks", []).append({"type": "command", "command": script, "timeout": timeout})
with open(path, "w") as f:
    json.dump(s, f, indent=2, ensure_ascii=False)
    f.write("\n")
PYEOF
      ;;
    *)
      return 2
      ;;
  esac
}

# ── Permissions ───────────────────────────────────────────────────────────────

# Modo padrão do backend.
cli_permission_mode_default() {
  case "$CLI_BACKEND" in
    claude) echo "acceptEdits" ;;
    codex)  echo "auto" ;;
    gemini) echo "auto" ;;
    *)      echo "auto" ;;
  esac
}

# cli_permission_mode_map <generic>
#   generic: auto | confirm | bypass
#   retorna modo NATIVO do backend.
# Se input já é modo nativo do backend (retrocompat), devolve como está.
cli_permission_mode_map() {
  local generic="$1"
  case "$CLI_BACKEND" in
    claude)
      case "$generic" in
        auto)           echo "auto" ;;
        confirm)        echo "default" ;;
        bypass)         echo "bypassPermissions" ;;
        # retrocompat: valores já nativos
        acceptEdits|default|bypassPermissions|plan|dontAsk) echo "$generic" ;;
        "")             echo "acceptEdits" ;;
        *)              echo "$generic" ;;
      esac
      ;;
    codex)
      case "$generic" in
        auto)    echo "auto" ;;
        confirm) echo "confirm" ;;
        bypass)  echo "full-auto" ;;
        *)       echo "auto" ;;
      esac
      ;;
    gemini)
      case "$generic" in
        auto)    echo "auto" ;;
        confirm) echo "confirm" ;;
        bypass)  echo "yolo" ;;
        *)       echo "auto" ;;
      esac
      ;;
    *)
      echo "$generic"
      ;;
  esac
}
