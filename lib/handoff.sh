#!/usr/bin/env bash
set -euo pipefail

# lib/handoff.sh — Helper para handoffs entre agentes
# Uso:
#   handoff.sh send <from> <to> <expects> [reply_to] [descricao] [contexto] [esperado] [thread_id]
#   handoff.sh list <agent>
#   handoff.sh claim <agent> <handoff_file>
#   handoff.sh archive <agent> <handoff_file>
#   handoff.sh next_id
#   handoff.sh thread-history <thread_id>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENTS_DIR="$PROJECT_ROOT/agents"

handoff_next_id() {
  local date_str
  date_str=$(date -u +%Y%m%d)
  local seq=1
  for dir in "$AGENTS_DIR"/*/handoffs/inbox "$AGENTS_DIR"/*/handoffs/archive "$AGENTS_DIR"/*/handoffs/in_progress; do
    [ -d "$dir" ] || continue
    for f in "$dir"/HO-"${date_str}"-*.md; do
      [ -f "$f" ] || continue
      local fname
      fname=$(basename "$f")
      local num
      num=$(echo "$fname" | sed -n "s/HO-${date_str}-\([0-9]*\)_.*/\1/p")
      if [ -n "$num" ] && [ "$((10#$num))" -ge "$seq" ]; then
        seq=$((10#$num + 1))
      fi
    done
  done
  printf "HO-%s-%03d" "$date_str" "$seq"
}

handoff_send() {
  local from="${1:?Uso: handoff.sh send <from> <to> <expects> [reply_to] [descricao] [contexto] [esperado] [thread_id]}"
  local to="${2:?Uso: handoff.sh send <from> <to> <expects> [reply_to]}"
  local expects="${3:?Uso: handoff.sh send <from> <to> <expects> [reply_to]}"
  local reply_to="${4:-null}"
  local description="${5:-}"
  local context="${6:-}"
  local expected="${7:-}"
  local thread_id="${8:-}"

  if [ -z "$thread_id" ] && [ "$reply_to" != "null" ]; then
    for dir in "$AGENTS_DIR"/*/handoffs/inbox "$AGENTS_DIR"/*/handoffs/in_progress "$AGENTS_DIR"/*/handoffs/archive; do
      [ -d "$dir" ] || continue
      for f in "$dir"/HO-*.md; do
        [ -f "$f" ] || continue
        if grep -q "^id: $reply_to" "$f" 2>/dev/null; then
          local found_thread
          found_thread=$(grep '^thread_id:' "$f" | sed 's/thread_id: //')
          if [ -n "$found_thread" ]; then
            thread_id="$found_thread"
          fi
          break 2
        fi
      done
    done
  fi

  local inbox_dir="$AGENTS_DIR/$to/handoffs/inbox"
  mkdir -p "$inbox_dir"

  local ho_id
  ho_id=$(handoff_next_id)
  local timestamp
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local filename="${ho_id}_from-${from}.md"
  local filepath="$inbox_dir/$filename"

  cat > "$filepath" <<HANDOFF_EOF
---
id: $ho_id
from: $from
to: $to
created: $timestamp
status: pending
expects: $expects
reply_to: $reply_to
$([ -n "$thread_id" ] && echo "thread_id: $thread_id")
---

## Descricao
$description

## Contexto
$context

## Esperado
$expected
HANDOFF_EOF

  echo "$filepath"

  AGENT_NAME="$from" bash "$SCRIPT_DIR/logger.sh" handoff_sent "Handoff $ho_id enviado para $to" \
    "{\"handoff_id\":\"$ho_id\",\"to\":\"$to\",\"expects\":\"$expects\",\"reply_to\":\"$reply_to\",\"thread_id\":\"$thread_id\"}" 2>/dev/null || true
}

handoff_list() {
  local agent="${1:?Uso: handoff.sh list <agent>}"
  local inbox_dir="$AGENTS_DIR/$agent/handoffs/inbox"
  if [ ! -d "$inbox_dir" ]; then
    return 0
  fi
  for f in "$inbox_dir"/HO-*.md; do
    [ -f "$f" ] || continue
    echo "$f"
  done
}

handoff_claim() {
  local agent="${1:?Uso: handoff.sh claim <agent> <handoff_file>}"
  local handoff_file="${2:?Uso: handoff.sh claim <agent> <handoff_file>}"
  local in_progress_dir="$AGENTS_DIR/$agent/handoffs/in_progress"
  mkdir -p "$in_progress_dir"

  local filename
  filename=$(basename "$handoff_file")

  local ho_id
  ho_id=$(echo "$filename" | sed -n 's/\(HO-[0-9]*-[0-9]*\)_.*/\1/p')

  sed -i 's/^status: pending/status: in_progress/' "$handoff_file"

  mv "$handoff_file" "$in_progress_dir/$filename"

  AGENT_NAME="$agent" bash "$SCRIPT_DIR/logger.sh" handoff_claimed "Handoff $ho_id em processamento" \
    "{\"handoff_id\":\"$ho_id\"}" 2>/dev/null || true

  echo "$in_progress_dir/$filename"
}

handoff_artifacts_dir() {
  local agent="${1:?Uso: handoff.sh artifacts-dir <agent> <ho_id>}"
  local ho_id="${2:?Uso: handoff.sh artifacts-dir <agent> <ho_id>}"
  local dir="$AGENTS_DIR/$agent/handoffs/artifacts/$ho_id"
  mkdir -p "$dir"
  echo "$dir"
}

handoff_archive() {
  local agent="${1:?Uso: handoff.sh archive <agent> <handoff_file>}"
  local handoff_file="${2:?Uso: handoff.sh archive <agent> <handoff_file>}"
  local archive_dir="$AGENTS_DIR/$agent/handoffs/archive"
  mkdir -p "$archive_dir"

  local filename
  filename=$(basename "$handoff_file")

  local ho_id
  ho_id=$(echo "$filename" | sed -n 's/\(HO-[0-9]*-[0-9]*\)_.*/\1/p')

  sed -i 's/^status: \(pending\|in_progress\)/status: archived/' "$handoff_file"

  mv "$handoff_file" "$archive_dir/$filename"

  AGENT_NAME="$agent" bash "$SCRIPT_DIR/logger.sh" handoff_processed "Handoff $ho_id arquivado" \
    "{\"handoff_id\":\"$ho_id\"}" 2>/dev/null || true
}

handoff_thread_history() {
  local thread_id="${1:?Uso: handoff.sh thread-history <thread_id>}"
  local results=()
  for dir in "$AGENTS_DIR"/*/handoffs/inbox "$AGENTS_DIR"/*/handoffs/in_progress "$AGENTS_DIR"/*/handoffs/archive; do
    [ -d "$dir" ] || continue
    for f in "$dir"/HO-*.md; do
      [ -f "$f" ] || continue
      if grep -q "^thread_id: $thread_id" "$f" 2>/dev/null; then
        local from to status created
        from=$(grep '^from:' "$f" | sed 's/from: //')
        to=$(grep '^to:' "$f" | sed 's/to: //')
        status=$(grep '^status:' "$f" | sed 's/status: //')
        created=$(grep '^created:' "$f" | sed 's/created: //')
        results+=("$created|$from|$to|$status")
      fi
    done
  done
  if [ ${#results[@]} -eq 0 ]; then
    echo "No handoffs found for thread $thread_id"
    return 0
  fi
  printf '%s\n' "${results[@]}" | sort | while IFS='|' read -r created from to status; do
    printf '%s  %s -> %s  [%s]\n' "$created" "$from" "$to" "$status"
  done
}

command="${1:?Uso: handoff.sh <send|list|claim|archive|artifacts-dir|next_id|thread-history> [args...]}"
shift
case "$command" in
  send)          handoff_send "$@" ;;
  list)          handoff_list "$@" ;;
  claim)         handoff_claim "$@" ;;
  archive)       handoff_archive "$@" ;;
  artifacts-dir)   handoff_artifacts_dir "$@" ;;
  next_id)         handoff_next_id ;;
  thread-history)  handoff_thread_history "$@" ;;
  *)               echo "Comando desconhecido: $command" >&2; exit 1 ;;
esac
