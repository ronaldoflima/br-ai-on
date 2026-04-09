# Handoffs e Jobs

Sistema de comunicação assíncrona entre agentes.

## Handoffs

Arquivo Markdown com frontmatter YAML depositado no inbox do destinatário.

### Formato

```
agents/<destino>/handoffs/inbox/HO-<YYYYMMDD>-<NNN>_from-<remetente>.md
```

```yaml
---
id: HO-20260325-001
from: agent-a
to: agent-b
created: 2026-03-25T10:00:00Z
status: pending
expects: action
reply_to: null
job_id: null
thread_id: null
---

## Descricao
## Contexto
## Esperado
```

### Tipos (expects)

| Valor | Ação | Resposta |
|-------|------|----------|
| `action` | Executa tarefa | Sim, com resultado |
| `review` | Revisa e opina | Sim, com parecer |
| `info` | Notificação | Não (cron arquiva automaticamente) |
| `orchestrate` | Decompõe e coordena | Orchestrator processa |

### Ciclo de Vida

```
inbox/ → claim (in_progress/) → processamento → archive/
```

Para `to: user` ou `expects: info`, o cron arquiva diretamente sem iniciar sessão.

### CLI

```bash
lib/handoff.sh send <from> <to> <expects> [reply_to] [desc] [ctx] [expected]
lib/handoff.sh list <agent>
lib/handoff.sh claim <agent> <path>
lib/handoff.sh archive <agent> <path>
lib/handoff.sh thread-history <id>
```

## Jobs

Agrupam múltiplos handoffs sob um objetivo comum. Usados pelo orchestrator para fan-out paralelo.

### Formato

```json
// agents/shared/jobs/JOB-YYYYMMDD-NNN.json
{
  "id": "JOB-20260325-001",
  "created_by": "orchestrator",
  "description": "Analisar KPIs Q1",
  "status": "in_progress",
  "agents": {
    "analista-kpi": { "status": "completed", "handoff_id": "HO-..." },
    "superset-kpi": { "status": "in_progress" }
  }
}
```

### Ciclo de Vida

```
pending → in_progress → completed | partial_failure
```

### CLI

```bash
lib/job.sh create <by> <desc> <agents_csv>
lib/job.sh complete <job_id> <agent> [handoff_id]
lib/job.sh fail <job_id> <agent> [reason]
lib/job.sh status <job_id>
lib/job.sh list-pending
lib/job.sh archive <job_id>
```

## Threads

Handoffs podem formar threads via `reply_to` e `thread_id`. O `thread-history` reconstrói a conversa completa entre agentes.

## Modo Waiting

Quando um agente envia handoff e precisa da resposta:

1. Heartbeat registra `status: "waiting"`, `waiting_for: "HO-xxx"`
2. Cron respeita timeout maior (default 1800s)
3. Quando reply chega, cron injeta na sessão tmux ativa
