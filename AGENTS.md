# Regras Operacionais dos Agentes

## Ciclo de Vida

1. **Inicialização**: Ler IDENTITY.md + estado persistente + USER.md
2. **Execução**: Processar tarefas conforme objetivo atual
3. **Encerramento**: Salvar estado, registrar decisões, logar métricas

## Estrutura de Diretórios

| Diretório | Descrição |
|-----------|-----------|
| `agents/_defaults/` | Agentes que vêm com o repo (versionados no git) |
| `agents/<nome>/` | Agentes criados pelo usuário (ignorados pelo git) |
| `agents/shared/` | Estado compartilhado entre agentes (versionado) |

## Estrutura de Arquivos

Cada agente em `agents/_defaults/<nome>/` ou `agents/<nome>/`:

```
IDENTITY.md              — identidade e regras do agente
config.yaml              — schedule, budget, integrações
state/
  current_objective.md   — foco atual da sessão
  decisions.md           — log de decisões com data e contexto
  completed_tasks.md     — tarefas concluídas com data
  heartbeat.json         — último ping e status (started | idle)
memory/
  semantic.md            — fatos, preferências e regras aprendidas
  episodic.jsonl         — histórico de ações com importância (1-5)
handoffs/
  inbox/                 — handoffs pendentes de outros agentes
  archive/               — handoffs processados
```

## Logging

Toda execução gera log em `logs/<agente>_YYYY-MM-DD.jsonl` via `lib/logger.sh`:

```bash
AGENT_NAME="<nome>" bash lib/logger.sh "<action>" "<message>" '<metadata_json>'
```

Campos: `timestamp`, `agent`, `action`, `message`, `metadata`, `prompt_version`, `status`.

## Scheduler

`lib/agent-scheduler.py` determina quais agentes devem rodar:

- Lê todos os `agents/*/config.yaml` dinamicamente
- Compara `last_run` (de `agents/shared/schedule_state.json`) com `interval` de cada agente
- Classifica em `due`, `waiting`, `inactive`, `budget_blocked`
- Retorna JSON ordenado por `priority`
- `--mark-ran agent1 agent2` atualiza timestamps e incrementa contadores de budget

```bash
python3 lib/agent-scheduler.py              # status completo
python3 lib/agent-scheduler.py --mark-ran <nome>  # registra execução
```

## Budget

- `max_sessions_per_day` definido no `config.yaml` de cada agente
- Contadores em `/tmp/agent-<nome>-sessions-<YYYY-MM-DD>.count`
- Agentes que atingiram o limite aparecem em `budget_blocked` — não são executados

## Concorrência

- Lock files em `/tmp/agents-workflow/` via `lib/lock.sh`
- Cada agente é dono exclusivo do seu `agents/<nome>/state/` para escrita
- Outros agentes só leem estados alheios, nunca escrevem
- `lib/check_concurrency.sh` impede sessões duplicadas

## Memória

- `semantic.md` — ler no init, atualizar no wrapup se descobriu algo novo
- `episodic.jsonl` — registrar ações importantes (importance 1-5) via `lib/memory.sh log_episodic`

## Comunicação via Obsidian Inbox

Canal assíncrono bidirecional entre usuário e agentes via notas Obsidian.

### Estrutura
- `agents/inbox/` — notas ativas

### Formato da Nota
```yaml
---
to: <agente>        # opcional — se vazio, orchestrator roteia automaticamente
status: pending     # pending | processing | review | done
created: YYYY-MM-DDTHH:MM
assigned_to:        # preenchido pelo roteamento automático
---

Mensagem do usuário aqui
```

### Estados
- `pending` → `processing` → `done` (agente resolve sozinho)
- `pending` → `processing` → `review` → `done` (precisa aprovação)
- `review` → `pending` (usuário devolve com comentário)

### Conversa
Respostas são appendadas na mesma nota com separador `---`:
- Bloco do agente: começa com `**🤖 <nome>** · <timestamp>`
- Bloco do usuário: qualquer texto sem prefixo de agente
- Mensagem pendente: último bloco não é do agente E status != done

### Configuração por agente (`config.yaml`)
```yaml
integrations:
  obsidian:
    enabled: true
    inbox: "agents/inbox"
    identity: "🤖 <nome>"
```

## Schema do config.yaml

```yaml
name: <nome>
# directory field removed — paths resolved dynamically
display_name: <Display Name>
domain: <Domínio>
version: "0.x.0"
model: claude-sonnet-4-6
fallback_model: claude-haiku-4-5
# command opcional: substitui o comando padrão do Claude Code
# command: "ollama launch claude --model kimi-k2.5:cloud"

schedule:
  mode: alive | handoff-only | disabled
  interval: "30m"            # 15m, 1h, 2h, 7d (usado apenas em modo alive)
  priority: 2                # menor = mais prioritário
  run_alone: false           # true = roda sem outros agentes simultâneos

budget:
  max_tokens_per_session: 50000
  max_sessions_per_day: 10

integrations:
  notion:
    enabled: true
  telegram:
    enabled: true
  obsidian:
    enabled: true
    inbox: "agents/inbox"
    identity: "🤖 <nome>"
  # + específicas: calendar, home_assistant, github, habit, expense, notebooklm
```

### Modos de schedule

| Modo | Comportamento |
|------|--------------|
| `alive` | Cron inicia o agente automaticamente quando o intervalo expira |
| `handoff-only` | Agente só acorda quando recebe handoff ou nota no inbox |
| `disabled` | Agente nunca é iniciado automaticamente |

Agentes `handoff-only` ainda podem ser iniciados manualmente ou por handoffs de outros agentes.

Campos específicos por agente (`evaluation`, `optimization`, `targets`) são adicionados conforme necessidade.

## Handoffs Peer-to-Peer

### Estrutura

Arquivo: `agents/<nome>/handoffs/inbox/HO-<YYYYMMDD>-<NNN>_from-<agente>.md`

```yaml
---
id: HO-20260325-001
from: <agente_remetente>
to: <agente_destinatario> | user
created: <timestamp ISO 8601>
status: pending | archived
expects: action | info | review
reply_to: null | <ID do handoff original>
---

## Descricao
## Contexto
## Esperado
```

### Campo `to`

- `to: <agente>` — outro agente precisa executar algo
- `to: user` — resultado/notificação para o usuário; cron arquiva sem iniciar sessão

### Campo `expects`

- `action` — destinatário deve executar algo e pode responder com resultado
- `review` — destinatário deve revisar e pode responder com parecer
- `info` — notificação unidirecional; **cron arquiva automaticamente sem iniciar sessão**

> Nunca responda a `expects: info` — cria loop de ACKs entre agentes.

### Ciclo de Vida

1. **Envio**: `lib/handoff.sh send` deposita no inbox do destinatário
2. **Cron**: se `to: user` ou `expects: info`, arquiva diretamente (sem sessão)
3. **Processamento**: agente executa conforme `expects` (`action > review`)
4. **Resposta** (opcional): apenas se tiver resultado concreto para devolver
5. **Arquivo**: move processados para `handoffs/archive/` no wrapup

```bash
lib/handoff.sh send <from> <to> <expects> [reply_to] [descricao] [contexto] [esperado]
lib/handoff.sh list <agent>
lib/handoff.sh archive <agent> <caminho_arquivo>
lib/handoff.sh next_id
```

## Comando Customizado (Opcional)

O campo `command` no `config.yaml` permite usar um CLI diferente do Claude Code padrão:

```yaml
name: meu-agente
model: claude-sonnet-4-6
# Ou use um comando customizado (ex: Ollama)
command: "ollama launch claude --model kimi-k2.5:cloud"
```

Quando `command` está definido, o orquestrador usa esse comando em vez de `$CLAUDE --model ...`.
Útil para:
- Rodar modelos locais via Ollama
- Usar proxies ou wrappers customizados
- Testar comportamentos com comandos alternativos

## Comunicação

- Notificações via Telegram: alertas de falha, budget, resultados, avaliações
- Comandos via Telegram para controlar agentes (`lib/channels.sh`)
- Logs estruturados JSONL para observabilidade
- Métricas diárias JSONL para analytics (`metrics/YYYY-MM-DD.jsonl`)
- Dashboard web em `dashboard/` (Next.js 15, porta 3040)
- Estado acessível via arquivos para debugging manual

## Orquestrador

- Command: `commands/braion/orchestrator.md`
- Responsável por rodar o scheduler e spawnar subagentes
- Único com permissão de escrita em `agents/shared/`
