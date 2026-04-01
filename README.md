# BR.AI.ON — Ecossistema de Agentes AI Pessoais

Sistema multi-agente autônomo orquestrado pelo Claude Code. Cada agente possui identidade persistente (IDENTITY), estado entre sessões, memória de longo prazo e integração opcional com serviços externos via MCP.

## Quickstart

### 1. Clonar e configurar

```bash
git clone <repo> br-ai-on && cd br-ai-on
cp .env.example .env
```

### 2. Configurar TOTP (autenticação do dashboard)

```bash
node scripts/setup-totp.js
# Escaneie o QR code com Google Authenticator ou 1Password
```

### 3. Instalar dependências do dashboard

```bash
cd dashboard && npm install && cd ..
```

### 4. Iniciar o dashboard

```bash
cd dashboard && npm run dev
# Acessível em http://localhost:3040
```

### 5. (Opcional) Configurar cron de orquestração

```bash
./scripts/setup-cron.sh
# Roda lib/agent-scheduler.py a cada 5 minutos
```

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│                     Orquestrador                        │
│          (scheduling, routing, distribuição)             │
└──────────┬──────────────────────────────┬───────────────┘
           │                              │
    ┌──────▼──────┐                ┌──────▼──────┐
    │  Scheduler  │                │ Inbox Router│
    │  (Python)   │                │ (filesystem)│
    └──────┬──────┘                └──────┬──────┘
           │                              │
     ┌─────▼──────────────────────────────▼─────┐
     │              Agentes                      │
     │  (definidos em agents/_defaults/ ou       │
     │   criados com scripts/create-agent.sh)    │
     └─────┬──────────────┬──────────────┬──────┘
           │              │              │
    ┌──────▼───┐   ┌──────▼───┐   ┌─────▼─────┐
    │ Memória  │   │ Handoffs │   │   Logs    │
    │ sem+epi  │   │  P2P     │   │  JSONL    │
    └──────────┘   └──────────┘   └───────────┘
```

## Agentes

Agentes base em `agents/_defaults/`:

| Agente | Domínio |
|--------|---------|
| **task-manager** | Produtividade, gestão de tarefas |
| **agent-builder** | Meta/Infraestrutura — criação de novos agentes |

Novos agentes são criados com `./scripts/create-agent.sh`. Cada agente define schedule, budget e integrações no seu `config.yaml`.

## Estrutura

```
br-ai-on/
├── agents/
│   ├── _defaults/               # agentes base
│   │   ├── task-manager/
│   │   └── agent-builder/
│   ├── shared/                  # estado compartilhado
│   │   ├── schedule_state.json
│   │   └── archive/
│   └── <nome>/                  # agentes criados
│       ├── IDENTITY.md
│       ├── config.yaml
│       ├── state/
│       │   ├── current_objective.md
│       │   ├── decisions.md
│       │   ├── completed_tasks.md
│       │   └── heartbeat.json
│       ├── memory/
│       │   ├── semantic.md      # fatos e padrões (longo prazo)
│       │   └── episodic.jsonl   # ações com importância 1-5
│       └── handoffs/
│           ├── inbox/
│           └── archive/
├── lib/                         # scripts utilitários
│   ├── agent-scheduler.py       # determina agentes due
│   ├── agent-cron.sh            # cron de 5min
│   ├── orchestrate.sh           # orquestração de sessões
│   ├── logger.sh                # logging JSONL
│   ├── handoff.sh               # comunicação P2P
│   ├── memory.sh                # semântica + episódica
│   ├── metrics.sh               # tokens, latência, custo
│   ├── lock.sh                  # concorrência
│   ├── check_concurrency.sh     # impede sessões duplicadas
│   ├── evaluate.sh              # avaliação de outputs
│   ├── optimize.sh              # otimização de IDENTITYs
│   ├── validate_output.sh       # validação de saída
│   └── feature-request.sh       # gestão de feature requests
├── .claude/skills/              # skills do Claude Code
│   ├── agent-init/              # inicialização de sessão
│   ├── agent-wrapup/            # encerramento de sessão
│   ├── agent-handoff/           # handoffs entre agentes
│   ├── agent-inbox-router/      # roteamento de inbox
│   ├── orchestrator/            # orquestração geral
│   ├── heartbeat/               # heartbeat de agentes
│   ├── channels/                # notificações
│   ├── calendar/                # calendário
│   ├── github-agent/            # operações GitHub
│   └── home/                    # Home Assistant
├── logs/                        # <agente>_YYYY-MM-DD.jsonl
├── metrics/                     # YYYY-MM-DD.jsonl
├── dashboard/                   # Next.js 15 (porta 3040)
├── scripts/                     # scripts utilitários
│   ├── create-agent.sh          # scaffolding de novos agentes
│   └── setup-cron.sh            # configuração do cron
├── AGENTS.md                    # regras operacionais
├── USER.md                      # perfil do usuário
└── CLAUDE.md                    # instruções do projeto
```

## Ciclo de Vida de uma Sessão

```
1. INIT                    2. EXECUÇÃO              3. WRAPUP
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│ Checar budget    │      │ Processar        │      │ Salvar estado    │
│ Carregar IDENTITY│─────▶│ handoffs         │─────▶│ Registrar        │
│ Ler estado       │      │ Executar         │      │   decisões       │
│ Buscar tarefas   │      │   tarefas        │      │ Atualizar memória│
│ Definir objetivo │      │ Interagir        │      │ Logar métricas   │
│ Heartbeat: start │      │   c/ MCPs        │      │ Heartbeat: idle  │
└──────────────────┘      └──────────────────┘      └──────────────────┘
```

Skills do Claude Code: `agent-init` → execução → `agent-wrapup`

## Integrações (opcionais)

O core funciona sem nenhuma integração externa — todo estado é Markdown, YAML e JSONL no filesystem. Integrações são add-ons ativados via `config.yaml` de cada agente.

| Integração | Uso |
|------------|-----|
| **Obsidian** | Inbox bidirecional, notas. Opcional — funciona igualmente com pastas de arquivos locais. |

## Scheduling

O scheduler (`lib/agent-scheduler.py`) roda via cron a cada 5 minutos:

```bash
python3 lib/agent-scheduler.py              # ver status de todos
python3 lib/agent-scheduler.py --mark-ran task-manager
```

Classifica agentes em: `due` | `waiting` | `inactive` | `budget_blocked`

O cron é configurado via `./scripts/setup-cron.sh`.

## Comunicação entre Agentes

**Handoffs P2P** — comunicação direta entre agentes:
```bash
lib/handoff.sh send <from> <to> <expects> [reply_to] [desc] [ctx] [expected]
lib/handoff.sh list <agent>
lib/handoff.sh claim <agent> <arquivo>
lib/handoff.sh archive <agent> <arquivo>
lib/handoff.sh next_id
```

## Observabilidade

- **Dashboard** Next.js em `http://localhost:3040`
- **Logs** JSONL estruturados em `logs/`
- **Métricas** diárias em `metrics/`
- Avaliação de qualidade via `lib/evaluate.sh` e otimização via `lib/optimize.sh`

## Concorrência

- Lock files em `/tmp/agents-workflow/` via `lib/lock.sh`
- Cada agente é dono exclusivo do seu `state/` para escrita
- `lib/check_concurrency.sh` impede sessões duplicadas

## Acesso Remoto via Tailscale

O BR.AI.ON pode ser acessado remotamente de qualquer dispositivo na sua rede Tailscale, permitindo monitorar o dashboard e acessar os agentes de qualquer lugar.

### Setup

1. **Instalar Tailscale** no host que roda o BR.AI.ON (VPS ou desktop):
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```

2. **Autenticar** com sua conta Tailscale e copiar o IP da máquina:
   ```bash
   tailscale ip -4   # ex: 100.x.x.x
   ```

3. **Instalar Tailscale** no dispositivo cliente (laptop, celular) e fazer login com a mesma conta.

### Acessar o Dashboard

Com ambos os dispositivos na mesma rede Tailscale:

```
http://<tailscale-ip>:3040
```

O dashboard Next.js precisa estar rodando no host:
```bash
cd dashboard && npm run dev -- --hostname 0.0.0.0 --port 3040
```

### Acessar os Agentes via SSH

```bash
ssh <user>@<tailscale-ip>
```

Para atalho, adicione ao `~/.ssh/config`:
```
Host braion
  HostName <tailscale-ip>
  User <user>
```

Depois: `ssh braion`

### Executar Sessões Remotas com Claude Code

```bash
ssh braion "cd ~/br-ai-on && claude --dangerously-skip-permissions -p '/agent-init'"
```

Ou interativamente:
```bash
ssh -t braion "cd ~/br-ai-on && claude"
```

## Stack

- **Orquestração**: Claude Code + Bash/Python
- **Dashboard**: Next.js 15, React 19
- **Estado**: Markdown + YAML + JSON no filesystem
- **Logs**: JSONL estruturado
- **Integrações**: MCP (opcionais)
- **Acesso remoto**: Tailscale
- **Hosting**: VPS
