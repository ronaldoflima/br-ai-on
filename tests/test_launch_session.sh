#!/usr/bin/env bash
# Testa o launcher extraído: sourceabilidade sem efeitos colaterais + opt-out do watcher.
set -uo pipefail
BR=$(cd "$(dirname "$0")/.." && pwd)
fail=0
t() { if eval "$2"; then echo "ok - $1"; else echo "FAIL - $1"; fail=1; fi; }

# 1) launch-session.sh existe e é sourceável SEM rodar ciclo de cron.
out=$(BRAION="$BR" bash -c 'source "'"$BR"'/lib/launch-session.sh"; type start_session >/dev/null 2>&1 && echo DEFINED' 2>&1)
t "launch-session.sh sourceável e define start_session" '[ "$out" = "DEFINED" ]'
t "sourcing não roda ciclo de cron" '! echo "$out" | grep -q "Ciclo concluído"'

# 2) no_watcher=true NÃO deixa job em background.
stub='
  tmux() { :; }
  cli_send_start_command() { :; }
  cli_build_start_cmd() { echo "claude"; }
  cli_wait_ready() { :; }
  cli_permission_mode_default() { echo "plan"; }
  cli_default_model() { echo "default"; }
  cli_send_slash_command() { :; }
  session_running() { return 1; }
  session_clear_idle() { :; }
  _hb_get() { echo "{}"; }
  state_heartbeat_get() { echo "{}"; }
'
nojob=$(BRAION="$BR" IDLE_DIR=/tmp REVIEW_TIMEOUT=1 bash -c '
  source "'"$BR"'/lib/launch-session.sh"
  '"$stub"'
  start_session warmup-test /tmp "echo hi" default plan "" "" "[]" true
  sleep 0.2
  jobs -p | wc -l | tr -d " "
' 2>/dev/null)
t "no_watcher=true não cria job em background" '[ "${nojob:-1}" = "0" ]'

# 3) attach_mode=window (ex.: task-warmup dentro de tmux) abre JANELA na sessão
# atual em vez de criar sessão nova.
callfile=$(mktemp)
BRAION="$BR" IDLE_DIR=/tmp REVIEW_TIMEOUT=1 TMUX=/tmp/fake-tmux-socket bash -c '
  source "'"$BR"'/lib/launch-session.sh"
  tmux() {
    case "$1" in
      display-message) echo "main" ;;
      list-windows) : ;;  # nenhuma janela existente ainda
      new-window) echo "NEWWINDOW $*" >> "'"$callfile"'" ;;
      capture-pane) echo "x claude ❯" ;;
      *) : ;;
    esac
  }
  cli_send_start_command() { :; }
  cli_build_start_cmd() { echo "claude"; }
  cli_prompt_glyph() { echo "❯"; }
  cli_permission_mode_default() { echo "plan"; }
  cli_default_model() { echo "default"; }
  session_running() { return 1; }
  session_clear_idle() { :; }
  start_session warmup-test /tmp "echo hi" default plan "" "" "[]" true window
' >/dev/null 2>&1
t "attach_mode=window cria nova janela (new-window) na sessão atual" \
  'grep -q "NEWWINDOW new-window -t main -n warmup-test" "$callfile"'
rm -f "$callfile"

[ "$fail" = "0" ] && echo "TODOS OK" || { echo "FALHAS"; exit 1; }
