# Requirements: Agentes Workflow Pessoal

**Defined:** 2026-04-04
**Core Value:** Comunicação confiável entre agentes: toda mensagem chega ao destino certo, com prioridade adequada e visibilidade para o usuário.

## v1 Requirements

### Limpeza de Canais

- [x] **CLEAN-01**: Deprecar `agents/shared/task_board.md` como canal de comunicação (remover ou marcar deprecated)
- [x] **CLEAN-02**: Deprecar `agents/shared/messages.jsonl` como canal de comunicação (remover ou marcar deprecated)

### Routing

- [x] **ROUTE-01**: Documentar que task-manager + skill agent-inbox-router é o único responsável por Obsidian→handoff
- [x] **ROUTE-02**: Garantir que orchestrator não faz routing de inbox (apenas decomposição de tarefas complexas)

### Schema de Handoffs

- [ ] **SCHEMA-01**: Adicionar campo `thread_id` no schema de handoffs para conversas multi-turno
- [ ] **SCHEMA-02**: `lib/handoff.sh` suporta `thread_id` — herda automaticamente ao responder com `reply_to`
- [ ] **SCHEMA-03**: `lib/handoff.sh thread-history <thread_id>` retorna resumo dos handoffs anteriores da thread
- [ ] **SCHEMA-04**: `agent-handoff/SKILL.md` carrega thread history como contexto antes de processar handoff com thread_id

### Visibilidade

- [ ] **VIS-01**: Dashboard Next.js consome handoffs dos agentes e exibe status em tempo real

## v2 Requirements

### Prioridade

- **PRIO-01**: Campo `priority` (high/medium/low) no schema de handoffs
- **PRIO-02**: Cron processa handoffs high antes dos demais

### Expiração

- **EXP-01**: Campo `expires_at` no schema de handoffs
- **EXP-02**: Cron arquiva handoffs expirados automaticamente

### Review Cycle

- **REV-01**: Ciclo de review com `expects: review` → aprovação/rejeição
- **REV-02**: Campo `review_decision: approved | rejected | needs-info` no handoff de resposta

### Telegram Bidirecional

- **TELE-01**: Usuário envia mensagem no Telegram → gateway converte em handoff
- **TELE-02**: Agente responde via handoff → gateway envia ao usuário no Telegram

## Out of Scope

| Feature | Reason |
|---------|--------|
| Sessão tmux persistente por thread | Complexidade de lifecycle (timeout, sessões penduradas) — contexto via thread-history é suficiente |
| Handoff board JSON intermediário | Dashboard pode ler handoffs diretamente dos arquivos |
| Prioridade nos handoffs (v1) | Thread_id é mais impactante; priority pode esperar v1.1 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CLEAN-01 | Phase 1 | Complete |
| CLEAN-02 | Phase 1 | Complete |
| ROUTE-01 | Phase 2 | Complete |
| ROUTE-02 | Phase 2 | Complete |
| SCHEMA-01 | Phase 3 | Pending |
| SCHEMA-02 | Phase 3 | Pending |
| SCHEMA-03 | Phase 3 | Pending |
| SCHEMA-04 | Phase 3 | Pending |
| VIS-01 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 9 total
- Mapped to phases: 9
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-04*
*Last updated: 2026-04-04 after roadmap creation*
