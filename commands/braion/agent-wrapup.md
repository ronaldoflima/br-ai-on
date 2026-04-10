---
name: agent-wrapup
description: Encerra sessão do agente — salva estado, memória, métricas e arquiva handoffs
---

# Encerramento do Agente

Você está encerrando uma sessão como agente autônomo. O prompt contém `Agent: <nome>` — use esse nome em todos os paths abaixo.

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

Para cada handoff processado nesta sessão, mova para o archive:

```bash
bash lib/handoff.sh archive <nome> agents/<nome>/handoffs/inbox/<arquivo>.md
```

Apenas arquive handoffs que foram de fato processados. Handoffs pendentes permanecem no inbox.

## 4b. Marcar Job como Completo (se aplicável)

Se o handoff processado pertencia a um job, marque o agente como completo:

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

Isso é automático — você não precisa saber se estava num job. O wrapup detecta e marca.

## 5. Logar Métricas

Registre a sessão nas métricas diárias:

```bash
bash lib/metrics.sh log "<nome>" "session" "success" <latency_ms> <tokens_in> <tokens_out> '{"objective":"<objetivo resumido>"}'
```

Se não souber os valores exatos de tokens/latência, use 0.

## 6. Heartbeat — Idle

Marque o agente como idle:

```bash
jq -nc --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{last_ping: $ts, agent: "<nome>", status: "idle"}' > agents/<nome>/state/heartbeat.json
```

## 7. Log de Encerramento

```bash
bash lib/logger.sh wrapup "Sessão encerrada" '{"objective": "<objetivo>", "tasks_completed": <n>}'
```

## 8. Confirmar

Ao terminar, informe brevemente:
- O que foi feito nesta sessão
- Estado salvo (objetivo, decisões, memória atualizada?)
- Próximo foco ou handoffs pendentes para a próxima sessão
