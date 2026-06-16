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

[ "$fail" = "0" ] && echo "TODOS OK" || { echo "FALHAS"; exit 1; }
