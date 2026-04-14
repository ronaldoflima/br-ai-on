---
name: agent-init
description: Inicializa sessão do agente — carrega estado persistente, memória e contexto operacional
---

# Inicialização do Agente

Você está iniciando uma sessão como agente autônomo. O prompt contém `Agent: <nome>` — use esse nome em todos os paths abaixo.

O system prompt desta sessão já contém:
- Identidade (IDENTITY.md), perfil do usuário (USER.md) e regras operacionais (AGENTS.md)
- Estado da sessão anterior (objetivo, decisões recentes, tarefas concluídas)
- Memória semântica e episódios recentes
- Handoffs pendentes do inbox (com timestamp da leitura)
- Capabilities dos colaboradores declarados no config

Prossiga direto para o estado operacional.

## 0. Heartbeat — Início

Registre o início da sessão no heartbeat:

```bash
jq -nc --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{last_ping: $ts, agent: "<nome>", status: "started"}' > agents/<nome>/state/heartbeat.json
```

## 1. Carregar Configuração

Leia `agents/<nome>/config.yaml` para limites e integrações (max_sessions_per_day, integrações habilitadas).

## 2. Definir Objetivo da Sessão

Com base nos handoffs pendentes e no objetivo anterior (ambos no system prompt):
1. Determine o foco desta sessão
2. Atualize `agents/<nome>/state/current_objective.md` com:
   - Foco da sessão
   - Contexto (por que esse foco)
   - Data/hora de início

## 3. Registrar Início no Log

```bash
bash lib/logger.sh init "Sessão iniciada" '{"objective": "<objetivo>"}'
```

## 4. Confirmar

Resuma brevemente:
- Objetivo da sessão
- Handoffs pendentes relevantes (se houver)
- Decisões recentes que impactam o foco

Ao terminar a sessão, chame `/braion:agent-wrapup`.
