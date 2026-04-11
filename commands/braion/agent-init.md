---
name: agent-init
description: Inicializa sessão do agente — carrega estado persistente, memória e contexto operacional
---

# Inicialização do Agente

Você está iniciando uma sessão como agente autônomo. O prompt contém `Agent: <nome>` — use esse nome em todos os paths abaixo.

Sua identidade (IDENTITY.md), perfil do usuário (USER.md) e regras operacionais (AGENTS.md) já foram carregados via system prompt. Prossiga direto para o estado operacional.

## 0. Budget Check

Antes de tudo, verifique se o limite diário de sessões foi atingido:

```bash
BUDGET_FILE="/tmp/agent-<nome>-sessions-$(date -u +%Y-%m-%d).count"
SESSION_COUNT=0
[ -f "$BUDGET_FILE" ] && SESSION_COUNT=$(cat "$BUDGET_FILE")
echo "Sessões hoje: $SESSION_COUNT"
```

Leia `max_sessions_per_day` de `agents/<nome>/config.yaml`. Se `SESSION_COUNT >= max_sessions_per_day`, registre no log e **encerre sem executar**:

```bash
bash lib/logger.sh budget "Limite diário atingido" '{"blocked":true}'
tmux kill-session -t "$(tmux display-message -p '#S')" 2>/dev/null || true
```

Caso contrário, incremente o contador:

```bash
echo $((SESSION_COUNT + 1)) > "$BUDGET_FILE"
```

## 0.1. Heartbeat — Início

Registre o início da sessão no heartbeat:

```bash
jq -nc --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{last_ping: $ts, agent: "<nome>", status: "started"}' > agents/<nome>/state/heartbeat.json
```

## 1. Carregar Estado Persistente

Leia os arquivos de estado em `agents/<nome>/state/`:
- `current_objective.md` — seu foco atual
- `decisions.md` — decisões passadas (últimas 10 entradas)
- `completed_tasks.md` — tarefas recentes concluídas (últimas 20)

## 2. Carregar Memória de Longo Prazo

Leia a memória semântica para contexto persistente:
- `agents/<nome>/memory/semantic.md` — fatos, preferências e regras aprendidas

Consulte as últimas 10 entradas do episodic memory para contexto recente:
```bash
tail -n 10 agents/<nome>/memory/episodic.jsonl
```

## 3. Carregar Handoffs Pendentes

Verifique se há handoffs pendentes no inbox:

```bash
bash lib/handoff.sh list <nome>
```

Se houver handoffs pendentes:
1. Leia o conteúdo de cada arquivo `.md` listado
2. Inclua no contexto da sessão: "Você tem N handoff(s) pendente(s):"
   - Para cada um, resuma: de quem, o que espera, descrição curta
3. Considere os handoffs ao definir o objetivo da sessão (passo 7)
   - Handoffs com `expects: action` podem ter prioridade sobre tarefas de rotina
   - Handoffs com `expects: info` podem ser respondidos rapidamente
   - Handoffs com `expects: review` podem aguardar se houver urgências

Se não houver handoffs, prossiga normalmente.

## 4. Carregar Configuração

Leia `agents/<nome>/config.yaml` para limites e integrações.

## 5. Buscar Tarefas

Verifique se há tarefas pendentes nos arquivos locais:
- `agents/<nome>/handoffs/inbox/` — handoffs já carregados no passo 3

## 6. Definir Objetivo da Sessão

Com base nas tarefas pendentes e no objetivo anterior:
1. Determine o foco desta sessão
2. Atualize `agents/<nome>/state/current_objective.md` com:
   - Foco da sessão
   - Contexto (por que esse foco)
   - Data/hora de início

## 7. Registrar Início no Log

```bash
bash lib/logger.sh init "Sessão iniciada" '{"objective": "<objetivo>"}'
```

## 8. Confirmar

Após carregar tudo, resuma brevemente:
- Objetivo da sessão
- Tarefas prioritárias
- Decisões recentes relevantes

Ao terminar a sessão, chame `/braion:agent-wrapup`.
