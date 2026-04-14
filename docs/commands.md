# Commands (Claude Code Skills)

Skills do Claude Code em `commands/braion/` que definem o ciclo de vida dos agentes.

## agent-init

Entry point de toda sessão de agente. Define objetivo e registra heartbeat.

Desde v1.3.2, identidade (IDENTITY.md, USER.md, AGENTS.md), estado persistente (objective, decisions, completed_tasks), memória (semantic + episodic), handoffs pendentes e capabilities dos collaborators são **injetados automaticamente via `--append-system-prompt`** pelo cron — o init não precisa mais lê-los manualmente.

**Fluxo (simplificado de 8→4 passos):**
1. Heartbeat → status "started"
2. Carregar config.yaml (limites e integrações)
3. Definir objetivo da sessão
4. Registrar init no log

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
8. Notificar via Telegram (se `integrations.telegram.enabled: true` no config)

**Uso:** Chamado pelo agente ao final da sessão ou pelo cron antes de encerrar.

## agent-handoff

Processa um handoff específico atribuído ao agente.

**Fluxo:**
1. Claim do handoff (move para in_progress)
2. Contexto e estado já disponíveis via system prompt (não precisa reler)
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
