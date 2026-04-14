---
name: agent-wrapup
description: Encerra sessão do agente — salva estado, memória, métricas e arquiva handoffs
---

# Encerramento do Agente

Você está encerrando uma sessão como agente autônomo. O prompt contém `Agent: <nome>` — use esse nome em todos os paths abaixo.

## 0. Detectar Modo

Leia o heartbeat atual do agente para determinar o modo de execução:

```bash
current_status=$(jq -r '.status // ""' agents/<nome>/state/heartbeat.json 2>/dev/null || echo "")
has_in_progress=$(ls agents/<nome>/handoffs/in_progress/HO-*.md 2>/dev/null | head -1)
```

| Condição | Modo | Comportamento |
|----------|------|---------------|
| `status == "awaiting_review"` | **full** | Segunda chamada após review — arquiva handoffs, encerra sessão |
| `has_in_progress` não vazio E `status != "awaiting_review"` | **review** | Primeira chamada com handoff processado — salva estado, NÃO arquiva, NÃO encerra |
| Nenhuma das anteriores | **full** | Sessão sem handoff (alive) — comportamento padrão |

Guarde o modo (`review` ou `full`) para os passos seguintes.

## 1. Salvar Estado Persistente

### Objetivo da Sessão

Atualize `agents/<nome>/state/current_objective.md` refletindo o que foi ou não concluído:
- O foco continua válido para a próxima sessão? Mantenha.
- Foi concluído? Substitua pelo próximo foco ou indique "aguardando próximo ciclo".

### Decisões

Appende em `agents/<nome>/state/decisions.md` qualquer decisão relevante tomada nesta sessão:

```
## YYYY-MM-DD HH:MM UTC
- <decisão tomada e contexto resumido>
```

Mantenha apenas as últimas ~20 entradas — remova as mais antigas se necessário.

### Tarefas Concluídas

Appende em `agents/<nome>/state/completed_tasks.md` as tarefas finalizadas nesta sessão:

```
## YYYY-MM-DD
- <tarefa concluída>
```

Mantenha apenas as últimas ~30 entradas.

## 2. Atualizar Memória Semântica

Leia `agents/<nome>/memory/semantic.md` e atualize **somente se** descobriu algo novo nesta sessão:
- Nova preferência do usuário
- Novo padrão observado
- Nova regra aprendida de uma correção

Não reescreva o que já está lá. Apenas adicione entradas novas nas seções corretas.

## 3. Registrar Memória Episódica

Registre as ações mais significativas da sessão (importance 1-5):

```bash
AGENT_NAME="<nome>" bash lib/memory.sh log_episodic "<action>" "<contexto resumido>" "<resultado>" <importance>
```

Critério de importance:
- 1 — rotina sem novidades
- 2 — ciclo normal com resultado
- 3 — ação relevante ou decisão tomada
- 4 — evento importante ou mudança de estado
- 5 — crítico, erro grave ou decisão estratégica

## 4. Arquivar Handoffs Processados

> **Modo `review`**: pule este passo inteiro. Os handoffs permanecem em `in_progress/` para que o usuário possa revisar antes do encerramento final.

> **Modo `full`**: archive todos os handoffs processados — tanto do inbox quanto do in_progress:

```bash
for ho_file in agents/<nome>/handoffs/inbox/HO-*.md agents/<nome>/handoffs/in_progress/HO-*.md; do
  [ -f "$ho_file" ] || continue
  bash lib/handoff.sh archive <nome> "$ho_file"
done
```

## 4b. Marcar Job como Completo (se aplicável)

> **Modo `review`**: pule este passo.

> **Modo `full`**: se o handoff pertencia a um job, marque como completo:

```bash
for ho_file in agents/<nome>/handoffs/in_progress/HO-*.md agents/<nome>/handoffs/archive/HO-*.md; do
  [ -f "$ho_file" ] || continue
  job_id=$(bash lib/handoff.sh job-agent "$ho_file")
  if [ -n "$job_id" ]; then
    bash lib/job.sh complete "$job_id" "<nome>"
    break
  fi
done
```

## 5. Logar Métricas

Registre a sessão nas métricas diárias:

```bash
bash lib/metrics.sh log "<nome>" "session" "success" <latency_ms> <tokens_in> <tokens_out> '{"objective":"<objetivo resumido>"}'
```

Se não souber os valores exatos de tokens/latência, use 0.

## 6. Heartbeat

### Modo `review`:

Marque o agente como `awaiting_review` — o cron respeitará este status e não matará a sessão:

```bash
jq -nc --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{last_ping: $ts, agent: "<nome>", status: "awaiting_review", waiting_since: $ts}' > agents/<nome>/state/heartbeat.json
```

### Modo `full`:

Marque o agente como idle:

```bash
jq -nc --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{last_ping: $ts, agent: "<nome>", status: "idle"}' > agents/<nome>/state/heartbeat.json
```

## 7. Log de Encerramento

```bash
bash lib/logger.sh wrapup "Sessão encerrada" '{"objective": "<objetivo>", "tasks_completed": <n>, "mode": "<review|full>"}'
```

## 8. Notificar via Telegram

Verifique se o agente tem Telegram habilitado no config.yaml (`integrations.telegram.enabled: true`). Se sim:

### Modo `review`:
```bash
bash lib/telegram.sh send "⏸️ [<nome>] Sessão em review — <resumo curto>. Sessão aberta para interação (timeout: 3d)"
```

### Modo `full`:
```bash
bash lib/telegram.sh send "✅ [<nome>] Sessão encerrada — <n> tarefa(s) concluída(s). <resumo curto do que foi feito>"
```

Se `integrations.telegram.enabled` for `false` ou não existir, pule este passo.

## 9. Confirmar

### Modo `review`:
Informe brevemente:
- O que foi feito nesta sessão
- Estado salvo (checkpoint)
- Que a sessão está **aberta para review** — o usuário pode interagir
- Que o wrapup final será executado automaticamente pelo cron quando ficar idle, ou pode ser chamado manualmente com `/braion:agent-wrapup`

### Modo `full`:
Informe brevemente:
- O que foi feito nesta sessão
- Estado salvo (objetivo, decisões, memória atualizada?)
- Próximo foco ou handoffs pendentes para a próxima sessão
