# Concurrent Agent Collaboration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable agents to work in parallel via orchestrator fan-out/fan-in, and collaborate peer-to-peer while keeping sessions alive to preserve context.

**Architecture:** Job tracker in `shared/jobs/` groups parallel handoffs under a job ID. Agents enter `waiting` heartbeat state instead of terminating when awaiting replies. The cron injects reply paths into active tmux sessions. A new orchestrator agent coordinates fan-out/fan-in and handles escalations.

**Tech Stack:** Bash (job.sh, handoff.sh, agent-cron.sh), YAML/JSON config, tmux sessions, jq

**Spec:** `docs/superpowers/specs/2026-04-08-concurrent-agent-collaboration-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `lib/job.sh` | Job lifecycle: create, complete, fail, status, list-pending, archive |
| Create | `agents/orchestrator/config.yaml` | Orchestrator agent configuration |
| Create | `agents/orchestrator/IDENTITY.md` | Orchestrator identity and operating modes |
| Create | `agents/orchestrator/state/current_objective.md` | Initial state |
| Create | `agents/orchestrator/state/decisions.md` | Decision log |
| Create | `agents/orchestrator/state/completed_tasks.md` | Task log |
| Create | `agents/orchestrator/memory/semantic.md` | Semantic memory |
| Create | `shared/jobs/.gitkeep` | Jobs directory |
| Create | `shared/jobs/archive/.gitkeep` | Archived jobs directory |
| Modify | `lib/handoff.sh:37-100` | Add `job_id` param to send + new `job-agent` command |
| Modify | `lib/agent-cron.sh:86-103` | Handle `waiting` state in stale detection + job failure |
| Modify | `lib/agent-cron.sh:380-442` | Inject replies into waiting sessions + fan-in logic |
| Modify | `commands/braion/agent-wrapup.md:63-72` | Auto-detect job_id and call job.sh complete |
| Modify | `commands/braion/agent-handoff.md:64-84` | Support waiting mode for peer-to-peer/orchestrate |
| Modify | `AGENTS.md:166-214` | Document jobs, orchestrate expects, waiting state |

---

### Task 1: Create `shared/jobs/` directories

**Files:**
- Create: `agents/shared/jobs/.gitkeep`
- Create: `agents/shared/jobs/archive/.gitkeep`

- [ ] **Step 1: Create directories**

```bash
mkdir -p agents/shared/jobs/archive
touch agents/shared/jobs/.gitkeep
touch agents/shared/jobs/archive/.gitkeep
```

- [ ] **Step 2: Verify**

Run: `ls -la agents/shared/jobs/`
Expected: `.gitkeep` and `archive/` directory

- [ ] **Step 3: Commit**

```bash
git add agents/shared/jobs/.gitkeep agents/shared/jobs/archive/.gitkeep
git commit -m "feat: add shared/jobs/ directory for job tracking"
```

---

### Task 2: Create `lib/job.sh`

**Files:**
- Create: `lib/job.sh`

- [ ] **Step 1: Write the test script**

Create `tests/test_job.sh` to validate job lifecycle:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
JOBS_DIR="$PROJECT_ROOT/agents/shared/jobs"
TEST_JOBS_DIR=$(mktemp -d)
PASS=0; FAIL=0

cleanup() { rm -rf "$TEST_JOBS_DIR"; }
trap cleanup EXIT

export JOBS_DIR="$TEST_JOBS_DIR"
JOB_SH="$PROJECT_ROOT/lib/job.sh"

assert_eq() {
  local label=$1 expected=$2 actual=$3
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $label"; PASS=$((PASS + 1))
  else
    echo "FAIL: $label — expected '$expected', got '$actual'"; FAIL=$((FAIL + 1))
  fi
}

# Test 1: create
echo "--- Test: create ---"
output=$(bash "$JOB_SH" create orchestrator "Test job" "agent-a,agent-b")
job_id=$(echo "$output" | head -1)
thread_id=$(echo "$output" | tail -1)
assert_eq "create returns JOB ID" "JOB-" "$(echo "$job_id" | cut -c1-4)"
assert_eq "create returns THR ID" "THR-" "$(echo "$thread_id" | cut -c1-4)"

job_file="$TEST_JOBS_DIR/${job_id}.json"
assert_eq "job file exists" "true" "$([ -f "$job_file" ] && echo true || echo false)"
assert_eq "status is pending" "pending" "$(jq -r '.status' "$job_file")"
assert_eq "expected has 2 agents" "2" "$(jq '.expected | length' "$job_file")"

# Test 2: complete one agent
echo "--- Test: complete one ---"
bash "$JOB_SH" complete "$job_id" "agent-a"
assert_eq "status is in_progress" "in_progress" "$(jq -r '.status' "$job_file")"
assert_eq "completed has 1" "1" "$(jq '.completed | length' "$job_file")"

# Test 3: complete second agent
echo "--- Test: complete all ---"
bash "$JOB_SH" complete "$job_id" "agent-b"
assert_eq "status is completed" "completed" "$(jq -r '.status' "$job_file")"
assert_eq "completed has 2" "2" "$(jq '.completed | length' "$job_file")"

# Test 4: fail
echo "--- Test: fail ---"
output2=$(bash "$JOB_SH" create orchestrator "Fail job" "agent-x,agent-y")
job_id2=$(echo "$output2" | head -1)
job_file2="$TEST_JOBS_DIR/${job_id2}.json"
bash "$JOB_SH" complete "$job_id2" "agent-x"
bash "$JOB_SH" fail "$job_id2" "agent-y" "stale_session_killed"
assert_eq "status is partial_failure" "partial_failure" "$(jq -r '.status' "$job_file2")"

# Test 5: list-pending
echo "--- Test: list-pending ---"
output3=$(bash "$JOB_SH" create orchestrator "Pending job" "agent-z")
job_id3=$(echo "$output3" | head -1)
pending=$(bash "$JOB_SH" list-pending)
echo "$pending" | grep -q "$job_id3"
assert_eq "list-pending includes pending job" "0" "$?"

# Test 6: status
echo "--- Test: status ---"
status_out=$(bash "$JOB_SH" status "$job_id")
echo "$status_out" | jq -e '.id' > /dev/null
assert_eq "status returns valid JSON" "0" "$?"

# Test 7: archive
echo "--- Test: archive ---"
bash "$JOB_SH" archive "$job_id"
assert_eq "job file removed from jobs/" "false" "$([ -f "$job_file" ] && echo true || echo false)"
assert_eq "job file in archive/" "true" "$([ -f "$TEST_JOBS_DIR/archive/${job_id}.json" ] && echo true || echo false)"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/test_job.sh`
Expected: FAIL — `lib/job.sh` does not exist yet

- [ ] **Step 3: Write `lib/job.sh`**

```bash
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

  bash "$LOCK_SH" acquire "$created_by" jobs > /dev/null 2>&1 || true

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

  bash "$LOCK_SH" release "$created_by" jobs > /dev/null 2>&1 || true

  echo "$job_id"
  echo "$thread_id"
}

job_complete() {
  local job_id="${1:?Uso: job.sh complete <job_id> <agent> [handoff_id]}"
  local agent="${2:?Uso: job.sh complete <job_id> <agent>}"
  local handoff_id="${3:-null}"
  local job_file="$JOBS_DIR/${job_id}.json"

  [ -f "$job_file" ] || { echo "job_not_found: $job_id" >&2; return 1; }

  bash "$LOCK_SH" acquire "$agent" jobs > /dev/null 2>&1 || true

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

  bash "$LOCK_SH" release "$agent" jobs > /dev/null 2>&1 || true
}

job_fail() {
  local job_id="${1:?Uso: job.sh fail <job_id> <agent> [reason]}"
  local agent="${2:?Uso: job.sh fail <job_id> <agent>}"
  local reason="${3:-unknown}"
  local job_file="$JOBS_DIR/${job_id}.json"

  [ -f "$job_file" ] || { echo "job_not_found: $job_id" >&2; return 1; }

  bash "$LOCK_SH" acquire "$agent" jobs > /dev/null 2>&1 || true

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

  bash "$LOCK_SH" release "$agent" jobs > /dev/null 2>&1 || true
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash tests/test_job.sh`
Expected: All PASS, 0 failed

- [ ] **Step 5: Commit**

```bash
git add lib/job.sh tests/test_job.sh
git commit -m "feat: add lib/job.sh for parallel job tracking"
```

---

### Task 3: Add `job_id` support to `lib/handoff.sh`

**Files:**
- Modify: `lib/handoff.sh:4-6` (usage comment)
- Modify: `lib/handoff.sh:37-99` (send function — add job_id param)
- Modify: `lib/handoff.sh:190-201` (case dispatch — add job-agent command)

- [ ] **Step 1: Update usage comment**

In `lib/handoff.sh`, replace lines 4-6:

```bash
# lib/handoff.sh — Helper para handoffs entre agentes
# Uso:
#   handoff.sh send <from> <to> <expects> [reply_to] [descricao] [contexto] [esperado] [thread_id] [job_id]
#   handoff.sh list <agent>
#   handoff.sh claim <agent> <handoff_file>
#   handoff.sh archive <agent> <handoff_file>
#   handoff.sh next_id
#   handoff.sh thread-history <thread_id>
#   handoff.sh job-agent <handoff_file>
```

- [ ] **Step 2: Add `job_id` parameter to `handoff_send`**

In `handoff_send()`, after line 45 (`local thread_id="${8:-}"`), add:

```bash
  local job_id="${9:-}"
```

In the heredoc (lines 74-94), after the thread_id line (line 83), add the job_id line:

```bash
$([ -n "$job_id" ] && echo "job_id: $job_id")
```

In the logger call (line 98-99), add job_id to metadata:

```bash
  AGENT_NAME="$from" bash "$SCRIPT_DIR/logger.sh" handoff_sent "Handoff $ho_id enviado para $to" \
    "{\"handoff_id\":\"$ho_id\",\"to\":\"$to\",\"expects\":\"$expects\",\"reply_to\":\"$reply_to\",\"thread_id\":\"$thread_id\",\"job_id\":\"$job_id\"}" 2>/dev/null || true
```

- [ ] **Step 3: Add `job-agent` command**

Before the final `case` statement (line 190), add:

```bash
handoff_job_agent() {
  local handoff_file="${1:?Uso: handoff.sh job-agent <handoff_file>}"
  [ -f "$handoff_file" ] || return 0
  grep '^job_id:' "$handoff_file" 2>/dev/null | sed 's/job_id: //' | xargs
}
```

Add to the case dispatch:

```bash
  job-agent)       handoff_job_agent "$@" ;;
```

- [ ] **Step 4: Test manually**

Run: `bash lib/handoff.sh send test-from test-to action null "test desc" "test ctx" "test exp" "" "JOB-TEST-001"`
Expected: Creates handoff file. Verify with:
Run: `cat agents/test-to/handoffs/inbox/HO-*.md | grep job_id`
Expected: `job_id: JOB-TEST-001`

Clean up: `rm -rf agents/test-to`

- [ ] **Step 5: Commit**

```bash
git add lib/handoff.sh
git commit -m "feat: add job_id support to handoff.sh send + job-agent command"
```

---

### Task 4: Create orchestrator agent

**Files:**
- Create: `agents/orchestrator/config.yaml`
- Create: `agents/orchestrator/IDENTITY.md`
- Create: `agents/orchestrator/state/current_objective.md`
- Create: `agents/orchestrator/state/decisions.md`
- Create: `agents/orchestrator/state/completed_tasks.md`
- Create: `agents/orchestrator/memory/semantic.md`
- Create: `agents/orchestrator/handoffs/inbox/.gitkeep`
- Create: `agents/orchestrator/handoffs/in_progress/.gitkeep`
- Create: `agents/orchestrator/handoffs/done/.gitkeep`
- Create: `agents/orchestrator/handoffs/artifacts/.gitkeep`
- Create: `agents/orchestrator/handoffs/archive/.gitkeep`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p agents/orchestrator/{state,memory,handoffs/{inbox,in_progress,done,artifacts,archive}}
```

- [ ] **Step 2: Write `config.yaml`**

```yaml
name: orchestrator
display_name: Orchestrator
domain: orquestração, coordenação, decomposição, multi-agente, fan-out, fan-in
version: "1.0"

model: claude-sonnet-4-6
fallback_model: claude-haiku-4-5

schedule:
  mode: handoff-only
  priority: 0
  run_alone: false

budget:
  max_tokens_per_session: 150000
  max_sessions_per_day: 20

integrations:
  telegram:
    enabled: true
  notion:
    enabled: false
  obsidian:
    enabled: false
```

- [ ] **Step 3: Write `IDENTITY.md`**

```markdown
# Orchestrator

Agente de coordenação do ecossistema br-ai-on. Decompõe objetivos complexos em sub-tarefas e distribui para agentes especializados.

## Modos de Operação

### 1. Fan-out (criar job)

Quando recebe um objetivo (via handoff manual, Telegram, ou escalation):

1. Ler todos os `agents/*/config.yaml` para construir mapa de domínios
2. Decompor o objetivo em sub-tarefas atômicas
3. Criar job: `bash lib/job.sh create orchestrator "<descrição>" "<agent1,agent2,...>"`
4. Capturar JOB_ID e THREAD_ID do stdout
5. Para cada agente, enviar handoff:
   ```bash
   bash lib/handoff.sh send orchestrator <agente> action null \
     "<descrição da sub-tarefa>" \
     "<contexto necessário — apenas instrução + artefatos, nunca histórico completo>" \
     "<resultado esperado>" \
     "<THREAD_ID>" "<JOB_ID>"
   ```
6. Atualizar heartbeat para waiting:
   ```bash
   jq -nc --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg job "<JOB_ID>" \
     '{last_ping: $ts, agent: "orchestrator", status: "waiting", waiting_for: $job, waiting_since: $ts}' \
     > agents/orchestrator/state/heartbeat.json
   ```
7. Aguardar na sessão — o cron injetará o path dos replies quando o job completar

### 2. Fan-in (consolidar)

Quando o cron injeta reply paths na sessão ativa:

1. Ler cada handoff de reply
2. Verificar status do job: `bash lib/job.sh status <JOB_ID>`
3. Se `completed`: consolidar todos os resultados em um resumo
4. Se `partial_failure`: consolidar o que tem, reportar falhas
5. Notificar usuário via handoff `to: user` ou Telegram
6. Arquivar o job: `bash lib/job.sh archive <JOB_ID>`
7. Fazer wrapup normal

### 3. Escalation (recebe pedido de ajuda)

Quando um agente envia handoff com `expects: orchestrate`:

1. Ler o handoff de escalation
2. Analisar o pedido — qual(is) agente(s) são necessários?
3. Criar job e distribuir (mesmo fluxo do fan-out)
4. Quando consolidar, enviar reply para o agente remetente (reply_to do handoff original)

## Regras

- NUNCA repassar histórico completo da sessão nos handoffs — apenas instrução + artefatos
- Priorizar decomposição em tarefas independentes (paralelizáveis)
- Se uma tarefa depende de outra, criar dois jobs sequenciais ou usar pipeline
- Ao consolidar, focar no resultado prático — não repetir o que cada agente disse verbatim
```

- [ ] **Step 4: Write initial state files**

`agents/orchestrator/state/current_objective.md`:
```markdown
Aguardando primeiro objetivo. Modos: fan-out, fan-in, escalation.
```

`agents/orchestrator/state/decisions.md`:
```markdown
# Decisões do Orchestrator
```

`agents/orchestrator/state/completed_tasks.md`:
```markdown
# Tarefas Concluídas
```

`agents/orchestrator/memory/semantic.md`:
```markdown
# Memória Semântica — Orchestrator

## Mapa de Domínios
(Construído dinamicamente a cada sessão lendo agents/*/config.yaml)

## Padrões Observados
(Atualizado conforme experiência de orquestração)
```

- [ ] **Step 5: Add gitkeeps**

```bash
touch agents/orchestrator/handoffs/{inbox,in_progress,done,artifacts,archive}/.gitkeep
```

- [ ] **Step 6: Commit**

```bash
git add agents/orchestrator/
git commit -m "feat: add orchestrator agent for parallel job coordination"
```

---

### Task 5: Update `agent-cron.sh` — waiting state + reply injection

**Files:**
- Modify: `lib/agent-cron.sh:28` (add WAITING_TIMEOUT var)
- Modify: `lib/agent-cron.sh:73-83` (session_is_stale — respect waiting)
- Modify: `lib/agent-cron.sh:86-103` (kill_stale_session — handle job failure)
- Modify: `lib/agent-cron.sh:380-442` (handoff processing — inject into waiting sessions)

- [ ] **Step 1: Add WAITING_TIMEOUT variable**

After line 28 (`STALE_THRESHOLD=${STALE_THRESHOLD:-900}`), add:

```bash
WAITING_TIMEOUT=${WAITING_TIMEOUT:-1800}
```

- [ ] **Step 2: Add `heartbeat_is_waiting` helper**

After the `heartbeat_is_processing` function (after line 123), add:

```bash
heartbeat_is_waiting() {
  local heartbeat_file=$1
  [ -f "$heartbeat_file" ] || return 1
  local status
  status=$(jq -r '.status // ""' "$heartbeat_file" 2>/dev/null || echo "")
  [ "$status" = "waiting" ]
}

heartbeat_waiting_expired() {
  local heartbeat_file=$1
  [ -f "$heartbeat_file" ] || return 0
  local waiting_since now elapsed
  waiting_since=$(jq -r '.waiting_since // ""' "$heartbeat_file" 2>/dev/null || echo "")
  [ -z "$waiting_since" ] && return 0
  now=$(date -u +%s)
  elapsed=$(( now - $(date -u -d "$waiting_since" +%s 2>/dev/null || echo 0) ))
  [ "$elapsed" -gt "$WAITING_TIMEOUT" ]
}
```

- [ ] **Step 3: Update `kill_stale_session` to respect waiting state**

Replace the `kill_stale_session` function (lines 86-103) with:

```bash
kill_stale_session() {
  local session=$1
  if session_is_idle "$session"; then
    log "KILL $session — claude em prompt idle, sessão concluída"
    session_clear_idle "$session"
    tmux kill-session -t "$session" 2>/dev/null
    return 0
  fi

  local agent_name
  agent_name=$(echo "$session" | sed 's/^braion-//' | sed 's/-HO-.*//')
  local heartbeat="$BRAION/agents/${agent_name}/state/heartbeat.json"

  if heartbeat_is_waiting "$heartbeat"; then
    if heartbeat_waiting_expired "$heartbeat"; then
      log "KILL $session — waiting timeout expirado (> ${WAITING_TIMEOUT}s)"
      local waiting_for
      waiting_for=$(jq -r '.waiting_for // ""' "$heartbeat" 2>/dev/null || echo "")
      if [[ "$waiting_for" == JOB-* ]]; then
        bash "$BRAION/lib/job.sh" fail "$waiting_for" "$agent_name" "waiting_timeout" 2>/dev/null || true
        log "JOB $waiting_for — $agent_name marcado como falha (timeout)"
      fi
      tmux kill-session -t "$session" 2>/dev/null
      return 0
    fi
    return 1
  fi

  if session_is_stale "$session"; then
    local activity elapsed
    activity=$(tmux display-message -t "$session" -p '#{window_activity}' 2>/dev/null || echo 0)
    elapsed=$(( $(date -u +%s) - activity ))
    log "KILL $session — sem atividade há ${elapsed}s (> ${STALE_THRESHOLD}s)"
    tmux kill-session -t "$session" 2>/dev/null
    return 0
  fi
  return 1
}
```

- [ ] **Step 4: Update handoff processing loop to inject into waiting sessions**

In the handoff processing section (starting at line 381, the `for config` loop), replace the block starting at line 392 (`for handoff_file in "$inbox_dir"/HO-*.md; do`) through the end of the inner for loop (line 441) with:

```bash
  for handoff_file in "$inbox_dir"/HO-*.md; do
    [ -f "$handoff_file" ] || continue

    filename=$(basename "$handoff_file")
    ho_id=$(echo "$filename" | sed -n 's/\(HO-[0-9]*-[0-9]*\)_.*/\1/p')

    expects=$(awk '/^expects:/{print $2}' "$handoff_file" 2>/dev/null || echo "")
    to=$(awk '/^to:/{print $2}' "$handoff_file" 2>/dev/null || echo "")
    job_id=$(awk '/^job_id:/{print $2}' "$handoff_file" 2>/dev/null || echo "")

    # Handoffs para o usuário: arquiva e envia ao braion-telegram para comunicar
    if [ "$to" = "user" ]; then
      log "Handoff $ho_id → user: arquivando e notificando via telegram"
      mkdir -p "$agent_dir/handoffs/archive"
      mv "$handoff_file" "$agent_dir/handoffs/archive/$filename"
      notify_user_handoff "$agent_dir/handoffs/archive/$filename"
      continue
    fi

    # Handoffs expects:info que NÃO são reply de job — arquiva sem iniciar sessão
    if [ "$expects" = "info" ] && [ -z "$job_id" ]; then
      # Checar se é reply para sessão waiting
      local heartbeat="$agent_dir/state/heartbeat.json"
      if session_running "braion-${agent}" && heartbeat_is_waiting "$heartbeat"; then
        log "Handoff $ho_id → injetando em sessão waiting braion-${agent}"
        bash "$BRAION/lib/handoff.sh" claim "$agent" "$handoff_file" > /dev/null 2>&1
        tmux send-keys -t "braion-${agent}" "/braion:agent-inbox-router ${handoff_file}" Enter
        continue
      fi
      log "Handoff $ho_id expects:info — arquivando sem sessão"
      mkdir -p "$agent_dir/handoffs/archive"
      mv "$handoff_file" "$agent_dir/handoffs/archive/$filename"
      continue
    fi

    # Reply de job — checar se job completou antes de acordar
    if [ -n "$job_id" ]; then
      local heartbeat="$agent_dir/state/heartbeat.json"

      # Se sessão ativa e waiting — injetar reply
      if session_running "braion-${agent}" && heartbeat_is_waiting "$heartbeat"; then
        local job_status_val
        job_status_val=$(bash "$BRAION/lib/job.sh" status "$job_id" 2>/dev/null | jq -r '.status' 2>/dev/null || echo "unknown")
        if [ "$job_status_val" = "completed" ] || [ "$job_status_val" = "partial_failure" ]; then
          log "JOB $job_id $job_status_val — injetando replies em braion-${agent}"
          # Injetar todos os replies pendentes deste job
          for reply_file in "$inbox_dir"/HO-*.md; do
            [ -f "$reply_file" ] || continue
            local reply_job
            reply_job=$(awk '/^job_id:/{print $2}' "$reply_file" 2>/dev/null || echo "")
            if [ "$reply_job" = "$job_id" ]; then
              local claimed_path
              claimed_path=$(bash "$BRAION/lib/handoff.sh" claim "$agent" "$reply_file" 2>/dev/null || echo "")
              tmux send-keys -t "braion-${agent}" "/braion:agent-inbox-router ${claimed_path}" Enter
              sleep 2
            fi
          done
          continue
        fi
        log "JOB $job_id still $job_status_val — aguardando mais replies para $agent"
        continue
      fi

      # Se sessão NÃO ativa e job completo — iniciar normalmente
      local job_status_val
      job_status_val=$(bash "$BRAION/lib/job.sh" status "$job_id" 2>/dev/null | jq -r '.status' 2>/dev/null || echo "unknown")
      if [ "$job_status_val" != "completed" ] && [ "$job_status_val" != "partial_failure" ]; then
        log "JOB $job_id still $job_status_val — aguardando mais replies"
        continue
      fi
    fi

    session="braion-${agent}-${ho_id}"

    if session_running "$session"; then
      kill_stale_session "$session" || { log "SKIP $session — sessão ativa"; continue; }
    fi

    # Se o agente tem sessão alive ativa, aguarda ela terminar para evitar escrita concorrente em state/
    if session_running "braion-${agent}"; then
      kill_stale_session "braion-${agent}" || { log "SKIP $session — sessão alive braion-${agent} ativa, handoff será processado no próximo ciclo"; continue; }
    fi

    log "Handoff: iniciando $session para $handoff_file"

    prompt="Read $BRAION/commands/braion/agent-handoff.md and follow the instructions exactly. Agent: $agent. Handoff: $handoff_file. BR.AI.ON base: $BRAION. Working directory: $working_dir."
    agent_model=$(get_agent_model "$config")
    agent_cmd=$(get_agent_command "$config")

    start_session "$session" "$working_dir" "$prompt" "${agent_model:-$DEFAULT_MODEL}" "$agent_cmd"
  done
```

- [ ] **Step 5: Test manually**

Run: `bash -n lib/agent-cron.sh`
Expected: No syntax errors (exit 0)

- [ ] **Step 6: Commit**

```bash
git add lib/agent-cron.sh
git commit -m "feat: add waiting state support and job fan-in to agent-cron"
```

---

### Task 6: Update `agent-handoff.md` — support waiting mode

**Files:**
- Modify: `commands/braion/agent-handoff.md:64-84` (add waiting mode instructions)

- [ ] **Step 1: Add waiting mode section**

After section `3e` (the response/notify section, after line 84), add a new section:

```markdown
**g) Modo Waiting (peer-to-peer ou escalation)**

Se durante o processamento você precisar de informação de outro agente:

**Consulta simples (expects=info)** — envie peer-to-peer direto:
```bash
bash "$BRAION/lib/handoff.sh" send "$AGENT" "<agente_destino>" info null \
  "<pergunta>" "<contexto>" "<o que precisa>"
```

**Coordenação complexa (expects=orchestrate)** — escale para o orchestrator:
```bash
bash "$BRAION/lib/handoff.sh" send "$AGENT" orchestrator orchestrate null \
  "[escalation] <descrição>" "<contexto>" "<resultado esperado>"
```

Após enviar o handoff, entre em modo waiting:
```bash
jq -nc --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg a "$AGENT" --arg ho "<HO_ID_enviado>" \
  '{last_ping: $ts, agent: $a, status: "waiting", waiting_for: $ho, waiting_since: $ts}' \
  > "$BRAION/agents/$AGENT/state/heartbeat.json"
```

**NÃO faça wrapup nem mate a sessão.** Aguarde na sessão — o cron injetará o path do reply quando chegar. Ao receber o reply, leia o handoff e continue o processamento normalmente.

> O timeout de waiting é de 30 minutos (configurável via WAITING_TIMEOUT). Se expirar, o cron mata a sessão.
```

- [ ] **Step 2: Commit**

```bash
git add commands/braion/agent-handoff.md
git commit -m "feat: add waiting mode to agent-handoff for peer-to-peer collaboration"
```

---

### Task 7: Update `agent-wrapup.md` — auto-detect job completion

**Files:**
- Modify: `commands/braion/agent-wrapup.md:63-72` (add job completion step after archiving)

- [ ] **Step 1: Add job completion step**

After section 4 (Arquivar Handoffs Processados, line 72), add:

```markdown
## 4b. Marcar Job como Completo (se aplicável)

Se o handoff processado pertencia a um job, marque o agente como completo:

```bash
for ho_file in "$BRAION/agents/<nome>/handoffs/in_progress/"HO-*.md "$BRAION/agents/<nome>/handoffs/archive/"HO-*.md; do
  [ -f "$ho_file" ] || continue
  job_id=$(bash "$BRAION/lib/handoff.sh" job-agent "$ho_file")
  if [ -n "$job_id" ]; then
    bash "$BRAION/lib/job.sh" complete "$job_id" "<nome>"
    break
  fi
done
```

Isso é automático — você não precisa saber se estava num job. O wrapup detecta e marca.
```

- [ ] **Step 2: Commit**

```bash
git add commands/braion/agent-wrapup.md
git commit -m "feat: auto-detect job completion in agent-wrapup"
```

---

### Task 8: Update `AGENTS.md` — document new collaboration features

**Files:**
- Modify: `AGENTS.md:166-214` (add jobs, orchestrate, waiting sections)

- [ ] **Step 1: Add Job Tracking section**

After the Handoffs Peer-to-Peer section (after line 214), add:

```markdown
## Jobs — Trabalho Paralelo

### Conceito

Um **job** agrupa múltiplos handoffs sob um mesmo objetivo. O orchestrator cria jobs para fan-out paralelo; o cron monitora conclusão para fan-in.

### Estrutura

```
agents/shared/jobs/JOB-YYYYMMDD-NNN.json
agents/shared/jobs/archive/
```

### API

```bash
bash lib/job.sh create <created_by> <description> <agent1,agent2,...>
bash lib/job.sh complete <job_id> <agent> [handoff_id]
bash lib/job.sh fail <job_id> <agent> [reason]
bash lib/job.sh status <job_id>
bash lib/job.sh list-pending
bash lib/job.sh archive <job_id>
```

### Ciclo de Vida

`pending → in_progress → completed | partial_failure`

### Integração

Handoffs de job incluem `job_id` no frontmatter. O `agent-wrapup` detecta automaticamente e chama `job.sh complete`.

## Colaboração entre Agentes

### expects: orchestrate

Novo valor de `expects` para escalar ao orchestrator:

| expects | Significado | Processado por |
|---|---|---|
| `action` | Executa tarefa | Agente destino |
| `review` | Revisa e opina | Agente destino |
| `info` | Notificação unidirecional | Cron arquiva |
| `orchestrate` | Decomponha e coordene | Orchestrator |

### Modo Waiting

Quando um agente envia handoff e precisa da resposta para continuar, ele entra em `waiting`:

```json
{"status": "waiting", "waiting_for": "HO-xxx", "waiting_since": "..."}
```

O cron respeita sessões em `waiting` com timeout maior (`WAITING_TIMEOUT`, default 1800s). Quando o reply chega, o cron injeta o path na sessão ativa:

```bash
tmux send-keys -t "braion-<agent>" "/braion:agent-inbox-router <path>" Enter
```

### Peer-to-Peer vs Orchestrator

- **Consulta simples** (info de outro domínio): envie `expects=info` direto para o agente
- **Coordenação complexa** (múltiplos agentes): envie `expects=orchestrate` para o orchestrator
```

- [ ] **Step 2: Update heartbeat status values in the file structure section**

In line 29, replace:
```
  heartbeat.json         — último ping e status (started | idle)
```
with:
```
  heartbeat.json         — último ping e status (processing | idle | waiting | completed)
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: add jobs, orchestrate, and waiting state to AGENTS.md"
```

---

### Task 9: Integration test

**Files:**
- Create: `tests/test_integration_collaboration.sh`

- [ ] **Step 1: Write integration test**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PASS=0; FAIL=0

assert_eq() {
  local label=$1 expected=$2 actual=$3
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $label"; PASS=$((PASS + 1))
  else
    echo "FAIL: $label — expected '$expected', got '$actual'"; FAIL=$((FAIL + 1))
  fi
}

echo "=== Integration: orchestrator fan-out/fan-in ==="

# 1. Create job
output=$(bash "$PROJECT_ROOT/lib/job.sh" create orchestrator "Integration test" "analista-kpi-company-v2,px-growth-agent")
job_id=$(echo "$output" | head -1)
thread_id=$(echo "$output" | tail -1)
echo "Created: $job_id ($thread_id)"

# 2. Send handoffs with job_id
ho1=$(bash "$PROJECT_ROOT/lib/handoff.sh" send orchestrator analista-kpi-company-v2 action null \
  "Test sub-task 1" "Test context" "Test expected" "$thread_id" "$job_id")
ho2=$(bash "$PROJECT_ROOT/lib/handoff.sh" send orchestrator px-growth-agent action null \
  "Test sub-task 2" "Test context" "Test expected" "$thread_id" "$job_id")

assert_eq "handoff 1 created" "true" "$([ -f "$ho1" ] && echo true || echo false)"
assert_eq "handoff 2 created" "true" "$([ -f "$ho2" ] && echo true || echo false)"
assert_eq "handoff 1 has job_id" "$job_id" "$(grep '^job_id:' "$ho1" | awk '{print $2}')"
assert_eq "handoff 2 has job_id" "$job_id" "$(grep '^job_id:' "$ho2" | awk '{print $2}')"

# 3. Simulate agent completion
bash "$PROJECT_ROOT/lib/job.sh" complete "$job_id" "analista-kpi-company-v2"
status1=$(bash "$PROJECT_ROOT/lib/job.sh" status "$job_id" | jq -r '.status')
assert_eq "after 1 complete: in_progress" "in_progress" "$status1"

bash "$PROJECT_ROOT/lib/job.sh" complete "$job_id" "px-growth-agent"
status2=$(bash "$PROJECT_ROOT/lib/job.sh" status "$job_id" | jq -r '.status')
assert_eq "after 2 complete: completed" "completed" "$status2"

# 4. job-agent extracts job_id from handoff
extracted=$(bash "$PROJECT_ROOT/lib/handoff.sh" job-agent "$ho1")
assert_eq "job-agent extracts job_id" "$job_id" "$extracted"

# 5. Archive job
bash "$PROJECT_ROOT/lib/job.sh" archive "$job_id"
assert_eq "job archived" "true" "$([ -f "$PROJECT_ROOT/agents/shared/jobs/archive/${job_id}.json" ] && echo true || echo false)"

# Cleanup test handoffs
rm -f "$ho1" "$ho2"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
```

- [ ] **Step 2: Run integration test**

Run: `bash tests/test_integration_collaboration.sh`
Expected: All PASS, 0 failed

- [ ] **Step 3: Clean up test artifacts**

```bash
rm -f agents/shared/jobs/archive/JOB-*.json
```

- [ ] **Step 4: Commit**

```bash
git add tests/test_integration_collaboration.sh
git commit -m "test: add integration test for agent collaboration"
```

---

### Task 10: Verify `agent-cron.sh` syntax

**Files:**
- None (verification only)

- [ ] **Step 1: Syntax check**

Run: `bash -n lib/agent-cron.sh`
Expected: Exit 0, no output

- [ ] **Step 2: Syntax check all modified scripts**

Run: `bash -n lib/job.sh && bash -n lib/handoff.sh && echo "All OK"`
Expected: `All OK`

- [ ] **Step 3: Run all tests**

Run: `bash tests/test_job.sh && bash tests/test_integration_collaboration.sh && echo "All tests passed"`
Expected: `All tests passed`

- [ ] **Step 4: Final commit**

```bash
git add -A
git status
# If there are any uncommitted changes, commit them
git commit -m "chore: final verification of concurrent collaboration implementation" || true
```
