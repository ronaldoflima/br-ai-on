# BR.AI.ON — Visão Geral

Ecossistema de agentes AI pessoais com backend AI plugável. Cada agente possui identidade persistente (IDENTITY.md), estado entre sessões, e integração com serviços externos via MCP.

A camada de abstração `lib/cli.sh` (bash) e `dashboard/app/lib/cli-backend.ts` (TypeScript) isola o projeto do CLI concreto. A variável `CLI_BACKEND` (padrão: `claude`) permite trocar entre Claude Code, Codex e futuramente Gemini CLI sem alterar nenhum script ou componente.

## Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│                        Cron (5min)                      │
│                     lib/agent-cron.sh                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Scheduler │  │  Inbox   │  │ Handoff  │              │
│  │  (alive)  │  │  Router  │  │ Dispatch │              │
│  └─────┬─────┘  └────┬─────┘  └────┬─────┘              │
└────────┼──────────────┼─────────────┼────────────────────┘
         │              │             │
    ┌────▼────┐    ┌────▼────┐   ┌────▼────┐
    │  Agent  │    │  Agent  │   │  Agent  │
    │  tmux   │    │  tmux   │   │  tmux   │
    │ session │    │ session │   │ session │
    └─────────┘    └─────────┘   └─────────┘
         │              │             │
    ┌────▼────────────────────────────▼────┐
    │        Estado Persistente            │
    │  agents/<nome>/state/ + memory/      │
    └──────────────────────────────────────┘
```

## Ciclo de Vida de um Agente

1. **Cron** (`lib/agent-cron.sh`) roda a cada 5 minutos
2. **Scheduler** (`lib/agent-scheduler.py`) determina quais agentes "alive" estão prontos
3. **Sessão tmux** é criada com o CLI AI (via `cli_build_start_cmd`) + system prompt com estado, memória e handoffs injetados via `--append-system-prompt`
4. **Init** (`/braion:agent-init`) define objetivo e registra heartbeat (identidade, estado e handoffs já estão no system prompt)
5. **Execução** — agente processa tarefas conforme objetivo
6. **Wrapup** (`/braion:agent-wrapup`) persiste estado, memória e métricas
7. **Idle** — cron monitora sessões ociosas (kill automático por stale removido na v1.3.0)

## Modos de Schedule

| Modo | Comportamento |
|------|--------------|
| `alive` | Cron inicia automaticamente quando o intervalo expira |
| `handoff-only` | Só acorda quando recebe handoff de outro agente |
| `disabled` | Nunca iniciado automaticamente |

## Comunicação entre Agentes

Agentes se comunicam via **handoffs** — arquivos Markdown com metadados YAML:

- `expects: action` — destinatário executa algo e responde
- `expects: review` — destinatário revisa e opina
- `expects: info` — notificação unidirecional (sem resposta)
- `expects: orchestrate` — escala ao orchestrator para decomposição

Para trabalho paralelo, o **orchestrator** cria **jobs** que agrupam múltiplos handoffs sob um objetivo comum, com fan-out/fan-in automático.

## Canais de Entrada

| Canal | Mecanismo |
|-------|-----------|
| Telegram | `scripts/telegram-bridge.sh` → sessão do CLI AI ativo |
| Obsidian Inbox | Notas em `agents/inbox/` → roteadas para agentes |
| Handoffs diretos | `lib/handoff.sh send` entre agentes |
| Manual | Claude Code CLI direto |

## Infraestrutura

- **Ambiente**: VPS Hostinger (Linux)
- **Sessões**: tmux (uma por agente ativo)
- **Dashboard**: Next.js 15 v1.3.2 na porta 3040 (`dashboard/`) — terminal web, file explorer, filtros por layer
- **Logs**: JSONL estruturado em `logs/`
- **Métricas**: JSONL em `metrics/`
- **Locks**: `/tmp/agents-workflow/*.lock`
- **Budget**: `/tmp/agent-<nome>-sessions-<date>.count`
