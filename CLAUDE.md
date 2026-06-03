# Agentes Workflow Pessoal — Claude Code Orchestrator

## O que é este projeto

Ecossistema de agentes AI pessoais orquestrado pelo Claude Code. Cada agente tem IDENTITY persistente, estado entre sessões, e integração com serviços externos via MCP.

## Estrutura

```
agents/<nome>/         — Agente com IDENTITY.md, config.yaml e state/
commands/braion/       — Commands do Claude Code (init, wrapup, etc.)
lib/                   — Scripts utilitários (state.{sh,py}, logger, memory, handoff, job)
logs/                  — Logs estruturados JSONL por agente/dia
db/                    — Schema Postgres (schema.sql, migrations/)
scripts/               — Migração FS→PG, setup SSH tunnel, smoke test
USER.md                — Perfil do usuário (compartilhado entre agentes)
AGENTS.md              — Regras operacionais de todos os agentes
```

## Backend de Estado (multi-cluster)

Default: arquivos (`BRAION_STATE_BACKEND=file`). Para Postgres: `=pg`.
- `lib/state.sh` / `lib/state.py` são a fronteira; nunca abra arquivos de estado
  diretamente em código novo — sempre via `state_*` helpers.
- Schema: `db/schema.sql`. Conexão: PGSERVICE em `~/.pg_service.conf` (Mac usa
  túnel SSH via `scripts/setup_pg_tunnel.sh`).
- Cutover: `scripts/migrate_fs_to_pg.py` (idempotente, não apaga arquivos).
- Validação: `scripts/state_smoke_test.sh both`.

## Ciclo de Sessão

1. `/braion:agent-init` — carrega IDENTITY + estado + tarefas do Notion
2. Executa tarefas conforme objetivo
3. `/braion:agent-wrapup` — salva estado + decisões + log

## MCP Tools Disponíveis

- `mcp__personal-mcp-gateway__notion_*` — CRUD Notion
- `mcp__personal-mcp-gateway__notebooklm_*` — NotebookLM
- `bash lib/telegram.sh send "..."` — Telegram (bot BR.AI.ON, mesmo canal do hook/bridge). NÃO usar `gateway_send_notification`: entrega por outro bot (canal errado)

## Logging

Todo log vai para `logs/<agent>_<YYYY-MM-DD>.jsonl` via `lib/logger.sh`.

Formato: JSON com timestamp, agent, action, message, metadata, prompt_version, status.

## Convenções

- Estado persistente em Markdown simples
- Config em YAML
- Logs em JSONL
- Sem ações destrutivas sem aprovação
