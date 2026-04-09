# Concurrent Agent Collaboration — Design Spec

## Objetivo

Permitir que agentes do ecossistema br-ai-on trabalhem em conjunto: fan-out paralelo via orchestrator, colaboração espontânea peer-to-peer, e consolidação automática de resultados.

## Decisões de Design

| Decisão | Escolha | Alternativas descartadas |
|---|---|---|
| Estado do job | Arquivo JSON em `shared/jobs/` | Pure thread_id (implícito), event-driven daemon |
| Gatilho | Manual (skill/Telegram) + automático (agente escala) | Somente manual, somente cron |
| Fan-in | Polling via cron (5min) | inotifywait (event-driven) |
| Falhas | Consolida parcial + reporta ao usuário | Retry automático |
| Sessão durante espera | Mantém ativa (waiting) | Mata e re-cria |
| Colaboração simples | Peer-to-peer direto (expects=info) | Tudo via orchestrator |

## Componentes

### 1. Job Tracker — `shared/jobs/`

Arquivo por job:

```
shared/jobs/JOB-YYYYMMDD-NNN.json
shared/jobs/archive/
```

Schema:

```json
{
  "id": "JOB-20260408-001",
  "thread_id": "THR-20260408-001",
  "description": "Análise cruzada KPI + growth",
  "created_by": "orchestrator",
  "created": "2026-04-08T14:30:00Z",
  "status": "pending",
  "expected": [
    { "agent": "analista-kpi-company-v2", "handoff_id": "HO-20260408-031" },
    { "agent": "px-growth-agent", "handoff_id": "HO-20260408-032" }
  ],
  "completed": [],
  "failed": [],
  "result_summary": null
}
```

Ciclo de vida: `pending → in_progress → completed | partial_failure`

Lock obrigatório para escrita: `bash lib/lock.sh acquire orchestrator jobs`

### 2. `lib/job.sh` — API de Jobs

```bash
bash lib/job.sh create <created_by> <description> <agent1,agent2,...>
bash lib/job.sh complete <job_id> <agent> [handoff_id]
bash lib/job.sh fail <job_id> <agent> [reason]
bash lib/job.sh status <job_id>
bash lib/job.sh list-pending
bash lib/job.sh archive <job_id>
```

`create`:
1. Adquire lock `orchestrator jobs`
2. Gera ID sequencial `JOB-YYYYMMDD-NNN`
3. Gera `thread_id` = `THR-YYYYMMDD-NNN` (mesmo sequencial)
4. Escreve JSON em `shared/jobs/JOB-xxx.json`
5. Libera lock
6. Imprime JOB-ID e THREAD_ID no stdout

`complete`:
1. Adquire lock
2. Adiciona agente ao array `completed`
3. Se `completed.length == expected.length` → `status: completed`
4. Se `completed.length + failed.length == expected.length` → `status: partial_failure`
5. Senão → `status: in_progress`
6. Libera lock

### 3. Agente Orchestrator — `agents/orchestrator/`

```
agents/orchestrator/
├── IDENTITY.md
├── config.yaml
├── state/
│   ├── current_objective.md
│   ├── decisions.md
│   └── completed_tasks.md
├── memory/
│   ├── semantic.md
│   └── episodic.jsonl
└── handoffs/
    ├── inbox/
    ├── in_progress/
    ├── done/
    ├── artifacts/
    └── archive/
```

`config.yaml`:

```yaml
name: orchestrator
display_name: Orchestrator
domain: orquestração, coordenação, decomposição, multi-agente
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
```

Modos de operação (IDENTITY.md):
- **Fan-out**: recebe objetivo → decompõe → `job.sh create` → handoffs com `job_id`/`thread_id` → entra em `waiting`
- **Fan-in**: cron injeta path do reply na sessão → lê handoffs → consolida → notifica
- **Escalation**: agente envia `expects=orchestrate` → orchestrator analisa e decompõe

### 4. Mudanças no `lib/handoff.sh`

Nova assinatura do `send`:

```bash
handoff.sh send <from> <to> <expects> [reply_to] [descricao] [contexto] [esperado] [thread_id] [job_id]
```

9º parâmetro `job_id` adicionado ao frontmatter YAML quando presente:

```yaml
---
id: HO-20260408-031
from: orchestrator
to: analista-kpi-company-v2
created: 2026-04-08T14:30:00Z
status: pending
expects: action
reply_to: null
thread_id: THR-20260408-001
job_id: JOB-20260408-001
---
```

Novo comando:

```bash
bash lib/handoff.sh job-agent <handoff_file>
# Retorna job_id ou vazio
```

### 5. Novo valor de `expects`: `orchestrate`

| expects | Significado | Quem processa |
|---|---|---|
| `action` | Execute esta tarefa | Agente destino |
| `review` | Revise e opine | Agente destino |
| `info` | Me dê esta informação | Agente destino (reply direto) |
| `orchestrate` | Decomponha e coordene | Orchestrator |

### 6. Sessões ativas durante espera (waiting)

Quando um agente solicita peer-to-peer ou o orchestrator faz fan-out, a sessão tmux **não é encerrada**. O agente:

1. Envia handoff(s)
2. Atualiza heartbeat:

```json
{
  "status": "waiting",
  "last_ping": "2026-04-08T14:32:00Z",
  "waiting_for": "HO-20260408-033",
  "waiting_since": "2026-04-08T14:32:00Z"
}
```

3. Fica idle na sessão aguardando

O cron respeita `status=waiting` com timeout maior. Configurável via `WAITING_TIMEOUT` (default: 1800s / 30min) vs `STALE_THRESHOLD` (default: 900s / 15min).

### 7. Mudanças no `agent-cron.sh`

**Injeção de reply em sessão ativa:**

Quando reply chega no inbox de um agente com sessão ativa e `heartbeat.status=waiting`:

```bash
tmux send-keys -t "braion-${agent}" \
  "/braion:agent-inbox-router ${handoff_file}" Enter
bash lib/handoff.sh claim "$agent" "$handoff_file"
```

O cron envia apenas o **path** do handoff. O agente lê o conteúdo.

**Fan-in do orchestrator:**

Antes de acordar o orchestrator para replies de job, verifica:

```bash
job_id=$(grep '^job_id:' "$handoff_file" | ...)
if [ -n "$job_id" ]; then
  job_status=$(bash lib/job.sh status "$job_id" | jq -r '.status')
  if [ "$job_status" = "completed" ] || [ "$job_status" = "partial_failure" ]; then
    # Se sessão ativa e waiting → injeta
    # Se sessão inativa → acorda normalmente
  fi
fi
```

**Detecção de falha:**

Quando mata sessão stale de agente com job ativo:

```bash
if agent_has_active_job "$agent"; then
  job_id=$(get_agent_active_job "$agent")
  bash lib/job.sh fail "$job_id" "$agent" "stale_session_killed"
fi
```

### 8. Mudanças no agent-wrapup

Ao final do wrapup, detecta se handoff pertence a job e marca complete:

```bash
job_id=$(bash lib/handoff.sh job-agent "$current_handoff")
if [ -n "$job_id" ]; then
  bash lib/job.sh complete "$job_id" "$AGENT_NAME"
fi
```

Automático — agente não precisa saber que está num job.

## Fluxos

### Fan-out manual

```
Usuário → /braion:orchestrator ou Telegram
→ orchestrator decompõe objetivo
→ job.sh create → JOB-001 (expected: [agent-A, agent-B])
→ handoff.sh send orchestrator agent-A action ... THR-001 JOB-001
→ handoff.sh send orchestrator agent-B action ... THR-001 JOB-001
→ orchestrator heartbeat: waiting
→ cron acorda agent-A e agent-B (sessões paralelas)
→ agent-A termina → wrapup → job.sh complete JOB-001 agent-A → reply para orchestrator
→ agent-B termina → wrapup → job.sh complete JOB-001 agent-B → reply para orchestrator
→ cron detecta JOB-001 completed + orchestrator waiting
→ tmux send-keys "braion-orchestrator" "/braion:agent-inbox-router <paths>"
→ orchestrator consolida → notifica usuário
```

### Escalation espontânea

```
Agent-A rodando → encontra tarefa fora do domínio
→ handoff.sh send agent-A orchestrator orchestrate ...
→ agent-A heartbeat: waiting
→ cron acorda orchestrator
→ orchestrator cria job → fan-out para agent-B e agent-C
→ fan-in → orchestrator consolida → reply para agent-A
→ cron injeta reply na sessão de agent-A
→ agent-A continua com contexto completo
```

### Peer-to-peer (consulta simples)

```
Agent-A rodando → precisa de dado de agent-B
→ handoff.sh send agent-A agent-B info ...
→ agent-A heartbeat: waiting
→ cron acorda agent-B
→ agent-B processa → handoff.sh send agent-B agent-A info HO-xxx (reply)
→ agent-B wrapup
→ cron detecta reply no inbox de agent-A + sessão ativa + waiting
→ tmux send-keys "braion-agent-A" "/braion:agent-inbox-router <path>"
→ agent-A lê reply → continua trabalho
```

## Resumo de implementação

| Componente | Ação | Esforço |
|---|---|---|
| `lib/job.sh` | Criar | Médio |
| `agents/orchestrator/` | Criar (config + IDENTITY + dirs) | Baixo |
| `lib/handoff.sh` | Editar — param `job_id` + comando `job-agent` | Baixo |
| `commands/braion/agent-wrapup.md` | Editar — detecção de job_id | Baixo |
| `lib/agent-cron.sh` | Editar — fan-in + injeção em sessão waiting + falha stale | Médio |
| `shared/jobs/` + `shared/jobs/archive/` | Criar diretórios | Trivial |
| `AGENTS.md` | Editar — documentar jobs, orchestrate, waiting, colaboração | Baixo |
