#!/usr/bin/env bash
# lib/launch-session.sh — launcher de sessões tmux com Claude Code.
#
# Extraído de lib/agent-cron.sh para ser REUTILIZÁVEL standalone (ex.: feature
# task-warmup). Por isso este arquivo:
#   - NÃO usa `set -euo pipefail` no PRÓPRIO topo (é uma lib sourceável e não impõe
#     errexit por conta própria). ATENÇÃO: ela dá source em lib/state.sh, que roda
#     `set -euo pipefail` no top-level — então sourcear o launcher REATIVA
#     errexit/nounset/pipefail transitivamente no shell importador. Não assuma que
#     errexit fica desligado após o source (o agent-cron já roda sob set -e).
#   - É auto-suficiente quando sourceado sozinho: define os wrappers finos
#     (log/session_running/session_clear_idle/_hb_get) e sourceia cli.sh/state.sh,
#     que trazem as deps cli_*/state_*. Quando sourceado pelo agent-cron, as
#     redefinições de função são inofensivas (bash redefine sem erro) e os valores
#     já exportados (LOG_FILE, IDLE_DIR, etc.) são preservados pelos `:=` abaixo.
#
# Novo 9º parâmetro `no_watcher` (default false): com `true`, NÃO sobe o watcher
# em background que mata a sessão ao ficar idle. Necessário para sessões "warm-up"
# read-only que ficam idle de propósito esperando o "go" do usuário.

# Raiz do repo é obrigatória (não há default seguro para adivinhar).
: "${BRAION:?BRAION precisa estar definido}"

# Deps reais. cli.sh traz cli_* (build/send/wait/default); state.sh traz state_*.
# shellcheck disable=SC1091
source "$BRAION/lib/cli.sh"
# shellcheck disable=SC1091
source "$BRAION/lib/state.sh"

# Defaults seguros — preservam valores já exportados pelo importador (agent-cron).
: "${DEFAULT_MODEL:=$(cli_default_model 2>/dev/null || echo default)}"
: "${TMUX_COLS:=220}"
: "${TMUX_ROWS:=50}"
: "${LOG_FILE:=/tmp/launch-session.log}"
: "${IDLE_DIR:=/tmp}"
: "${REVIEW_TIMEOUT:=259200}"

# Wrappers finos: definidos aqui para que o launcher seja auto-suficiente quando
# sourceado fora do agent-cron. Não vêm de cli.sh/state.sh.
log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG_FILE"
}

session_running() {
  tmux has-session -t "$1" 2>/dev/null
}

session_clear_idle() { cli_session_clear_idle "$1"; }

# Lê o heartbeat do agente pela fronteira state.sh (respeita BRAION_STATE_BACKEND).
# Retorna sempre um JSON válido ('{}' se ausente/erro), nunca aborta sob set -e.
_hb_get() {
  local agent=$1
  state_heartbeat_get "$agent" 2>/dev/null || echo '{}'
}

start_session() {
  local session=$1 working_dir=${2:-$BRAION} prompt=$3 model=${4:-$DEFAULT_MODEL} perm_mode=${5:-$(cli_permission_mode_default)} custom_cmd=${6:-} sp_content=${7:-} extra_dirs_json=${8:-"[]"} no_watcher=${9:-false} attach_mode=${10:-session}
  [ -z "$working_dir" ] && working_dir="$BRAION"
  [ -d "$working_dir" ] || { log "WARN $session — diretório '$working_dir' não existe, usando $BRAION"; working_dir="$BRAION"; }

  # attach_mode=window (opt-in, ex.: task-warmup): se o processo que chamou o
  # launcher já está dentro de uma sessão tmux ($TMUX setado), abre uma NOVA JANELA
  # nessa mesma sessão em vez de criar uma sessão tmux separada. Default "session"
  # preserva 100% o comportamento antigo (usado por agent-cron/cron, que nunca tem
  # $TMUX no env). $target é o -t usado em todo o resto da função; $session continua
  # sendo só o identificador lógico (nome da janela / dedupe).
  local target="$session" reuse_session=""
  if [ "$attach_mode" = "window" ] && [ -n "${TMUX:-}" ]; then
    reuse_session=$(tmux display-message -p '#S' 2>/dev/null || true)
  fi

  if [ -n "$reuse_session" ]; then
    target="${reuse_session}:${session}"
    if tmux list-windows -t "$reuse_session" -F '#{window_name}' 2>/dev/null | grep -qx "$session"; then
      log "SKIP $session — janela já existe na sessão atual ($target)"
      return 0
    fi
    tmux new-window -t "$reuse_session" -n "$session" -c "$working_dir" "/bin/zsh || /bin/bash || sh"
    log "START $session — nova janela na sessão atual ($target)"
  else
    if session_running "$session"; then
      log "SKIP $session — sessão tmux ativa"
      return 0
    fi
    session_clear_idle "$session"
    tmux new-session -d -s "$session" -x "$TMUX_COLS" -y "$TMUX_ROWS" -c "$working_dir" "/bin/zsh || /bin/bash || sh"
    tmux set-option -t "$session" window-size manual 2>/dev/null || true
  fi
  sleep 1  # aguarda shell inicializar antes de enviar comandos

  if [ -n "$custom_cmd" ]; then
    cli_send_start_command "$target" "$custom_cmd"
    log "START $session em $working_dir (command=$custom_cmd)"
  else
    local sp_file=""
    if [ -n "$sp_content" ]; then
      sp_file=$(mktemp "/tmp/braion-sp-${session}-XXXXXX.txt" 2>/dev/null) || sp_file="/tmp/braion-sp-${session}-$$.txt"
      printf '%s' "$sp_content" > "$sp_file"
    fi
    local extra_dirs=()
    while IFS= read -r d; do
      [ -n "$d" ] && [ -d "$d" ] && extra_dirs+=("$d")
    done < <(echo "$extra_dirs_json" | jq -r '.[]?' 2>/dev/null)
    local cmd
    cmd=$(cli_build_start_cmd "$model" "$perm_mode" "$sp_file" "false" "$BRAION" "$HOME/.config/br-ai-on" ${extra_dirs[@]+"${extra_dirs[@]}"})
    log "START $session: \"$cmd\""
    cli_send_start_command "$target" "$cmd"
  fi

  if [ -n "$reuse_session" ]; then
    # O flag de idle (IDLE_DIR/$session) é escrito pelo hook_reporter a partir do
    # nome da SESSÃO tmux — numa janela reaproveitada isso seria a sessão pai, nunca
    # "$session", então cli_wait_ready nunca veria o flag. Faz polling do glyph do
    # prompt do backend na janela em vez de esperar o flag (cai para o timeout duro
    # abaixo se o backend não aparecer, igual ao "|| true" do caminho normal).
    local glyph waited=0
    glyph=$(cli_prompt_glyph)
    while [ "$waited" -lt 60 ]; do
      if [ -n "$glyph" ] && tmux capture-pane -t "$target" -p 2>/dev/null | grep -qF "$glyph"; then
        break
      fi
      sleep 2
      waited=$((waited + 2))
    done
  else
    # Aguarda backend estar pronto — hook flag ou fallback, máximo 120s
    cli_wait_ready "$session" 120 || true
  fi
  tmux send-keys -t "$target" -l "$prompt"
  tmux send-keys -t "$target" Enter

  # Verifica se o backend está processando o prompt (tokens > 0 ou pane mudou).
  # cli_wait_ready já consumiu o idle flag, então não podemos usar session_is_idle
  # para detectar início do processamento — usamos conteúdo do pane.
  local submit_waited=0
  local pane_before
  pane_before=$(tmux capture-pane -t "$target" -p 2>/dev/null | tail -3)
  while [ $submit_waited -lt 10 ]; do
    sleep 2
    submit_waited=$((submit_waited + 2))
    local pane_now
    pane_now=$(tmux capture-pane -t "$target" -p 2>/dev/null | tail -3)
    if [ "$pane_now" != "$pane_before" ]; then
      break  # pane mudou → Claude está processando
    fi
  done
  # Se pane não mudou após 10s, o Enter não foi aceito — tenta novamente
  local pane_final
  pane_final=$(tmux capture-pane -t "$target" -p 2>/dev/null | tail -3)
  if [ "$pane_final" = "$pane_before" ]; then
    log "RETRY $session — pane sem mudança após envio do prompt, reenviando Enter"
    tmux send-keys -t "$target" Enter
  fi

  # Watcher em background: invoca /braion:agent-wrapup quando backend fica idle.
  # Se o wrapup entrar em modo review (awaiting_review), aguarda interação do
  # usuário ou timeout antes de encerrar.
  # Pulado quando no_watcher=true (ex.: sessões warm-up que ficam idle de propósito)
  # OU quando reuse_session (attach_mode=window): o flag de idle e o kill-session do
  # watcher são keyed pelo nome da SESSÃO, não da janela — não fazem sentido aqui.
  if [ "$no_watcher" != "true" ] && [ -z "$reuse_session" ]; then
    local log_file="$LOG_FILE"
    local _session="$session"
    local _idle_dir="$IDLE_DIR"
    local _agent_name
    _agent_name=$(echo "$session" | sed 's/^braion-//' | sed 's/-HO-.*//')
    local _review_timeout="$REVIEW_TIMEOUT"
    (
      _idle() {
        [ -f "$_idle_dir/$_session" ]
      }

      _heartbeat_status() {
        _hb_get "$_agent_name" | jq -r '.status // ""' 2>/dev/null || echo ""
      }

      _review_expired() {
        local ws now elapsed
        ws=$(_hb_get "$_agent_name" | jq -r '.waiting_since // ""' 2>/dev/null || echo "")
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
  fi
}

# Bloco CLI: permite invocar o launcher diretamente (warm-up usa isto).
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  start_session "$@"
fi
