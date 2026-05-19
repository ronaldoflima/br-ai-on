#!/usr/bin/env bash
set -euo pipefail

# lib/handoff.sh — Helper para handoffs entre agentes (wrapper sobre state.sh)
# Uso:
#   handoff.sh send <from> <to> <expects> [reply_to] [descricao] [contexto] [esperado] [thread_id] [job_id]
#   handoff.sh list <agent>
#   handoff.sh claim <agent> <handoff_file>
#   handoff.sh archive <agent> <handoff_file>
#   handoff.sh next_id
#   handoff.sh thread-history <thread_id>
#   handoff.sh job-agent <handoff_file>
#   handoff.sh artifacts-dir <agent> <ho_id>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./state.sh
source "$SCRIPT_DIR/state.sh"

_handoff_id_from_path() {
  # Aceita tanto path de arquivo (HO-...-NNN_from-X.md) quanto pseudo-path pg:// e id puro.
  case "$1" in
    pg://*) echo "${1#pg://}" ;;
    HO-*-*) echo "$1" ;;
    *) basename "$1" | sed -n 's/\(HO-[0-9]*-[0-9]*\).*/\1/p' ;;
  esac
}

handoff_next_id() { state_handoff_next_id; }

handoff_send() {
  local from="${1:?Uso: handoff.sh send <from> <to> <expects> [reply_to] [descricao] [contexto] [esperado] [thread_id] [job_id]}"
  local to="${2:?}"
  local expects="${3:?}"
  local reply_to="${4:-null}"
  local description="${5:-}"
  local context="${6:-}"
  local expected="${7:-}"
  local thread_id="${8:-}"
  local job_id="${9:-}"

  if [[ -z "$thread_id" && "$reply_to" != "null" ]]; then
    thread_id=$(state_handoff_find_thread "$reply_to" || true)
  fi

  local body
  body=$(printf '## Descricao\n%s\n\n## Contexto\n%s\n\n## Esperado\n%s' "$description" "$context" "$expected")

  local ho_id
  ho_id=$(state_handoff_next_id)
  local filepath
  filepath=$(state_handoff_create "$ho_id" "$from" "$to" "$expects" "$reply_to" "$thread_id" "$job_id" "$body")
  echo "$filepath"

  AGENT_NAME="$from" bash "$SCRIPT_DIR/logger.sh" handoff_sent "Handoff $ho_id enviado para $to" \
    "{\"handoff_id\":\"$ho_id\",\"to\":\"$to\",\"expects\":\"$expects\",\"reply_to\":\"$reply_to\",\"thread_id\":\"$thread_id\",\"job_id\":\"$job_id\"}" 2>/dev/null || true
}

handoff_list() {
  local agent="${1:?Uso: handoff.sh list <agent>}"
  state_handoff_list "$agent" pending
}

handoff_claim() {
  local agent="${1:?Uso: handoff.sh claim <agent> <handoff_file>}"
  local handoff_file="${2:?}"
  local ho_id
  ho_id=$(_handoff_id_from_path "$handoff_file")
  local new_path
  new_path=$(state_handoff_set_status "$ho_id" in_progress)
  AGENT_NAME="$agent" bash "$SCRIPT_DIR/logger.sh" handoff_claimed "Handoff $ho_id em processamento" \
    "{\"handoff_id\":\"$ho_id\"}" 2>/dev/null || true
  echo "$new_path"
}

handoff_archive() {
  local agent="${1:?Uso: handoff.sh archive <agent> <handoff_file>}"
  local handoff_file="${2:?}"
  local ho_id
  ho_id=$(_handoff_id_from_path "$handoff_file")
  state_handoff_set_status "$ho_id" archived >/dev/null
  AGENT_NAME="$agent" bash "$SCRIPT_DIR/logger.sh" handoff_processed "Handoff $ho_id arquivado" \
    "{\"handoff_id\":\"$ho_id\"}" 2>/dev/null || true
}

handoff_artifacts_dir() {
  local agent="${1:?Uso: handoff.sh artifacts-dir <agent> <ho_id>}"
  local ho_id="${2:?}"
  state_handoff_artifact_dir "$agent" "$ho_id"
}

handoff_thread_history() {
  local thread_id="${1:?Uso: handoff.sh thread-history <thread_id>}"
  local out
  out=$(state_handoff_thread_history "$thread_id")
  if [[ -z "$out" ]]; then
    echo "No handoffs found for thread $thread_id"
  else
    echo "$out"
  fi
}

handoff_job_agent() {
  local handoff_file="${1:?Uso: handoff.sh job-agent <handoff_file>}"
  [[ -f "$handoff_file" ]] || return 0
  grep '^job_id:' "$handoff_file" 2>/dev/null | sed 's/job_id: //' | xargs || true
}

command="${1:?Uso: handoff.sh <send|list|claim|archive|artifacts-dir|next_id|thread-history|job-agent> [args...]}"
shift
case "$command" in
  send)            handoff_send "$@" ;;
  list)            handoff_list "$@" ;;
  claim)           handoff_claim "$@" ;;
  archive)         handoff_archive "$@" ;;
  artifacts-dir)   handoff_artifacts_dir "$@" ;;
  next_id)         handoff_next_id ;;
  thread-history)  handoff_thread_history "$@" ;;
  job-agent)       handoff_job_agent "$@" ;;
  *)               echo "Comando desconhecido: $command" >&2; exit 1 ;;
esac
