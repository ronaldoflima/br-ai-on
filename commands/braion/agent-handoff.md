---
name: agent-handoff
description: Processa handoffs pendentes do agente, executa as ações necessárias e termina a sessão
---

# Agent Handoff — Processador de Handoffs

Você foi iniciado para processar handoffs pendentes. Ao terminar, a sessão encerra.

## Contexto da Sessão

O prompt de inicialização contém:
- `Agent:` — seu nome
- `Handoff:` — path completo do arquivo de handoff a processar
- `BR.AI.ON base:` — raiz do repositório br-ai-on
- `Working directory:` — diretório do projeto (pode ser diferente do BR.AI.ON base)

Use `BR.AI.ON base` para todos os paths de estado/memória/logs (`agents/`, `lib/`, `logs/`).
Use `Working directory` como base para edições no projeto.

## 1. Inicializar

```bash
BRAION="<BR.AI.ON base>"
AGENT="<nome>"

# Heartbeat de início
jq -nc --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg a "$AGENT" \
  '{last_ping: $ts, agent: $a, status: "processing"}' \
  > "$BRAION/agents/$AGENT/state/heartbeat.json"
```

## 2. Carregar Estado

O system prompt desta sessão já contém identidade, perfil do usuário, regras operacionais, estado persistente (objetivo, decisões, tarefas), memória semântica e episódica, e handoffs pendentes do inbox.

## 3. Processar o Handoff

O arquivo do handoff foi passado no prompt (`Handoff:`). Use-o diretamente.

**a) Claim** — mova para in_progress antes de qualquer trabalho:
```bash
new_path=$(bash "$BRAION/lib/handoff.sh" claim "$AGENT" "<handoff_file>")
```
Use `$new_path` em todas as operações subsequentes.

**b) Obter diretório de artefatos** — use para qualquer arquivo gerado (relatórios, exports, etc.):
```bash
artifacts_dir=$(bash "$BRAION/lib/handoff.sh" artifacts-dir "$AGENT" "<ho_id>")
```
Salve todos os artefatos gerados em `$artifacts_dir/`. Informe os paths no resumo final.

**c) Leia o arquivo** (frontmatter + corpo) e identifique: `from`, `expects`, `description`, `context`, `expected`, `thread_id`

Se `thread_id` estiver presente no frontmatter, carregue o historico da thread antes de processar:
```bash
thread_ctx=$(bash "$BRAION/lib/handoff.sh" thread-history "<thread_id>")
```
Use `$thread_ctx` como contexto adicional para entender o historico da conversa antes de executar a acao.

**d) Execute** a ação conforme seu SOUL e o conteúdo do handoff

**e) Responda ou notifique** — apenas se `expects` for `action` ou `review` E você tiver resultado concreto:

Para responder ao agente remetente:
```bash
bash "$BRAION/lib/handoff.sh" send "$AGENT" "<from>" info "<ho_id>" "<resumo>" "<resultado>" "<próximos passos>"
```

Para notificar o usuário (quando o resultado exige ação humana):
```bash
bash "$BRAION/lib/handoff.sh" send "$AGENT" user info "<ho_id>" "<resumo>" "<resultado>" "<próximos passos>"
```

Se o handoff original tinha `thread_id` e/ou `job_id`, passe-os como parâmetros 8 e 9 ao responder:
```bash
bash "$BRAION/lib/handoff.sh" send "$AGENT" "<from>" info "<ho_id>" "<resumo>" "<resultado>" "<proximos passos>" "<thread_id>" "<job_id>"
```
Isso garante que a thread continua rastreável e que o job pode ser monitorado pelo cron.

> **NUNCA responda a handoffs com `expects: info`** — são notificações unidirecionais. O cron arquiva automaticamente sem iniciar sessão. Responder cria loop infinito de ACKs.
>
> Prefira `to: user` a `to: <agente>` quando o destinatário real é o usuário. Use `to: <agente>` só quando o outro agente precisa executar algo.

**f) Modo Waiting (peer-to-peer ou escalation)**

Se durante o processamento você precisar de informação de outro agente:

**Consulta simples (expects=info)** — envie peer-to-peer direto:
```bash
bash "$BRAION/lib/handoff.sh" send "$AGENT" "<agente_destino>" info null \
  "<pergunta>" "<contexto>" "<o que precisa>"
```

**Coordenação complexa (expects=orchestrate)** — escale para o orchestrator:
```bash
bash "$BRAION/lib/handoff.sh" send "$AGENT" orchestrator orchestrate null \
  "[escalation] <descrição>" "<contexto>" "<resultado esperado>"
```

Após enviar o handoff, entre em modo waiting:
```bash
jq -nc --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg a "$AGENT" --arg ho "<HO_ID_enviado>" \
  '{last_ping: $ts, agent: $a, status: "waiting", waiting_for: $ho, waiting_since: $ts}' \
  > "$BRAION/agents/$AGENT/state/heartbeat.json"
```

**NÃO faça wrapup nem mate a sessão.** Aguarde na sessão — o cron injetará o path do reply quando chegar. Ao receber o reply, leia o handoff e continue o processamento normalmente.

> O timeout de waiting é de 30 minutos (configurável via WAITING_TIMEOUT). Se expirar, o cron mata a sessão.

**g) Notificar** — se a ação for crítica ou precisar de atenção do usuário:
```bash
bash "$BRAION/lib/handoff.sh" send "$AGENT" user info "<ho_id>" "<resumo>" "<resultado>" "<próximos passos>"
```

## 4. Salvar Estado (Checkpoint)

Salve o estado imediatamente após o processamento. Este é o primeiro checkpoint — o wrapup fará o segundo.

- Escreva/appende em `<BR.AI.ON base>/agents/<nome>/state/decisions/YYYY-MM-DD.md` (data UTC de hoje) as decisões tomadas
- Se aprendeu algo novo, atualize `<BR.AI.ON base>/agents/<nome>/memory/semantic.md`
- Se houve mudança de foco, escreva `<BR.AI.ON base>/agents/<nome>/state/current_objective/YYYY-MM-DD.md` (data UTC de hoje)

```bash
bash "$BRAION/lib/memory.sh" log_episodic "<ação>" "<contexto>" "<resultado>" <importancia>
bash "$BRAION/lib/logger.sh" "$AGENT" "Handoffs processados" '{"count": N}'
```

## 5. Heartbeat — Awaiting Review

**NÃO archive o handoff e NÃO mate a sessão.** O handoff permanece em `in_progress/` e a sessão fica aberta para o usuário interagir.

```bash
jq -nc --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg a "$AGENT" \
  '{last_ping: $ts, agent: $a, status: "awaiting_review", waiting_since: $ts}' \
  > "$BRAION/agents/$AGENT/state/heartbeat.json"
```

Informe ao usuário:
- O que foi feito
- Que a sessão está aberta para review/interação
- Que o `/braion:agent-wrapup` será executado automaticamente pelo cron quando a sessão ficar idle, ou pode ser chamado manualmente

> O cron respeita o status `awaiting_review` e não mata a sessão. O timeout padrão é 3 dias (REVIEW_TIMEOUT). Quando o timeout expira ou o usuário encerra a interação, o cron envia `/braion:agent-wrapup` que detecta o status e faz o wrapup completo (archive + encerramento).
