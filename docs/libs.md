# Bibliotecas (lib/)

Scripts utilitários compartilhados por todos os agentes e pelo cron.

## Abstração de Backend

### cli.sh
Camada de abstração entre o projeto e o CLI AI concreto. **Nenhum outro script deve ter paths, modelos ou flags hardcoded** — tudo passa por `cli.sh`.

Variável `CLI_BACKEND` (padrão: `claude`) controla o backend globalmente. Backends suportados: `claude`, `codex` (parcial), `gemini` (futuro).

**API pública:**

| Categoria | Funções |
|-----------|---------|
| Availability | `cli_check_available`, `cli_default_model`, `cli_fallback_model`, `cli_valid_models` |
| Session | `cli_build_start_cmd`, `cli_send_command`, `cli_send_slash_command`, `cli_send_clear`, `cli_wait_ready` |
| State | `cli_session_is_idle`, `cli_session_clear_idle`, `cli_prompt_glyph`, `cli_busy_patterns` |
| Paths | `cli_config_dir`, `cli_commands_install_dir`, `cli_hook_config_path`, `cli_projects_dir` |
| Hooks | `cli_hook_register`, `cli_hook_event_name` |
| Permissions | `cli_permission_mode_map`, `cli_permission_mode_default` |

**Mapeamento de permissions (genérico → backend):**
- `auto` / `confirm` / `bypass` → traduzidos para o modo nativo do backend ativo
- Valores legados (`acceptEdits`, `bypassPermissions`, etc.) aceitos com retrocompat

```bash
source lib/cli.sh
cli_default_model          # → claude-sonnet-4-6
cli_permission_mode_map "auto"  # → auto (claude) ou equivalente
cli_build_start_cmd "$model" "$perm" "$sp_file" "$verbose"
```

## Orquestração

### agent-cron.sh
Orquestrador principal, roda a cada 5min via cron. Responsável por:
- Sincronizar vault Obsidian (git pull)
- Rotear notas do inbox para agentes (regras + AI fallback)
- Processar handoffs pendentes (iniciar sessões ou arquivar)
- Iniciar agentes "alive" que estão prontos (via scheduler)
- Monitorar sessões ociosas (kill automático removido na v1.3.0)
- Construir system prompt com estado, memória, handoffs e collaborators (`build_agent_system_prompt`)
- Suporte a `permission_mode` via `runtime.permission_mode` (lê legado `runtime.claude.*` com retrocompat)
- Detecção de processo Telegram filtrada por usuário (`pgrep -u`)
- Usa `cli.sh` para modelos, permissões, waiting e slash commands

### agent-scheduler.py
Engine de scheduling em Python. Lê todos os `config.yaml`, compara intervalos com `schedule_state.json`, e retorna JSON com agentes categorizados:
- `due` — prontos para execução (inclui `permission_mode` no output)
- `waiting` — intervalo não expirou
- `inactive` — mode disabled/handoff-only
- `budget_blocked` — limite diário atingido

Consulta `lib/cli.sh` via subprocess para modelos default/fallback. Suporta retrocompat `runtime.claude.permission_mode` → `runtime.permission_mode`.

```bash
python3 lib/agent-scheduler.py              # status completo
python3 lib/agent-scheduler.py --mark-ran <nome>  # registra execução
```

## Comunicação

### telegram.sh
Biblioteca compartilhada para envio de mensagens Telegram. Centraliza `tg_send` e `tg_typing` usadas pela bridge, hook e cron. Funciona como lib (source) e como comando direto.

**Como lib** (fail-silent: no-op se token/chat_id ausentes):
```bash
source lib/telegram.sh
tg_send "mensagem"                    # usa TELEGRAM_ALLOWED_CHAT_ID do .env
tg_send "mensagem" "$chat_id"         # chat_id explícito
tg_typing                             # indicador de digitação
tg_typing "$chat_id"
```

**Como comando** (fail-loud: erro se token ausente):
```bash
bash lib/telegram.sh send "mensagem"              # chat padrão do .env
bash lib/telegram.sh send "mensagem" --chat-id ID # chat específico
bash lib/telegram.sh typing
bash lib/telegram.sh typing --chat-id ID
```

Chunking automático em 4000 chars. `tg_notify` é alias de `tg_send` (backward compat).

### handoff.sh
Sistema de handoffs peer-to-peer entre agentes.

```bash
lib/handoff.sh send <from> <to> <expects> [reply_to] [desc] [ctx] [expected]
lib/handoff.sh list <agent>          # listar pendentes
lib/handoff.sh claim <agent> <path>  # mover para in_progress
lib/handoff.sh archive <agent> <path>
lib/handoff.sh thread-history <id>   # histórico da thread
lib/handoff.sh next_id               # gerar próximo ID
```

### job.sh
Coordenação de jobs paralelos (fan-out/fan-in).

```bash
lib/job.sh create <by> <desc> <agent1,agent2,...>
lib/job.sh complete <job_id> <agent> [handoff_id]
lib/job.sh fail <job_id> <agent> [reason]
lib/job.sh status <job_id>
lib/job.sh list-pending
lib/job.sh archive <job_id>
```

## Concorrência

### lock.sh
Locks distribuídos para sincronização de recursos.

```bash
lib/lock.sh acquire <agent> [resource]  # 3 retries, 5s sleep, 30s timeout
lib/lock.sh release <agent> [resource]
lib/lock.sh status [resource]
```

### check_concurrency.sh
Previne execução simultânea do mesmo agente via lock files em `/tmp/agents-workflow/`.

## Observabilidade

### logger.sh
Logging estruturado JSONL. Cada ação gera uma linha em `logs/<agent>_YYYY-MM-DD.jsonl`.

```bash
AGENT_NAME="<nome>" bash lib/logger.sh "<action>" "<message>" '<metadata_json>'
```

### metrics.sh
Métricas de performance em `metrics/YYYY-MM-DD.jsonl`.

```bash
# Log automático (chamado pelo logger.sh)
# Funções: metrics_log, metrics_summary, metrics_agent_summary
```

### evaluate.sh
Avaliação de qualidade dos logs com scoring determinístico e relatórios diários/semanais.

## Memória

### memory.sh
Memória local do agente — episódica e cache.

```bash
AGENT_NAME="<nome>" bash lib/memory.sh log_episodic "<action>" "<ctx>" "<outcome>" <importance>
AGENT_NAME="<nome>" bash lib/memory.sh search_episodic "<keyword>"
AGENT_NAME="<nome>" bash lib/memory.sh cache_get "<key>"
AGENT_NAME="<nome>" bash lib/memory.sh cache_set "<key>" '<value>' [ttl_seconds]
```

## Otimização

### optimize.sh
Versionamento e otimização de prompts (IDENTITY.md).

```bash
lib/optimize.sh version_snapshot <agent>
lib/optimize.sh create_proposal <agent> <type> <desc>
lib/optimize.sh rollback <agent> <version>
lib/optimize.sh audit_prompt_sizes
```

### validate_output.sh
Validação de outputs: existência, tamanho mínimo, sintaxe YAML/JSON, permissão de diretório.

## Outros

### feature-request.sh
CLI interativo para enviar feature requests ao braion-maintainer.

### obsidian-commit.sh
Auto-commit de mudanças no vault Obsidian.

### orchestrate.sh
**(Deprecated)** — funcionalidade migrada para `handoff.sh`.
