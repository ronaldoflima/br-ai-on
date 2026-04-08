# Agentes Workflow Pessoal — Claude Code Orchestrator

## O que é este projeto

Ecossistema de agentes AI pessoais orquestrado pelo Claude Code. Cada agente tem IDENTITY persistente, estado entre sessões, e integração com serviços externos via MCP.

## Estrutura

```
agents/<nome>/         — Agente com IDENTITY.md, config.yaml e state/
commands/braion/       — Commands do Claude Code (init, wrapup, etc.)
lib/                   — Scripts utilitários (logger.sh)
logs/                  — Logs estruturados JSONL por agente/dia
USER.md                — Perfil do usuário (compartilhado entre agentes)
AGENTS.md              — Regras operacionais de todos os agentes
```

## Ciclo de Sessão

1. `/braion:agent-init` — carrega IDENTITY + estado + tarefas do Notion
2. Executa tarefas conforme objetivo
3. `/braion:agent-wrapup` — salva estado + decisões + log

## MCP Tools Disponíveis

- `mcp__personal-mcp-gateway__notion_*` — CRUD Notion
- `mcp__personal-mcp-gateway__notebooklm_*` — NotebookLM
- `mcp__personal-mcp-gateway__gateway_send_notification` — Telegram

## Logging

Todo log vai para `logs/<agent>_<YYYY-MM-DD>.jsonl` via `lib/logger.sh`.

Formato: JSON com timestamp, agent, action, message, metadata, prompt_version, status.

## Convenções

- Estado persistente em Markdown simples
- Config em YAML
- Logs em JSONL
- Sem ações destrutivas sem aprovação
