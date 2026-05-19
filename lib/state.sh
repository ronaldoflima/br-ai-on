#!/usr/bin/env bash
# lib/state.sh — Camada de abstração de estado dos agentes
#
# Dispatcher entre backends:
#   BRAION_STATE_BACKEND=file (default)  → arquivos sob agents/<nome>/
#   BRAION_STATE_BACKEND=pg              → Postgres (PGSERVICE=braion em ~/.pg_service.conf)
#
# Interface pública (todas idempotentes/seguras pra script):
#   state_heartbeat_get <agent>
#   state_heartbeat_set <agent> <json>
#
#   state_doc_get      <agent> <doc_type> [date]
#   state_doc_set      <agent> <doc_type> [date] < content_stdin
#   state_doc_append   <agent> <doc_type> [date] < chunk_stdin
#
#   state_episodic_append <agent> <json>
#   state_episodic_search <agent> <pattern> [limit]
#
#   state_cache_get   <agent> <key>
#   state_cache_set   <agent> <key> <json> [ttl_seconds]
#   state_cache_clear <agent> [key]
#
#   state_shared_kv_get <key>
#   state_shared_kv_set <key> <json>
#
#   state_log_write <agent> <json>
#
# Convenções:
#   - doc_type ∈ {current_objective, decisions, completed_tasks, semantic_memory,
#                 notebooklm_sources, last_commit, ...}
#   - date opcional: vazio = "flat" (sem rotação diária). YYYY-MM-DD habilita rotação.
#   - Todos os JSONs são strings JSON válidas (validados por jq).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENTS_DIR="${BRAION_AGENTS_DIR:-$PROJECT_ROOT/agents}"
LOGS_DIR="${BRAION_LOGS_DIR:-$PROJECT_ROOT/logs}"

state_backend() { echo "${BRAION_STATE_BACKEND:-file}"; }

# Mapeia doc_type → caminho relativo dentro de state/ ou memory/.
# Para tipos que têm versão "flat" (.md no nível de state/) e "diária" (state/<type>/YYYY-MM-DD.md),
# o file backend decide pela presença de doc_date.
_state_file_doc_path() {
  local agent="$1" doc_type="$2" date="${3:-}"
  local base="$AGENTS_DIR/$agent"
  case "$doc_type" in
    semantic_memory)     echo "$base/memory/semantic.md" ;;
    notebooklm_sources)  echo "$base/state/notebooklm_sources.md" ;;
    last_commit)         echo "$base/state/last_commit.md" ;;
    current_objective|decisions|completed_tasks)
      if [[ -n "$date" ]]; then
        echo "$base/state/$doc_type/$date.md"
      else
        echo "$base/state/$doc_type.md"
      fi
      ;;
    *) echo "$base/state/$doc_type.md" ;;
  esac
}

# ----------------------------------------------------------------------------
# Backend: file
# ----------------------------------------------------------------------------

_state_file_heartbeat_get() {
  local agent="$1"
  local f="$AGENTS_DIR/$agent/state/heartbeat.json"
  if [[ -f "$f" ]]; then cat "$f"; else echo '{}'; fi
}
_state_file_heartbeat_set() {
  local agent="$1" json="$2"
  local f="$AGENTS_DIR/$agent/state/heartbeat.json"
  mkdir -p "$(dirname "$f")"
  printf '%s\n' "$json" | jq -c '.' > "$f"
}

_state_file_doc_get() {
  local agent="$1" doc_type="$2" date="${3:-}"
  local f
  f=$(_state_file_doc_path "$agent" "$doc_type" "$date")
  [[ -f "$f" ]] && cat "$f" || true
}
_state_file_doc_set() {
  local agent="$1" doc_type="$2" date="${3:-}"
  local f
  f=$(_state_file_doc_path "$agent" "$doc_type" "$date")
  mkdir -p "$(dirname "$f")"
  cat > "$f"
}
_state_file_doc_append() {
  local agent="$1" doc_type="$2" date="${3:-}"
  local f
  f=$(_state_file_doc_path "$agent" "$doc_type" "$date")
  mkdir -p "$(dirname "$f")"
  cat >> "$f"
}

_state_file_episodic_append() {
  local agent="$1" json="$2"
  local f="$AGENTS_DIR/$agent/memory/episodic.jsonl"
  mkdir -p "$(dirname "$f")"
  printf '%s\n' "$json" | jq -c '.' >> "$f"
}
_state_file_episodic_search() {
  local agent="$1" pattern="$2" limit="${3:-10}"
  local f="$AGENTS_DIR/$agent/memory/episodic.jsonl"
  [[ -f "$f" ]] || return 0
  grep -i "$pattern" "$f" | tail -n "$limit"
}

_state_file_cache_get() {
  local agent="$1" key="$2"
  local f="$AGENTS_DIR/$agent/state/cache/$key.json"
  [[ -f "$f" ]] || return 1
  local cached_at ttl now
  cached_at=$(jq -r '.cached_at' "$f")
  ttl=$(jq -r '.ttl_seconds // 300' "$f")
  now=$(date +%s)
  if (( now - cached_at > ttl )); then rm -f "$f"; return 1; fi
  jq -r '.result' "$f"
}
_state_file_cache_set() {
  local agent="$1" key="$2" value="$3" ttl="${4:-300}"
  local f="$AGENTS_DIR/$agent/state/cache/$key.json"
  mkdir -p "$(dirname "$f")"
  local now; now=$(date +%s)
  jq -nc --argjson result "$value" --argjson cached_at "$now" --argjson ttl "$ttl" \
    '{result:$result,cached_at:$cached_at,ttl_seconds:$ttl}' > "$f"
}
_state_file_cache_clear() {
  local agent="$1" key="${2:-}"
  local dir="$AGENTS_DIR/$agent/state/cache"
  [[ -d "$dir" ]] || return 0
  if [[ -n "$key" ]]; then rm -f "$dir/$key.json"; else rm -f "$dir"/*.json 2>/dev/null || true; fi
}

_state_file_shared_kv_get() {
  local key="$1"
  local f="$AGENTS_DIR/shared/${key}.json"
  if [[ -f "$f" ]]; then cat "$f"; else echo 'null'; fi
}
_state_file_shared_kv_set() {
  local key="$1" value="$2"
  local f="$AGENTS_DIR/shared/${key}.json"
  mkdir -p "$(dirname "$f")"
  printf '%s\n' "$value" | jq '.' > "$f"
}

_state_file_log_write() {
  local agent="$1" json="$2"
  local date_file; date_file=$(date -u +"%Y-%m-%d")
  local f="$LOGS_DIR/${agent}_${date_file}.jsonl"
  mkdir -p "$LOGS_DIR"
  printf '%s\n' "$json" | jq -c '.' >> "$f"
}

# Handoffs --------------------------------------------------------------------
# Esquema em arquivo:
#   agents/<to>/handoffs/{inbox,in_progress,archive}/HO-YYYYMMDD-NNN_from-<from>.md
#   agents/<to>/handoffs/artifacts/<HO-ID>/<arquivo>

_state_file_handoff_dirs_for() {
  local to="$1"
  echo "$AGENTS_DIR/$to/handoffs/inbox"
  echo "$AGENTS_DIR/$to/handoffs/in_progress"
  echo "$AGENTS_DIR/$to/handoffs/archive"
}

_state_file_handoff_find() {
  local id="$1"
  # Retorna o path do arquivo se encontrado, vazio caso contrário.
  for dir in "$AGENTS_DIR"/*/handoffs/inbox \
             "$AGENTS_DIR"/*/handoffs/in_progress \
             "$AGENTS_DIR"/*/handoffs/archive; do
    [[ -d "$dir" ]] || continue
    for f in "$dir"/"${id}"_*.md; do
      [[ -f "$f" ]] || continue
      echo "$f"
      return 0
    done
  done
  return 1
}

_state_file_handoff_next_id() {
  local date_str; date_str=$(date -u +%Y%m%d)
  local seq=1
  for dir in "$AGENTS_DIR"/*/handoffs/inbox \
             "$AGENTS_DIR"/*/handoffs/in_progress \
             "$AGENTS_DIR"/*/handoffs/archive; do
    [[ -d "$dir" ]] || continue
    for f in "$dir"/HO-"${date_str}"-*.md; do
      [[ -f "$f" ]] || continue
      local num
      num=$(basename "$f" | sed -n "s/HO-${date_str}-\([0-9]*\)_.*/\1/p")
      if [[ -n "$num" && $((10#$num)) -ge $seq ]]; then
        seq=$((10#$num + 1))
      fi
    done
  done
  printf "HO-%s-%03d" "$date_str" "$seq"
}

_state_file_handoff_create() {
  # state_handoff_create <id> <from> <to> <expects> <reply_to> <thread_id> <job_id> <body>
  local id="$1" from="$2" to="$3" expects="$4" reply_to="$5" thread_id="$6" job_id="$7" body="$8"
  local dir="$AGENTS_DIR/$to/handoffs/inbox"
  mkdir -p "$dir"
  local filepath="$dir/${id}_from-${from}.md"
  local timestamp; timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  {
    echo "---"
    echo "id: $id"
    echo "from: $from"
    echo "to: $to"
    echo "created: $timestamp"
    echo "status: pending"
    echo "expects: $expects"
    echo "reply_to: $reply_to"
    [[ -n "$thread_id" ]] && echo "thread_id: $thread_id"
    [[ -n "$job_id" ]] && echo "job_id: $job_id"
    echo "---"
    echo ""
    printf '%s\n' "$body"
  } > "$filepath"
  echo "$filepath"
}

_state_file_handoff_read() {
  local id="$1"
  local f; f=$(_state_file_handoff_find "$id") || return 1
  cat "$f"
}

_state_file_handoff_list() {
  # state_handoff_list <to_agent> <status>  (status: pending|in_progress|archived)
  local to="$1" status="$2"
  local subdir
  case "$status" in
    pending)     subdir="inbox" ;;
    in_progress) subdir="in_progress" ;;
    archived)    subdir="archive" ;;
    *) echo "status inválido: $status" >&2; return 2 ;;
  esac
  local dir="$AGENTS_DIR/$to/handoffs/$subdir"
  [[ -d "$dir" ]] || return 0
  for f in "$dir"/HO-*.md; do
    [[ -f "$f" ]] || continue
    echo "$f"
  done
}

_state_file_handoff_set_status() {
  # state_handoff_set_status <id> <new_status>
  local id="$1" new_status="$2"
  local f; f=$(_state_file_handoff_find "$id") || return 1
  local to; to=$(grep '^to:' "$f" | head -1 | sed 's/to: //')
  local subdir
  case "$new_status" in
    pending)     subdir="inbox" ;;
    in_progress) subdir="in_progress" ;;
    archived)    subdir="archive" ;;
    *) echo "status inválido: $new_status" >&2; return 2 ;;
  esac
  local dest_dir="$AGENTS_DIR/$to/handoffs/$subdir"
  mkdir -p "$dest_dir"
  # Atualiza frontmatter inline (mac/linux: sem -i comum, usar sed via tmp)
  local tmp; tmp=$(mktemp)
  awk -v ns="$new_status" '
    /^status: / && !done { print "status: " ns; done=1; next }
    { print }
  ' "$f" > "$tmp" && mv "$tmp" "$f"
  local dest="$dest_dir/$(basename "$f")"
  if [[ "$f" != "$dest" ]]; then
    mv "$f" "$dest"
  fi
  echo "$dest"
}

_state_file_handoff_find_thread() {
  # Lookup thread_id by reply_to id (returns thread_id or empty).
  local reply_to="$1"
  [[ -z "$reply_to" || "$reply_to" == "null" ]] && return 0
  local f; f=$(_state_file_handoff_find "$reply_to") || return 0
  grep '^thread_id:' "$f" | head -1 | sed 's/thread_id: //' || true
}

_state_file_handoff_thread_history() {
  local thread_id="$1"
  local out=()
  for dir in "$AGENTS_DIR"/*/handoffs/inbox \
             "$AGENTS_DIR"/*/handoffs/in_progress \
             "$AGENTS_DIR"/*/handoffs/archive; do
    [[ -d "$dir" ]] || continue
    for f in "$dir"/HO-*.md; do
      [[ -f "$f" ]] || continue
      if grep -q "^thread_id: $thread_id" "$f" 2>/dev/null; then
        local created from to status
        created=$(grep '^created:' "$f" | head -1 | sed 's/created: //')
        from=$(grep '^from:' "$f" | head -1 | sed 's/from: //')
        to=$(grep '^to:' "$f" | head -1 | sed 's/to: //')
        status=$(grep '^status:' "$f" | head -1 | sed 's/status: //')
        out+=("$created|$from|$to|$status")
      fi
    done
  done
  [[ ${#out[@]} -eq 0 ]] && return 0
  printf '%s\n' "${out[@]}" | sort | while IFS='|' read -r created from to status; do
    printf '%s  %s -> %s  [%s]\n' "$created" "$from" "$to" "$status"
  done
}

_state_file_handoff_artifact_dir() {
  # state_handoff_artifact_dir <to_agent> <id>
  local to="$1" id="$2"
  local dir="$AGENTS_DIR/$to/handoffs/artifacts/$id"
  mkdir -p "$dir"
  echo "$dir"
}

_state_file_handoff_artifact_save() {
  # state_handoff_artifact_save <to_agent> <id> <name> < content_stdin
  local to="$1" id="$2" name="$3"
  local dir; dir=$(_state_file_handoff_artifact_dir "$to" "$id")
  cat > "$dir/$name"
  echo "$dir/$name"
}

# Jobs ------------------------------------------------------------------------
JOBS_DIR_DEFAULT="${BRAION_JOBS_DIR:-$AGENTS_DIR/shared/jobs}"

_state_file_job_next_id() {
  local prefix="$1"
  local date_str; date_str=$(date -u +%Y%m%d)
  local seq=1
  mkdir -p "$JOBS_DIR_DEFAULT/archive"
  for f in "$JOBS_DIR_DEFAULT"/${prefix}-"${date_str}"-*.json "$JOBS_DIR_DEFAULT"/archive/${prefix}-"${date_str}"-*.json; do
    [[ -f "$f" ]] || continue
    local num
    num=$(basename "$f" .json | sed -n "s/${prefix}-${date_str}-\([0-9]*\)/\1/p")
    if [[ -n "$num" && $((10#$num)) -ge $seq ]]; then
      seq=$((10#$num + 1))
    fi
  done
  printf "%s-%s-%03d" "$prefix" "$date_str" "$seq"
}

_state_file_job_create() {
  # state_job_create <created_by> <description> <agents_csv>
  local created_by="$1" description="$2" agents_csv="$3"
  local job_id thread_id timestamp
  job_id=$(_state_file_job_next_id "JOB")
  thread_id=$(_state_file_job_next_id "THR")
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  local expected_json="[]"
  IFS=',' read -ra agents <<< "$agents_csv"
  for agent in "${agents[@]}"; do
    agent=$(echo "$agent" | xargs)
    expected_json=$(echo "$expected_json" | jq --arg a "$agent" '. + [{"agent": $a, "handoff_id": null}]')
  done

  jq -n \
    --arg id "$job_id" --arg tid "$thread_id" --arg desc "$description" \
    --arg cb "$created_by" --arg ts "$timestamp" --argjson exp "$expected_json" \
    '{id:$id,thread_id:$tid,description:$desc,created_by:$cb,created:$ts,status:"pending",expected:$exp,completed:[],failed:[],result_summary:null}' \
    > "$JOBS_DIR_DEFAULT/${job_id}.json"

  echo "$job_id"
  echo "$thread_id"
}

_state_file_job_status() {
  local job_id="$1"
  local f="$JOBS_DIR_DEFAULT/${job_id}.json"
  [[ -f "$f" ]] || { echo "job_not_found: $job_id" >&2; return 1; }
  cat "$f"
}

_state_file_job_update() {
  # internal helper: apply jq filter to job file
  local job_id="$1" filter="$2"; shift 2
  local f="$JOBS_DIR_DEFAULT/${job_id}.json"
  [[ -f "$f" ]] || { echo "job_not_found: $job_id" >&2; return 1; }
  local tmp; tmp=$(mktemp)
  jq "$@" "$filter" "$f" > "$tmp" && mv "$tmp" "$f"
}

_state_file_job_complete() {
  local job_id="$1" agent="$2" handoff_id="${3:-null}"
  local ts; ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  _state_file_job_update "$job_id" '
    .completed += [{"agent":$a,"handoff_id":$ho,"completed_at":$ts}]
    | if (.completed|length) == (.expected|length) then .status="completed"
      elif (.completed|length)+(.failed|length) == (.expected|length) then .status="partial_failure"
      else .status="in_progress" end
  ' --arg a "$agent" --arg ho "$handoff_id" --arg ts "$ts"
}

_state_file_job_fail() {
  local job_id="$1" agent="$2" reason="${3:-unknown}"
  local ts; ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  _state_file_job_update "$job_id" '
    .failed += [{"agent":$a,"reason":$r,"failed_at":$ts}]
    | if (.completed|length)+(.failed|length) == (.expected|length) then
        if (.failed|length) > 0 then .status="partial_failure" else .status="completed" end
      else .status="in_progress" end
  ' --arg a "$agent" --arg r "$reason" --arg ts "$ts"
}

_state_file_job_list_pending() {
  for f in "$JOBS_DIR_DEFAULT"/JOB-*.json; do
    [[ -f "$f" ]] || continue
    local status
    status=$(jq -r '.status' "$f" 2>/dev/null || echo "")
    if [[ "$status" == "pending" || "$status" == "in_progress" ]]; then
      jq -r '.id' "$f"
    fi
  done
}

_state_file_job_archive() {
  local job_id="$1"
  local f="$JOBS_DIR_DEFAULT/${job_id}.json"
  [[ -f "$f" ]] || { echo "job_not_found: $job_id" >&2; return 1; }
  mkdir -p "$JOBS_DIR_DEFAULT/archive"
  mv "$f" "$JOBS_DIR_DEFAULT/archive/${job_id}.json"
}

# ----------------------------------------------------------------------------
# Backend: pg
# ----------------------------------------------------------------------------
# Conexão: usa env vars padrão do libpq (PGHOST, PGPORT, PGUSER, PGPASSWORD,
# PGDATABASE) ou PGSERVICE apontando para ~/.pg_service.conf.
# Schema: braion (search_path setado a cada chamada).

_state_pg_psql() {
  psql --no-psqlrc -qAtX -v ON_ERROR_STOP=1 -c "SET search_path TO braion;" "$@"
}

_state_pg_ensure_agent() {
  local agent="$1"
  _state_pg_psql -c "INSERT INTO braion.agents(name) VALUES('$agent') ON CONFLICT DO NOTHING;" >/dev/null
}

_state_pg_heartbeat_get() {
  local agent="$1"
  _state_pg_ensure_agent "$agent"
  local row
  row=$(_state_pg_psql -c "
    SELECT jsonb_build_object(
      'last_ping', to_char(last_ping AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),
      'agent', agent_name,
      'status', status,
      'waiting_since', CASE WHEN waiting_since IS NULL THEN NULL
                            ELSE to_char(waiting_since AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') END,
      'active_protections', active_protections
    ) || extra
    FROM braion.heartbeat WHERE agent_name='$agent';
  ")
  if [[ -z "$row" ]]; then echo '{}'; else echo "$row"; fi
}

_state_pg_heartbeat_set() {
  local agent="$1" json="$2"
  _state_pg_ensure_agent "$agent"
  local q
  # Extrai campos conhecidos + guarda o restante em extra
  q=$(cat <<SQL
WITH input AS (SELECT \$JSON\$$json\$JSON\$::jsonb AS j)
INSERT INTO braion.heartbeat(agent_name, last_ping, status, waiting_since, active_protections, extra)
SELECT
  '$agent',
  COALESCE((j->>'last_ping')::timestamptz, now()),
  COALESCE(j->>'status','idle'),
  NULLIF(j->>'waiting_since','')::timestamptz,
  COALESCE(j->'active_protections','[]'::jsonb),
  (j - 'last_ping' - 'status' - 'waiting_since' - 'active_protections' - 'agent')
FROM input
ON CONFLICT (agent_name) DO UPDATE SET
  last_ping=EXCLUDED.last_ping,
  status=EXCLUDED.status,
  waiting_since=EXCLUDED.waiting_since,
  active_protections=EXCLUDED.active_protections,
  extra=EXCLUDED.extra;
SQL
)
  _state_pg_psql -c "$q" >/dev/null
}

_state_pg_doc_get() {
  local agent="$1" doc_type="$2" date="${3:-}"
  _state_pg_ensure_agent "$agent"
  if [[ -n "$date" ]]; then
    _state_pg_psql -c "SELECT content FROM braion.agent_documents WHERE agent_name='$agent' AND doc_type='$doc_type' AND doc_date='$date';"
  else
    _state_pg_psql -c "SELECT content FROM braion.agent_documents WHERE agent_name='$agent' AND doc_type='$doc_type' AND doc_date IS NULL;"
  fi
}

_state_pg_doc_set() {
  local agent="$1" doc_type="$2" date="${3:-}"
  _state_pg_ensure_agent "$agent"
  local content; content=$(cat; printf x); content="${content%x}"
  local date_sql; [[ -n "$date" ]] && date_sql="'$date'" || date_sql="NULL"
  local q
  q=$(cat <<SQL
INSERT INTO braion.agent_documents(agent_name, doc_type, doc_date, content)
VALUES('$agent','$doc_type',$date_sql, \$DOC\$$content\$DOC\$)
ON CONFLICT (agent_name, doc_type, doc_date) DO UPDATE SET content=EXCLUDED.content, updated_at=now();
SQL
)
  _state_pg_psql -c "$q" >/dev/null
}

_state_pg_doc_append() {
  local agent="$1" doc_type="$2" date="${3:-}"
  _state_pg_ensure_agent "$agent"
  local chunk; chunk=$(cat; printf x); chunk="${chunk%x}"
  local date_sql; [[ -n "$date" ]] && date_sql="'$date'" || date_sql="NULL"
  local q
  q=$(cat <<SQL
INSERT INTO braion.agent_documents(agent_name, doc_type, doc_date, content)
VALUES('$agent','$doc_type',$date_sql, \$DOC\$$chunk\$DOC\$)
ON CONFLICT (agent_name, doc_type, doc_date) DO UPDATE
  SET content = braion.agent_documents.content || EXCLUDED.content, updated_at=now();
SQL
)
  _state_pg_psql -c "$q" >/dev/null
}

_state_pg_episodic_append() {
  local agent="$1" json="$2"
  _state_pg_ensure_agent "$agent"
  local q
  q=$(cat <<SQL
WITH input AS (SELECT \$JSON\$$json\$JSON\$::jsonb AS j)
INSERT INTO braion.episodic_memory(agent_name, ts, date, action, context, outcome, importance, payload)
SELECT
  '$agent',
  COALESCE((j->>'timestamp')::timestamptz, now()),
  COALESCE((j->>'date')::date, current_date),
  j->>'action',
  j->>'context',
  j->>'outcome',
  NULLIF(j->>'importance','')::int,
  (j - 'timestamp' - 'date' - 'action' - 'context' - 'outcome' - 'importance')
FROM input;
SQL
)
  _state_pg_psql -c "$q" >/dev/null
}

_state_pg_episodic_search() {
  local agent="$1" pattern="$2" limit="${3:-10}"
  _state_pg_ensure_agent "$agent"
  _state_pg_psql -c "
    SELECT jsonb_build_object(
      'date', to_char(date,'YYYY-MM-DD'),
      'timestamp', to_char(ts AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),
      'action', action, 'context', context, 'outcome', outcome, 'importance', importance
    ) || payload
    FROM braion.episodic_memory
    WHERE agent_name='$agent'
      AND (action ILIKE '%$pattern%' OR context ILIKE '%$pattern%' OR outcome ILIKE '%$pattern%' OR payload::text ILIKE '%$pattern%')
    ORDER BY ts DESC LIMIT $limit;
  "
}

_state_pg_cache_get() {
  local agent="$1" key="$2"
  _state_pg_ensure_agent "$agent"
  # Auto-expira na leitura
  _state_pg_psql -c "DELETE FROM braion.cache_kv WHERE agent_name='$agent' AND key='$key' AND expires_at IS NOT NULL AND expires_at < now();" >/dev/null
  local val
  val=$(_state_pg_psql -c "SELECT value::text FROM braion.cache_kv WHERE agent_name='$agent' AND key='$key';")
  [[ -z "$val" ]] && return 1
  echo "$val"
}

_state_pg_cache_set() {
  local agent="$1" key="$2" value="$3" ttl="${4:-300}"
  _state_pg_ensure_agent "$agent"
  local q
  q=$(cat <<SQL
INSERT INTO braion.cache_kv(agent_name, key, value, expires_at)
VALUES('$agent','$key', \$JSON\$$value\$JSON\$::jsonb, now() + interval '$ttl seconds')
ON CONFLICT (agent_name, key) DO UPDATE
  SET value=EXCLUDED.value, expires_at=EXCLUDED.expires_at;
SQL
)
  _state_pg_psql -c "$q" >/dev/null
}

_state_pg_cache_clear() {
  local agent="$1" key="${2:-}"
  _state_pg_ensure_agent "$agent"
  if [[ -n "$key" ]]; then
    _state_pg_psql -c "DELETE FROM braion.cache_kv WHERE agent_name='$agent' AND key='$key';" >/dev/null
  else
    _state_pg_psql -c "DELETE FROM braion.cache_kv WHERE agent_name='$agent';" >/dev/null
  fi
}

_state_pg_shared_kv_get() {
  local key="$1"
  local val
  val=$(_state_pg_psql -c "SELECT value::text FROM braion.shared_kv WHERE key='$key';")
  [[ -z "$val" ]] && echo 'null' || echo "$val"
}

_state_pg_shared_kv_set() {
  local key="$1" value="$2"
  local q
  q=$(cat <<SQL
INSERT INTO braion.shared_kv(key, value) VALUES('$key', \$JSON\$$value\$JSON\$::jsonb)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();
SQL
)
  _state_pg_psql -c "$q" >/dev/null
}

_state_pg_log_write() {
  local agent="$1" json="$2"
  local q
  q=$(cat <<SQL
WITH input AS (SELECT \$JSON\$$json\$JSON\$::jsonb AS j)
INSERT INTO braion.logs(ts, agent_name, action, message, prompt_version, status, metadata)
SELECT
  COALESCE((j->>'timestamp')::timestamptz, now()),
  '$agent',
  j->>'action',
  j->>'message',
  j->>'prompt_version',
  j->>'status',
  COALESCE(j->'metadata','{}'::jsonb)
FROM input;
SQL
)
  _state_pg_psql -c "$q" >/dev/null
}

# Handoffs -------------------------------------------------------------------

_state_pg_handoff_next_id() {
  local date_str; date_str=$(date -u +%Y%m%d)
  local n
  n=$(_state_pg_psql -c "
    SELECT COALESCE(MAX( (regexp_match(id,'^HO-${date_str}-([0-9]+)$'))[1]::int ),0)+1
    FROM braion.handoffs WHERE id LIKE 'HO-${date_str}-%';
  ")
  printf "HO-%s-%03d" "$date_str" "${n:-1}"
}

_state_pg_handoff_create() {
  local id="$1" from="$2" to="$3" expects="$4" reply_to="$5" thread_id="$6" job_id="$7" body="$8"
  _state_pg_ensure_agent "$to"
  local reply_sql; [[ -z "$reply_to" || "$reply_to" == "null" ]] && reply_sql="NULL" || reply_sql="'$reply_to'"
  local thread_sql; [[ -z "$thread_id" ]] && thread_sql="NULL" || thread_sql="'$thread_id'"
  local job_sql; [[ -z "$job_id" ]] && job_sql="NULL" || job_sql="'$job_id'"
  local q
  q=$(cat <<SQL
INSERT INTO braion.handoffs(id, from_agent, to_agent, created_at, status, expects, reply_to, thread_id, job_id, body)
VALUES('$id','$from','$to', now(), 'pending', '$expects', $reply_sql, $thread_sql, $job_sql, \$BODY\$$body\$BODY\$);
SQL
)
  _state_pg_psql -c "$q" >/dev/null
  echo "pg://$id"  # pseudo-path para compat com chamadores que esperam um identificador
}

_state_pg_handoff_read() {
  local id="$1"
  _state_pg_psql -c "
    SELECT '---' || E'\n' ||
           'id: ' || id || E'\n' ||
           'from: ' || from_agent || E'\n' ||
           'to: ' || to_agent || E'\n' ||
           'created: ' || to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') || E'\n' ||
           'status: ' || status || E'\n' ||
           'expects: ' || expects || E'\n' ||
           'reply_to: ' || COALESCE(reply_to,'null') || E'\n' ||
           CASE WHEN thread_id IS NOT NULL THEN 'thread_id: ' || thread_id || E'\n' ELSE '' END ||
           CASE WHEN job_id    IS NOT NULL THEN 'job_id: '    || job_id    || E'\n' ELSE '' END ||
           '---' || E'\n\n' || body
    FROM braion.handoffs WHERE id='$id';
  "
}

_state_pg_handoff_list() {
  local to="$1" status="$2"
  _state_pg_psql -c "SELECT id FROM braion.handoffs WHERE to_agent='$to' AND status='$status' ORDER BY created_at;"
}

_state_pg_handoff_set_status() {
  local id="$1" new_status="$2"
  _state_pg_psql -c "
    UPDATE braion.handoffs SET status='$new_status',
      archived_at = CASE WHEN '$new_status'='archived' THEN now() ELSE archived_at END
    WHERE id='$id';
  " >/dev/null
  echo "pg://$id"
}

_state_pg_handoff_find_thread() {
  local reply_to="$1"
  [[ -z "$reply_to" || "$reply_to" == "null" ]] && return 0
  _state_pg_psql -c "SELECT thread_id FROM braion.handoffs WHERE id='$reply_to' AND thread_id IS NOT NULL;"
}

_state_pg_handoff_thread_history() {
  local thread_id="$1"
  _state_pg_psql -c "
    SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
        || '  ' || from_agent || ' -> ' || to_agent || '  [' || status || ']'
    FROM braion.handoffs WHERE thread_id='$thread_id' ORDER BY created_at;
  "
}

_state_pg_handoff_artifact_dir() {
  # No backend pg, retorna um diretório temporário; o caller deve usar artifact_save.
  local to="$1" id="$2"
  local dir="${TMPDIR:-/tmp}/braion-pg-artifacts/$to/$id"
  mkdir -p "$dir"
  echo "$dir"
}

_state_pg_handoff_artifact_save() {
  local to="$1" id="$2" name="$3"
  local content; content=$(cat; printf x); content="${content%x}"
  local q
  q=$(cat <<SQL
INSERT INTO braion.handoff_artifacts(handoff_id, name, content)
VALUES('$id','$name', \$DOC\$$content\$DOC\$)
ON CONFLICT (handoff_id, name) DO UPDATE SET content=EXCLUDED.content;
SQL
)
  _state_pg_psql -c "$q" >/dev/null
  echo "pg://$id/$name"
}

# Jobs -----------------------------------------------------------------------

_state_pg_job_next_id() {
  local prefix="$1"
  local date_str; date_str=$(date -u +%Y%m%d)
  local n
  case "$prefix" in
    JOB)
      n=$(_state_pg_psql -c "SELECT COALESCE(MAX((regexp_match(id,'^JOB-${date_str}-([0-9]+)$'))[1]::int),0)+1 FROM braion.jobs WHERE id LIKE 'JOB-${date_str}-%';")
      ;;
    THR)
      n=$(_state_pg_psql -c "SELECT COALESCE(MAX((regexp_match(thread_id,'^THR-${date_str}-([0-9]+)$'))[1]::int),0)+1 FROM braion.jobs WHERE thread_id LIKE 'THR-${date_str}-%';")
      ;;
    *) echo "prefix inválido: $prefix" >&2; return 2 ;;
  esac
  printf "%s-%s-%03d" "$prefix" "$date_str" "${n:-1}"
}

_state_pg_job_create() {
  local created_by="$1" description="$2" agents_csv="$3"
  local job_id thread_id
  job_id=$(_state_pg_job_next_id JOB)
  thread_id=$(_state_pg_job_next_id THR)

  local expected_json="[]"
  IFS=',' read -ra ags <<< "$agents_csv"
  for a in "${ags[@]}"; do
    a=$(echo "$a" | xargs)
    expected_json=$(echo "$expected_json" | jq --arg a "$a" '. + [{"agent":$a,"handoff_id":null}]')
  done

  local q
  q=$(cat <<SQL
INSERT INTO braion.jobs(id, thread_id, description, created_by, created_at, status, expected, completed, failed)
VALUES('$job_id','$thread_id', \$DESC\$$description\$DESC\$, '$created_by', now(), 'pending', \$JSON\$$expected_json\$JSON\$::jsonb, '[]'::jsonb, '[]'::jsonb);
SQL
)
  _state_pg_psql -c "$q" >/dev/null
  echo "$job_id"
  echo "$thread_id"
}

_state_pg_job_status() {
  local job_id="$1"
  local row
  row=$(_state_pg_psql -c "
    SELECT jsonb_build_object(
      'id', id, 'thread_id', thread_id, 'description', description,
      'created_by', created_by,
      'created', to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),
      'status', status, 'expected', expected, 'completed', completed, 'failed', failed,
      'result_summary', result_summary
    ) FROM braion.jobs WHERE id='$job_id';
  ")
  [[ -z "$row" ]] && { echo "job_not_found: $job_id" >&2; return 1; }
  echo "$row"
}

_state_pg_job_complete() {
  local job_id="$1" agent="$2" handoff_id="${3:-null}"
  # Single UPDATE: SET expressions all see OLD row, so new lengths are length(old)+1.
  local q
  q=$(cat <<SQL
UPDATE braion.jobs SET
  completed = completed || jsonb_build_array(jsonb_build_object('agent','$agent','handoff_id','$handoff_id','completed_at',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
  status = CASE
    WHEN (jsonb_array_length(completed)+1) = jsonb_array_length(expected) AND jsonb_array_length(failed)=0 THEN 'completed'
    WHEN (jsonb_array_length(completed)+1 + jsonb_array_length(failed)) = jsonb_array_length(expected) THEN 'partial_failure'
    ELSE 'in_progress'
  END
WHERE id='$job_id';
SQL
)
  _state_pg_psql -c "$q" >/dev/null
}

_state_pg_job_fail() {
  local job_id="$1" agent="$2" reason="${3:-unknown}"
  local q
  q=$(cat <<SQL
UPDATE braion.jobs SET
  failed = failed || jsonb_build_array(jsonb_build_object('agent','$agent','reason', \$R\$$reason\$R\$,'failed_at',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
  status = CASE
    WHEN (jsonb_array_length(completed) + jsonb_array_length(failed)+1) = jsonb_array_length(expected)
      THEN CASE WHEN (jsonb_array_length(failed)+1) > 0 THEN 'partial_failure' ELSE 'completed' END
    ELSE 'in_progress'
  END
WHERE id='$job_id';
SQL
)
  _state_pg_psql -c "$q" >/dev/null
}

_state_pg_job_list_pending() {
  _state_pg_psql -c "SELECT id FROM braion.jobs WHERE status IN ('pending','in_progress') ORDER BY created_at;"
}

_state_pg_job_archive() {
  local job_id="$1"
  _state_pg_psql -c "UPDATE braion.jobs SET archived_at=now() WHERE id='$job_id';" >/dev/null
}

# ----------------------------------------------------------------------------
# Dispatch
# ----------------------------------------------------------------------------

_dispatch() {
  local op="$1"; shift
  local backend; backend=$(state_backend)
  "_state_${backend}_${op}" "$@"
}

state_heartbeat_get()   { _dispatch heartbeat_get   "$@"; }
state_heartbeat_set()   { _dispatch heartbeat_set   "$@"; }
state_doc_get()         { _dispatch doc_get         "$@"; }
state_doc_set()         { _dispatch doc_set         "$@"; }
state_doc_append()      { _dispatch doc_append      "$@"; }
state_episodic_append() { _dispatch episodic_append "$@"; }
state_episodic_search() { _dispatch episodic_search "$@"; }
state_cache_get()       { _dispatch cache_get       "$@"; }
state_cache_set()       { _dispatch cache_set       "$@"; }
state_cache_clear()     { _dispatch cache_clear     "$@"; }
state_shared_kv_get()   { _dispatch shared_kv_get   "$@"; }
state_shared_kv_set()   { _dispatch shared_kv_set   "$@"; }
state_log_write()       { _dispatch log_write       "$@"; }

state_handoff_next_id()        { _dispatch handoff_next_id        "$@"; }
state_handoff_create()         { _dispatch handoff_create         "$@"; }
state_handoff_read()           { _dispatch handoff_read           "$@"; }
state_handoff_list()           { _dispatch handoff_list            "$@"; }
state_handoff_set_status()     { _dispatch handoff_set_status     "$@"; }
state_handoff_find_thread()    { _dispatch handoff_find_thread    "$@"; }
state_handoff_thread_history() { _dispatch handoff_thread_history "$@"; }
state_handoff_artifact_dir()   { _dispatch handoff_artifact_dir   "$@"; }
state_handoff_artifact_save()  { _dispatch handoff_artifact_save  "$@"; }

state_job_next_id()       { _dispatch job_next_id       "$@"; }
state_job_create()        { _dispatch job_create        "$@"; }
state_job_status()        { _dispatch job_status        "$@"; }
state_job_complete()      { _dispatch job_complete      "$@"; }
state_job_fail()          { _dispatch job_fail          "$@"; }
state_job_list_pending()  { _dispatch job_list_pending  "$@"; }
state_job_archive()       { _dispatch job_archive       "$@"; }

# CLI entrypoint — permite usar como `lib/state.sh <op> [args...]`
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  cmd="${1:?Uso: state.sh <op> [args...]}"; shift
  "state_$cmd" "$@"
fi
