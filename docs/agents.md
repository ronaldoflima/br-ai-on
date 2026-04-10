# Agentes

Catálogo de todos os agentes do ecossistema BR.AI.ON.

## Agentes de Infraestrutura

### orchestrator
- **Display**: Orchestrator
- **Domínio**: orquestração, coordenação, multi-agente, fan-out/fan-in
- **Schedule**: handoff-only (priority 0)
- **Função**: Decompõe objetivos complexos em sub-tarefas, distribui via handoffs, consolida resultados. Único com escrita em `agents/shared/`.

### agent-builder
- **Display**: AgentBuilder
- **Schedule**: handoff-only (priority 3)
- **Função**: Cria novos agentes a partir de especificações — gera IDENTITY.md, config.yaml, estrutura de diretórios.

### inbox-router
- **Display**: InboxRouter
- **Domínio**: roteamento de mensagens
- **Schedule**: disabled (priority 1)
- **Função**: Converte notas do Obsidian inbox em handoffs, roteando para o agente mais adequado por domínio.

### task-manager
- **Display**: TaskManager
- **Schedule**: alive, 2h (priority 1)
- **Função**: Gerencia tarefas e sincronização com sistemas externos.

### documentation
- **Display**: Braion Docs
- **Domínio**: documentação, arquitetura, knowledgebase
- **Schedule**: alive, 5min (priority 2)
- **Função**: Mantém documentação atualizada acompanhando commits. Gerencia NotebookLM como knowledgebase.

## Agentes de Negócio

### analista-kpi-company-v2
- **Display**: Analista kpi_company_v2
- **Domínio**: kpi, gs, dias vendidos, client_status, superset
- **Schedule**: handoff-only (priority 1)
- **Função**: Análise de KPIs via Superset com foco em métricas de negócio.

### superset-kpi / superset-kpi-v3
- **Display**: Especialista KPI GS / 3.0
- **Schedule**: handoff-only
- **Função**: Análise especializada de dashboards e KPIs no Superset.

### px-growth-agent
- **Display**: PX Growth Agent
- **Domínio**: px, crescimento, dias consumidos, superset dashboard 201
- **Schedule**: handoff-only (priority 2)
- **Função**: Crescimento de empresas e análise de consumo PX.

### dev-px-torre-core
- **Display**: Dev px-torre-core
- **Domínio**: torre, px, core
- **Schedule**: handoff-only (priority 2)
- **Função**: Desenvolvimento — bugs e features no px-torre-core.

### discount-especialist
- **Display**: Discount Especialist
- **Domínio**: desconto, ocorrência, multa, sinistro
- **Schedule**: handoff-only (priority 2)
- **Função**: Análise de descontos e ocorrências TorrePX.

## Agentes de Serviço

### personal-mcp-gateway
- **Display**: Personal MCP Gateway
- **Domínio**: infraestrutura de serviços
- **Schedule**: handoff-only (priority 2)
- **Função**: Monitora o serviço personal-mcp-gateway.

### netsuite-monitor
- **Display**: NetSuite Monitor
- **Schedule**: alive, 24h (priority 2)
- **Função**: Monitoramento de integrações NetSuite.

### finance-ops
- **Display**: FinanceOps
- **Domínio**: finanças/trading
- **Schedule**: disabled (priority 2)
- **Função**: Gerenciamento do trading engine.

## Agentes Auxiliares

### braion (BraionEngineer)
- **Schedule**: handoff-only
- **Função**: Engenheiro do próprio ecossistema BR.AI.ON.

### extract-tasks (ExtractTasks)
- **Schedule**: disabled
- **Função**: Extração de tarefas de fontes diversas.

### user
- **Schedule**: N/A
- **Função**: Representação do usuário no sistema de handoffs.

## Armazenamento

Agentes podem residir em dois locais:

| Tipo | Path | Git |
|------|------|-----|
| Default | `agents/_defaults/<nome>/` | Versionado |
| Local | `agents/<nome>/` (diretório direto) | Gitignored |
| Externo | `agents/<nome>/` → symlink para `~/.config/br-ai-on/agents/<nome>` | Gitignored |

Symlinks externos: agent-builder, braion, extract-tasks, netsuite-monitor, superset-kpi, superset-kpi-v3, task-manager, user.

### Diretórios especiais em agents/

| Diretório | Propósito |
|-----------|-----------|
| `_defaults/` | Agentes versionados no git |
| `shared/` | Estado compartilhado (jobs, schedule_state) — só orchestrator escreve |
| `inbox/` | Notas do Obsidian inbox para roteamento automático |
| `forwarded/` | Handoffs encaminhados entre agentes |

## Estrutura de Diretórios por Agente

```
agents/<nome>/
├── IDENTITY.md          — identidade e regras
├── config.yaml          — schedule, budget, integrações
├── state/
│   ├── current_objective.md
│   ├── decisions.md
│   ├── completed_tasks.md
│   └── heartbeat.json
├── memory/
│   ├── semantic.md      — conhecimento acumulado
│   └── episodic.jsonl   — histórico de ações
└── handoffs/
    ├── inbox/           — handoffs pendentes
    └── archive/         — handoffs processados
```
