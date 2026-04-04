# Agentes Workflow Pessoal

## What This Is

Ecossistema de agentes AI pessoais orquestrado pelo Claude Code. Cada agente tem identidade persistente, estado entre sessões, e integração com serviços externos via MCP. Os agentes se comunicam via handoffs e são executados por cron jobs.

## Core Value

Comunicação confiável entre agentes: toda mensagem (user→agente, agente→agente) chega ao destino certo, com prioridade adequada e visibilidade para o usuário.

## Current Milestone: v1.0 Consolidação de Canais de Comunicação

**Goal:** Unificar handoffs como canal único de comunicação entre agentes, eliminando canais duplicados e adicionando prioridade/visibilidade.

**Target features:**
- Deprecar task_board.md e messages.jsonl como canais de comunicação
- Resolver sobreposição inbox-router/task-manager/orchestrator na cron
- Enriquecer schema de handoffs com `priority` e `thread_id`
- Criar handoff board JSON para o dashboard web

## Requirements

### Validated

- ✓ Handoffs peer-to-peer via `lib/handoff.sh` — funcional desde o início
- ✓ Schema base de handoffs (id, from, to, created, status, expects, reply_to)
- ✓ Obsidian inbox como interface de entrada
- ✓ Agent scheduler com budget e concorrência
- ✓ Logging estruturado JSONL

### Active

None — all v1.0 requirements complete.

### Completed in v1.0

- [x] Deprecar canais redundantes (task_board, messages.jsonl) — Phase 1
- [x] Unificar responsabilidades de routing (inbox-router como único conversor) — Phase 2
- [x] Adicionar campo `thread_id` no schema de handoffs — Phase 3
- [x] Thread history e integração na skill agent-handoff — Phase 3
- [x] Dashboard exibe handoffs com thread_id — Phase 4

### Out of Scope

- Telegram bidirecional como canal user↔agente — alto esforço, pode esperar v1.1
- Ciclo de review completo (expects: review com aprovação) — alto esforço, v1.1
- Conversas multi-turno com agrupamento visual por thread — depende de thread_id funcionar primeiro

## Context

- 4 canais de interação existem: handoffs (principal), Obsidian inbox, task_board.md, messages.jsonl
- Handoffs são o mecanismo mais maduro e usado — os outros são redundantes ou subutilizados
- Há sobreposição entre inbox-router, task-manager e orchestrator para routing de Obsidian inbox
- Dashboard web (Next.js, porta 3040) exibe handoffs com thread_id
- `lib/handoff.sh` já implementa criação, listagem e arquivamento de handoffs

## Constraints

- **Backwards compatibility**: Handoffs existentes devem continuar funcionando — novos campos são opcionais
- **No LLM para routing simples**: inbox-router deve converter Obsidian→handoff sem precisar de LLM quando possível
- **Cron-based**: Agentes rodam via cron, não em tempo real — prioridade afeta ordem no ciclo, não latência

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Handoffs como canal único | Mais maduro, já em uso por todos os agentes | ✅ Validated Phase 1 |
| inbox-router como único conversor Obsidian→handoff | Elimina sobreposição com task-manager e orchestrator | ✅ Validated Phase 2 |
| Novos campos opcionais no schema | Backwards compatibility com handoffs existentes | ✅ Validated Phase 3 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-04 after milestone v1.0 completion*
