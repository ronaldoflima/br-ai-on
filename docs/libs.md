# Bibliotecas (lib/)

Scripts utilitários compartilhados por todos os agentes e pelo cron.

## Orquestração

### agent-cron.sh
Orquestrador principal, roda a cada 5min via cron. Responsável por:
- Sincronizar vault Obsidian (git pull)
- Rotear notas do inbox para agentes (regras + AI fallback)
- Processar handoffs pendentes (iniciar sessões ou arquivar)
- Iniciar agentes "alive" que estão prontos (via scheduler)
- Monitorar e encerrar sessões stale/idle

### agent-scheduler.py
Engine de scheduling em Python. Lê todos os `config.yaml`, compara intervalos com `schedule_state.json`, e retorna JSON com agentes categorizados:
- `due` — prontos para execução
- `waiting` — intervalo não expirou
- `inactive` — mode disabled/handoff-only
- `budget_blocked` — limite diário atingido

```bash
python3 lib/agent-scheduler.py              # status completo
python3 lib/agent-scheduler.py --mark-ran <nome>  # registra execução
```

## Comunicação

### handoff.sh
Sistema de handoffs peer-to-peer entre agentes.

```bash
lib/handoff.sh send <from> <to> <expects> [reply_to] [desc] [ctx] [expected]
lib/handoff.sh list <agent>          # listar pendentes
lib/handoff.sh claim <agent> <path>  # mover para in_progress
lib/handoff.sh archive <agent> <path>
lib/handoff.sh thread-history <id>   # histórico da thread
lib/handoff.sh next_id               # gerar próximo ID
```

### job.sh
Coordenação de jobs paralelos (fan-out/fan-in).

```bash
lib/job.sh create <by> <desc> <agent1,agent2,...>
lib/job.sh complete <job_id> <agent> [handoff_id]
lib/job.sh fail <job_id> <agent> [reason]
lib/job.sh status <job_id>
lib/job.sh list-pending
lib/job.sh archive <job_id>
```

## Concorrência

### lock.sh
Locks distribuídos para sincronização de recursos.

```bash
lib/lock.sh acquire <agent> [resource]  # 3 retries, 5s sleep, 30s timeout
lib/lock.sh release <agent> [resource]
lib/lock.sh status [resource]
```

### check_concurrency.sh
Previne execução simultânea do mesmo agente via lock files em `/tmp/agents-workflow/`.

## Observabilidade

### logger.sh
Logging estruturado JSONL. Cada ação gera uma linha em `logs/<agent>_YYYY-MM-DD.jsonl`.

```bash
AGENT_NAME="<nome>" bash lib/logger.sh "<action>" "<message>" '<metadata_json>'
```

### metrics.sh
Métricas de performance em `metrics/YYYY-MM-DD.jsonl`.

```bash
# Log automático (chamado pelo logger.sh)
# Funções: metrics_log, metrics_summary, metrics_agent_summary
```

### evaluate.sh
Avaliação de qualidade dos logs com scoring determinístico e relatórios diários/semanais.

## Memória

### memory.sh
Memória local do agente — episódica e cache.

```bash
AGENT_NAME="<nome>" bash lib/memory.sh log_episodic "<action>" "<ctx>" "<outcome>" <importance>
AGENT_NAME="<nome>" bash lib/memory.sh search_episodic "<keyword>"
AGENT_NAME="<nome>" bash lib/memory.sh cache_get "<key>"
AGENT_NAME="<nome>" bash lib/memory.sh cache_set "<key>" '<value>' [ttl_seconds]
```

## Otimização

### optimize.sh
Versionamento e otimização de prompts (IDENTITY.md).

```bash
lib/optimize.sh version_snapshot <agent>
lib/optimize.sh create_proposal <agent> <type> <desc>
lib/optimize.sh rollback <agent> <version>
lib/optimize.sh audit_prompt_sizes
```

### validate_output.sh
Validação de outputs: existência, tamanho mínimo, sintaxe YAML/JSON, permissão de diretório.

## Outros

### feature-request.sh
CLI interativo para enviar feature requests ao braion-maintainer.

### obsidian-commit.sh
Auto-commit de mudanças no vault Obsidian.

### orchestrate.sh
**(Deprecated)** — funcionalidade migrada para `handoff.sh`.
