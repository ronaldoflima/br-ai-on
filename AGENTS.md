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
  heartbeat.json         — último ping e status (processing | idle | waiting | completed)
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
- Compara `last_run` (de `agents/shared/schedule_state.json`) com `interval` ou `cron` de cada agente
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

### Modos de schedule

| Modo | Comportamento |
|------|--------------|
| `alive` | Cron inicia o agente automaticamente quando o intervalo ou expressão cron expira |
| `handoff-only` | Agente só acorda quando recebe handoff ou nota no inbox |
| `disabled` | Agente nunca é iniciado automaticamente |

Agentes `handoff-only` ainda podem ser iniciados manualmente ou por handoffs de outros agentes.

Campos específicos por agente (`evaluation`, `optimization`, `targets`) são adicionados conforme necessidade.

## Handoffs Peer-to-Peer

Usar $BRAION/lib/handoff.sh — Helper para handoffs entre agentes
A config colaborators do config pode ter lista de agentes prováveis para contribuir

### Uso:
 - handoff.sh send <from> <to> <expects> [reply_to] [descricao] [contexto] [esperado] [thread_id] [job_id]

#### Campo `to`

- `to: <agente>` — outro agente precisa executar algo
- `to: user` — resultado/notificação para o usuário; cron arquiva sem iniciar sessão

#### Campo `expects`

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
lib/handoff.sh send <from> <to> <expects> [reply_to] [descricao] [contexto] [esperado] [thread_id] [job_id]
lib/handoff.sh list <agent>
lib/handoff.sh archive <agent> <caminho_arquivo>
lib/handoff.sh next_id
```

## Working Directory

O campo `working_directory` no `config.yaml` define o diretório de trabalho da sessão do agente.

Formato simples (string):
```yaml
working_directory: /caminho/absoluto
```

Formato com diretórios adicionais (objeto):
```yaml
working_directory:
  primary: /caminho/principal
  additional:
    - /caminho/extra1
    - /caminho/extra2
```

- `primary` é usado como PWD da sessão tmux (diretório de trabalho do Claude Code)
- `additional` são passados como `--add-dir` ao Claude Code, dando acesso de leitura/escrita a esses diretórios
- Se omitido, o padrão é o diretório base do br-ai-on (`$BRAION`)
- Retrocompatível: `directory` (campo legado) continua funcionando como alias

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

### Telegram — Notificação Direta

Qualquer agente pode enviar mensagem ao usuário via Telegram usando `lib/telegram.sh`:

```bash
# Enviar mensagem para o chat padrão (TELEGRAM_ALLOWED_CHAT_ID)
bash lib/telegram.sh send "mensagem aqui"

# Enviar para chat específico
bash lib/telegram.sh send "mensagem" --chat-id 12345

# Indicador de digitação
bash lib/telegram.sh typing
```

**Quando usar notificação direta vs handoff:**

| Cenário | Usar |
|---|---|
| Alerta urgente, erro, confirmação rápida | `lib/telegram.sh send` |
| Resultado de tarefa, relatório, entregável | `lib/handoff.sh send ... user` |
| Notificação de progresso (longa) | `lib/telegram.sh send` |

A lib carrega `TELEGRAM_BOT_TOKEN` e `TELEGRAM_ALLOWED_CHAT_ID` do `.env` automaticamente.
Respeita o campo `integrations.telegram.enabled` do `config.yaml` — agentes devem verificar antes de enviar.

## Orquestrador

- Agente: `agents/_defaults/orchestrator/` (symlink em `agents/orchestrator/`)
- Command interativo: `commands/braion/orchestrator.md`
- Responsável por decompor objetivos, fan-out/fan-in, e coordenar colaboração
- Único com permissão de escrita em `agents/shared/`

## Jobs — Trabalho Paralelo

### Conceito

Um **job** agrupa múltiplos handoffs sob um mesmo objetivo. O orchestrator cria jobs para fan-out paralelo; o cron monitora conclusão para fan-in.

### Estrutura

```
agents/shared/jobs/JOB-YYYYMMDD-NNN.json
agents/shared/jobs/archive/
```

### API

```bash
bash lib/job.sh create <created_by> <description> <agent1,agent2,...>
bash lib/job.sh complete <job_id> <agent> [handoff_id]
bash lib/job.sh fail <job_id> <agent> [reason]
bash lib/job.sh status <job_id>
bash lib/job.sh list-pending
bash lib/job.sh archive <job_id>
```

### Ciclo de Vida

`pending → in_progress → completed | partial_failure`

### Integração

Handoffs de job incluem `job_id` no frontmatter. O `agent-wrapup` detecta automaticamente e chama `job.sh complete`.

## Colaboração entre Agentes

### expects: orchestrate

Novo valor de `expects` para escalar ao orchestrator:

| expects | Significado | Processado por |
|---|---|---|
| `action` | Executa tarefa | Agente destino |
| `review` | Revisa e opina | Agente destino |
| `info` | Notificação unidirecional | Cron arquiva |
| `orchestrate` | Decomponha e coordene | Orchestrator |

### Modo Waiting

Quando um agente envia handoff e precisa da resposta para continuar, ele entra em `waiting`:

```json
{"status": "waiting", "waiting_for": "HO-xxx", "waiting_since": "..."}
```

O cron respeita sessões em `waiting` com timeout maior (`WAITING_TIMEOUT`, default 1800s). Quando o reply chega, o cron injeta o path na sessão ativa:

```bash
tmux send-keys -t "braion-<agent>" "/braion:agent-inbox-router <path>" Enter
```

### Peer-to-Peer vs Orchestrator

- **Consulta simples** (info de outro domínio): envie `expects=info` direto para o agente
- **Coordenação complexa** (múltiplos agentes): envie `expects=orchestrate` para o orchestrator
