#!/usr/bin/env bash
# scripts/state_smoke_test.sh — Valida lib/state.sh em ambos backends (file e pg).
#
# Uso:
#   scripts/state_smoke_test.sh file     # default
#   scripts/state_smoke_test.sh pg       # requer PGHOST/etc ou PGSERVICE setados
#   scripts/state_smoke_test.sh both     # roda os dois e compara contagens
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$PROJECT_ROOT/lib/state.sh"

MODE="${1:-file}"

setup_file_backend() {
  export BRAION_STATE_BACKEND=file
  TESTROOT=$(mktemp -d -t braion-smoke-file-XXXXXX)
  export BRAION_AGENTS_DIR="$TESTROOT/agents"
  export BRAION_LOGS_DIR="$TESTROOT/logs"
  mkdir -p "$BRAION_AGENTS_DIR" "$BRAION_LOGS_DIR"
  echo "→ file backend em $TESTROOT"
}

setup_pg_backend() {
  export BRAION_STATE_BACKEND=pg
  # GUARD anti-produção: este setup faz TRUNCATE ... CASCADE, que apaga TODO o
  # schema braion (todas as tabelas referenciam agents via FK ON DELETE CASCADE).
  # Recusa rodar se houver qualquer agente real (não-smoke) — só prossegue contra
  # um schema descartável, ou com BRAION_SMOKE_ALLOW_PROD=1 explícito.
  if [[ "${BRAION_SMOKE_ALLOW_PROD:-}" != "1" ]]; then
    local real_agents
    real_agents=$(psql -qAtX -c "SELECT count(*) FROM braion.agents WHERE name NOT LIKE 'smoke-%';" 2>/dev/null || echo 0)
    if [[ "${real_agents:-0}" -gt 0 ]]; then
      echo "ABORT: schema braion tem ${real_agents} agente(s) de produção — o smoke pg faz" >&2
      echo "       TRUNCATE CASCADE e apagaria tudo. Use um banco descartável ou, se tiver" >&2
      echo "       absoluta certeza, rode com BRAION_SMOKE_ALLOW_PROD=1." >&2
      exit 3
    fi
  fi
  # Limpa tabelas se possível (não falha se schema não existir)
  psql -qAtX -c "SET search_path TO braion; TRUNCATE braion.agents, braion.shared_kv, braion.logs, braion.jobs RESTART IDENTITY CASCADE;" >/dev/null 2>&1 || true
  echo "→ pg backend (PGHOST=${PGHOST:-?} db=${PGDATABASE:-?})"
}

cleanup_file_backend() {
  [[ -n "${TESTROOT:-}" && -d "$TESTROOT" ]] && rm -rf "$TESTROOT"
}

assert_eq() {
  local want="$1" got="$2" msg="$3"
  if [[ "$want" == "$got" ]]; then
    echo "  ✓ $msg"
  else
    echo "  ✗ $msg" >&2
    echo "    want: $want" >&2
    echo "    got:  $got"  >&2
    exit 1
  fi
}

run_suite() {
  local backend="$1"
  local agent="smoke-$$"

  echo ""
  echo "═══ Suite: $backend ═══"

  # heartbeat
  bash "$STATE" heartbeat_set "$agent" "{\"last_ping\":\"2026-05-19T10:00:00Z\",\"agent\":\"$agent\",\"status\":\"idle\"}"
  hb=$(bash "$STATE" heartbeat_get "$agent")
  assert_eq "idle" "$(echo "$hb" | jq -r '.status')" "heartbeat status"

  # doc daily
  echo "# Obj" | bash "$STATE" doc_set "$agent" current_objective 2026-05-19
  txt=$(bash "$STATE" doc_get "$agent" current_objective 2026-05-19)
  assert_eq "# Obj" "$(echo "$txt" | head -1)" "doc_get current_objective"

  # doc append
  printf "linha 1\n"  | bash "$STATE" doc_append "$agent" decisions 2026-05-19
  printf "linha 2\n"  | bash "$STATE" doc_append "$agent" decisions 2026-05-19
  dec=$(bash "$STATE" doc_get "$agent" decisions 2026-05-19)
  assert_eq "2" "$(echo "$dec" | grep -c '^linha')" "doc_append 2 linhas"

  # episodic
  bash "$STATE" episodic_append "$agent" '{"date":"2026-05-19","timestamp":"2026-05-19T10:00:00Z","action":"init","context":"ctx1","outcome":"ok","importance":1}'
  bash "$STATE" episodic_append "$agent" '{"date":"2026-05-19","timestamp":"2026-05-19T10:00:01Z","action":"work","context":"ctx2","outcome":"ok","importance":2}'
  found=$(bash "$STATE" episodic_search "$agent" ctx 10 | wc -l | xargs)
  assert_eq "2" "$found" "episodic_search retorna 2"

  # cache
  bash "$STATE" cache_set "$agent" foo '{"v":42}' 60
  v=$(bash "$STATE" cache_get "$agent" foo | jq -c '.')
  assert_eq '{"v":42}' "$v" "cache_get após set"

  # shared kv
  bash "$STATE" shared_kv_set "smoke_${agent}_key" '{"a":1}'
  s=$(bash "$STATE" shared_kv_get "smoke_${agent}_key" | jq -c '.')
  assert_eq '{"a":1}' "$s" "shared_kv round-trip"

  # log
  bash "$STATE" log_write "$agent" "{\"timestamp\":\"2026-05-19T10:00:00Z\",\"agent\":\"$agent\",\"action\":\"init\",\"message\":\"ok\",\"metadata\":{},\"prompt_version\":\"0.5.0\",\"status\":\"success\"}"

  # handoff
  ho=$(bash "$STATE" handoff_next_id)
  bash "$STATE" handoff_create "$ho" sender "$agent" action null "" "" "## Descricao
teste" >/dev/null
  n=$(bash "$STATE" handoff_list "$agent" pending | wc -l | xargs)
  assert_eq "1" "$n" "handoff aparece em pending"
  bash "$STATE" handoff_set_status "$ho" in_progress >/dev/null
  bash "$STATE" handoff_set_status "$ho" archived   >/dev/null
  n2=$(bash "$STATE" handoff_list "$agent" archived | wc -l | xargs)
  assert_eq "1" "$n2" "handoff transitou para archived"

  # job
  out=$(bash "$STATE" job_create user "fazer X" "$agent")
  job=$(echo "$out" | head -1)
  bash "$STATE" job_complete "$job" "$agent" "$ho"
  st=$(bash "$STATE" job_status "$job" | jq -r '.status')
  assert_eq "completed" "$st" "job completa com todos expected"

  echo "  ✓ todos os asserts passaram em $backend"
}

case "$MODE" in
  file)
    setup_file_backend
    trap cleanup_file_backend EXIT
    run_suite file
    ;;
  pg)
    setup_pg_backend
    run_suite pg
    ;;
  both)
    setup_file_backend
    trap cleanup_file_backend EXIT
    run_suite file
    setup_pg_backend
    run_suite pg
    ;;
  *) echo "uso: $0 {file|pg|both}" >&2; exit 2 ;;
esac
