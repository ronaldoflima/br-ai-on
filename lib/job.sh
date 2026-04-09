#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
JOBS_DIR="${JOBS_DIR:-$PROJECT_ROOT/agents/shared/jobs}"
LOCK_SH="$SCRIPT_DIR/lock.sh"

mkdir -p "$JOBS_DIR/archive"

job_next_id() {
  local prefix=$1
  local date_str
  date_str=$(date -u +%Y%m%d)
  local seq=1
  for f in "$JOBS_DIR"/${prefix}-"${date_str}"-*.json "$JOBS_DIR"/archive/${prefix}-"${date_str}"-*.json; do
    [ -f "$f" ] || continue
    local fname
    fname=$(basename "$f" .json)
    local num
    num=$(echo "$fname" | sed -n "s/${prefix}-${date_str}-\([0-9]*\)/\1/p")
    if [ -n "$num" ] && [ "$((10#$num))" -ge "$seq" ]; then
      seq=$((10#$num + 1))
    fi
  done
  printf "%s-%s-%03d" "$prefix" "$date_str" "$seq"
}

job_create() {
  local created_by="${1:?Uso: job.sh create <created_by> <description> <agents_csv>}"
  local description="${2:?Uso: job.sh create <created_by> <description> <agents_csv>}"
  local agents_csv="${3:?Uso: job.sh create <created_by> <description> <agents_csv>}"

  bash "$LOCK_SH" acquire "job-system" jobs > /dev/null 2>&1 || true

  local job_id thread_id timestamp
  job_id=$(job_next_id "JOB")
  thread_id=$(job_next_id "THR")
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  local expected_json="[]"
  IFS=',' read -ra agents <<< "$agents_csv"
  for agent in "${agents[@]}"; do
    agent=$(echo "$agent" | xargs)
    expected_json=$(echo "$expected_json" | jq --arg a "$agent" '. + [{"agent": $a, "handoff_id": null}]')
  done

  jq -n \
    --arg id "$job_id" \
    --arg tid "$thread_id" \
    --arg desc "$description" \
    --arg cb "$created_by" \
    --arg ts "$timestamp" \
    --argjson exp "$expected_json" \
    '{
      id: $id,
      thread_id: $tid,
      description: $desc,
      created_by: $cb,
      created: $ts,
      status: "pending",
      expected: $exp,
      completed: [],
      failed: [],
      result_summary: null
    }' > "$JOBS_DIR/${job_id}.json"

  bash "$LOCK_SH" release "job-system" jobs > /dev/null 2>&1 || true

  echo "$job_id"
  echo "$thread_id"
}

job_complete() {
  local job_id="${1:?Uso: job.sh complete <job_id> <agent> [handoff_id]}"
  local agent="${2:?Uso: job.sh complete <job_id> <agent>}"
  local handoff_id="${3:-null}"
  local job_file="$JOBS_DIR/${job_id}.json"

  [ -f "$job_file" ] || { echo "job_not_found: $job_id" >&2; return 1; }

  bash "$LOCK_SH" acquire "job-system" jobs > /dev/null 2>&1 || true

  local timestamp
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  local tmp
  tmp=$(mktemp)
  jq --arg a "$agent" --arg ho "$handoff_id" --arg ts "$timestamp" '
    .completed += [{"agent": $a, "handoff_id": $ho, "completed_at": $ts}]
    | if (.completed | length) == (.expected | length) then .status = "completed"
      elif (.completed | length) + (.failed | length) == (.expected | length) then .status = "partial_failure"
      else .status = "in_progress"
      end
  ' "$job_file" > "$tmp" && mv "$tmp" "$job_file"

  bash "$LOCK_SH" release "job-system" jobs > /dev/null 2>&1 || true
}

job_fail() {
  local job_id="${1:?Uso: job.sh fail <job_id> <agent> [reason]}"
  local agent="${2:?Uso: job.sh fail <job_id> <agent>}"
  local reason="${3:-unknown}"
  local job_file="$JOBS_DIR/${job_id}.json"

  [ -f "$job_file" ] || { echo "job_not_found: $job_id" >&2; return 1; }

  bash "$LOCK_SH" acquire "job-system" jobs > /dev/null 2>&1 || true

  local timestamp
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  local tmp
  tmp=$(mktemp)
  jq --arg a "$agent" --arg r "$reason" --arg ts "$timestamp" '
    .failed += [{"agent": $a, "reason": $r, "failed_at": $ts}]
    | if (.completed | length) + (.failed | length) == (.expected | length) then
        if (.failed | length) > 0 then .status = "partial_failure"
        else .status = "completed"
        end
      else .status = "in_progress"
      end
  ' "$job_file" > "$tmp" && mv "$tmp" "$job_file"

  bash "$LOCK_SH" release "job-system" jobs > /dev/null 2>&1 || true
}

job_status() {
  local job_id="${1:?Uso: job.sh status <job_id>}"
  local job_file="$JOBS_DIR/${job_id}.json"
  [ -f "$job_file" ] || { echo "job_not_found: $job_id" >&2; return 1; }
  cat "$job_file"
}

job_list_pending() {
  for f in "$JOBS_DIR"/JOB-*.json; do
    [ -f "$f" ] || continue
    local status
    status=$(jq -r '.status' "$f" 2>/dev/null || echo "")
    if [ "$status" = "pending" ] || [ "$status" = "in_progress" ]; then
      local id
      id=$(jq -r '.id' "$f")
      echo "$id"
    fi
  done
}

job_archive() {
  local job_id="${1:?Uso: job.sh archive <job_id>}"
  local job_file="$JOBS_DIR/${job_id}.json"
  [ -f "$job_file" ] || { echo "job_not_found: $job_id" >&2; return 1; }
  mv "$job_file" "$JOBS_DIR/archive/${job_id}.json"
}

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
