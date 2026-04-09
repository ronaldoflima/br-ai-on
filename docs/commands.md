# Commands (Claude Code Skills)

Skills do Claude Code em `commands/braion/` que definem o ciclo de vida dos agentes.

## agent-init

Entry point de toda sessão de agente. Carrega identidade, estado persistente, handoffs pendentes e define o objetivo da sessão.

**Fluxo:**
1. Budget check → rejeita se limite diário atingido
2. Heartbeat → status "started"
3. Carregar IDENTITY.md + USER.md + AGENTS.md
4. Carregar state/ (objective, decisions, completed_tasks)
5. Carregar memory/ (semantic + episodic)
6. Listar handoffs pendentes no inbox
7. Carregar config.yaml
8. Definir objetivo da sessão
9. Registrar init no log

**Uso:** Automático — injetado pelo cron ao iniciar sessão tmux.

## agent-wrapup

Exit point de toda sessão. Persiste estado, memória, métricas e arquiva handoffs.

**Fluxo:**
1. Atualizar current_objective.md (status + próximo foco)
2. Registrar decisões e tarefas concluídas
3. Atualizar semantic memory (se houve aprendizado)
4. Registrar episodic memory (ações com importance 1-5)
5. Arquivar handoffs processados
6. Detectar/marcar conclusão de jobs
7. Logar métricas e heartbeat "idle"

**Uso:** Chamado pelo agente ao final da sessão ou pelo cron antes de encerrar.

## agent-handoff

Processa um handoff específico atribuído ao agente.

**Fluxo:**
1. Claim do handoff (move para in_progress)
2. Carregar contexto + thread history
3. Executar ação conforme `expects` (action/review)
4. Responder ao remetente se necessário
5. Arquivar e atualizar estado

**Uso:** Invocado pelo cron quando há handoff pendente para o agente.

## agent-inbox-router

Converte notas do Obsidian inbox em handoffs roteados para agentes.

**Fluxo:**
1. Carregar configs de todos os agentes (domínios)
2. Para cada nota no inbox: match por domínio → criar handoff → mover nota
3. Logar métricas

**Uso:** Pode ser agendado ou invocado manualmente.

## orchestrator

Coordenador central para objetivos complexos multi-agente.

**Fluxo:**
1. Carregar mapa de agentes e capacidades
2. Decompor objetivo em sub-tarefas atômicas
3. Distribuir via handoffs com contexto scoped
4. Monitorar status e consolidar resultados
5. Criar handoff para o usuário com resultado final

**Uso:** Recebe handoffs com `expects: orchestrate`.
