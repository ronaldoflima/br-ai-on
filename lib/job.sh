#!/usr/bin/env bash
set -euo pipefail

# lib/job.sh — Gerenciamento de jobs compartilhados (wrapper sobre state.sh).
# Uso:
#   job.sh create <created_by> <description> <agents_csv>
#   job.sh complete <job_id> <agent> [handoff_id]
#   job.sh fail <job_id> <agent> [reason]
#   job.sh status <job_id>
#   job.sh list-pending
#   job.sh archive <job_id>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCK_SH="$SCRIPT_DIR/lock.sh"

# Compat retro: JOBS_DIR explícito vira BRAION_JOBS_DIR para o state.sh.
if [[ -n "${JOBS_DIR:-}" && -z "${BRAION_JOBS_DIR:-}" ]]; then
  export BRAION_JOBS_DIR="$JOBS_DIR"
fi

# shellcheck source=./state.sh
source "$SCRIPT_DIR/state.sh"

_with_lock() {
  bash "$LOCK_SH" acquire "job-system" jobs >/dev/null 2>&1 || true
  "$@"
  local rc=$?
  bash "$LOCK_SH" release "job-system" jobs >/dev/null 2>&1 || true
  return $rc
}

job_create()       { _with_lock state_job_create        "$@"; }
job_complete()     { _with_lock state_job_complete      "$@"; }
job_fail()         { _with_lock state_job_fail          "$@"; }
job_status()       { state_job_status        "$@"; }
job_list_pending() { state_job_list_pending  "$@"; }
job_archive()      { state_job_archive       "$@"; }

command="${1:?Uso: job.sh <create|complete|fail|status|list-pending|archive> [args...]}"
shift
case "$command" in
  create)       job_create "$@" ;;
  complete)     job_complete "$@" ;;
  fail)         job_fail "$@" ;;
  status)       job_status "$@" ;;
  list-pending) job_list_pending ;;
  archive)      job_archive "$@" ;;
  *)            echo "Comando desconhecido: $command" >&2; exit 1 ;;
esac
