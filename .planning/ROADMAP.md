# Roadmap: Agentes Workflow Pessoal

## Overview

v1.0 consolida handoffs como canal único de comunicação entre agentes. A jornada vai da remoção de canais redundantes (Limpeza), passando pela clarificação de responsabilidades de routing (Routing), enriquecimento do schema com thread_id (Schema), até a visibilidade no dashboard (Visibilidade).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Limpeza de Canais** - Deprecar task_board.md e messages.jsonl como canais de comunicação (completed 2026-04-04)
- [x] **Phase 2: Routing** - Documentar inbox-router como único conversor Obsidian→handoff e limpar sobreposição (completed 2026-04-04)
- [x] **Phase 3: Schema de Handoffs** - Adicionar thread_id ao schema e suporte completo em handoff.sh e skills (completed 2026-04-04)
- [x] **Phase 4: Visibilidade** - Dashboard Next.js exibe handoffs dos agentes em tempo real (completed 2026-04-04)

## Phase Details

### Phase 1: Limpeza de Canais
**Goal**: Canais redundantes removidos — handoffs são o único mecanismo de comunicação ativo
**Depends on**: Nothing (first phase)
**Requirements**: CLEAN-01, CLEAN-02
**Success Criteria** (what must be TRUE):
  1. `agents/shared/task_board.md` não existe mais ou contém header de deprecação claro impedindo uso acidental
  2. `agents/shared/messages.jsonl` não existe mais ou contém indicação de deprecação
  3. Nenhum agente ou script referencia task_board.md ou messages.jsonl como destino de escrita ativo
**Plans:** 1/1 plans complete
Plans:
- [x] 01-01-PLAN.md — Remover referências a task_board.md e messages.jsonl de skills, scripts e .gitignore

### Phase 2: Routing
**Goal**: inbox-router é o único responsável por converter mensagens Obsidian em handoffs — sem sobreposição com orchestrator ou task-manager
**Depends on**: Phase 1
**Requirements**: ROUTE-01, ROUTE-02
**Success Criteria** (what must be TRUE):
  1. Documentação do task-manager e inbox-router estabelece claramente que inbox-router faz a conversão Obsidian→handoff
  2. IDENTITY.md ou SKILL.md do orchestrator não descreve responsabilidade de routing de inbox
  3. Uma mensagem criada no Obsidian inbox segue exatamente um caminho: inbox-router → handoff
**Plans:** 1/1 plans complete
Plans:
- [x] 02-01-PLAN.md — Clarificar ownership de inbox routing e limpar sobreposição

### Phase 3: Schema de Handoffs
**Goal**: Handoffs suportam thread_id — criação, herança automática, histórico de thread e integração na skill de processamento
**Depends on**: Phase 2
**Requirements**: SCHEMA-01, SCHEMA-02, SCHEMA-03, SCHEMA-04
**Success Criteria** (what must be TRUE):
  1. Um handoff criado com `thread_id` persiste o campo no arquivo JSON do handoff
  2. Ao responder um handoff com `reply_to`, `thread_id` é herdado automaticamente sem intervenção manual
  3. `lib/handoff.sh thread-history <thread_id>` retorna lista dos handoffs da thread com from/to/status
  4. `agent-handoff/SKILL.md` instrui o agente a carregar thread history quando `thread_id` está presente antes de processar
**Plans:** 2/2 plans complete
Plans:
- [x] 03-01-PLAN.md — Adicionar thread_id ao handoff_send com heranca e thread-history
- [x] 03-02-PLAN.md — Atualizar SKILL.md com instrucoes de thread_id

### Phase 4: Visibilidade
**Goal**: Usuário consegue ver todos os handoffs dos agentes diretamente no dashboard web
**Depends on**: Phase 3
**Requirements**: VIS-01
**Success Criteria** (what must be TRUE):
  1. Dashboard na porta 3040 exibe lista de handoffs com from, to, status e created
  2. Handoffs de todos os agentes aparecem na mesma visualização
  3. Status dos handoffs (pending, complete, archived) é refletido na UI
**Plans:** 1/1 plans complete
Plans:
- [x] 04-01-PLAN.md — Dashboard de handoffs
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Limpeza de Canais | 1/1 | Complete    | 2026-04-04 |
| 2. Routing | 1/1 | Complete    | 2026-04-04 |
| 3. Schema de Handoffs | 2/2 | Complete    | 2026-04-04 |
| 4. Visibilidade | 1/1 | Complete   | 2026-04-04 |
