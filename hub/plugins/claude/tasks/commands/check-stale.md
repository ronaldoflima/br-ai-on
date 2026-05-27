# Verificar Tarefas Abertas (Proativo)

Você verifica tarefas abertas há mais de um threshold configurável, busca contexto adicional em múltiplas fontes, e notifica o usuário com uma análise do estado atual — **sem modificar nenhuma tarefa**.

## Pré-requisito — Carregar config

Leia `.claude/commands/tasks/tasks-config.json` e use `config.obsidian` e `config.proactive` para todas as etapas abaixo.

Se `config.proactive.enabled` for `false`, responda: `⏭️ Check proativo desabilitado no config.` e retorne.

---

## Etapa 1 — Listar tarefas abertas no Obsidian

Use `obsidian_list_notes` no path `{config.obsidian.vault_path}` para listar todas as notas.

Para cada nota, use `obsidian_read_note` (ou `obsidian_extract_frontmatter` se disponível) para extrair o frontmatter.

### Filtros

Inclua apenas tarefas que atendam **todos** os critérios:
- `status` contém "Pendente" ou "Em progresso" (case-insensitive, ignora emojis)
- `created` existe e é uma data válida
- A diferença entre agora e `created` é maior que `config.proactive.stale_threshold_hours` (default: 3h)

### Resultado

Monte uma lista de tarefas stale com: `name`, `path`, `status`, `prioridade`, `origem`, `contexto`, `created`, `age_hours`.

Se nenhuma tarefa atender aos critérios, responda: `✅ Nenhuma tarefa aberta acima do threshold ({threshold}h).` e retorne.

---

## Etapa 2 — Buscar contexto adicional

Para **cada tarefa stale**, busque contexto em paralelo nas seguintes fontes:

### 2a. Work Artifacts (PRs, commits)

Use `work_artifacts_search_search` com query baseada no `Name` e `contexto` da tarefa. Filtro de data: `created` da tarefa até agora.

Extraia: PRs relacionadas, commits, status de PRs (merged/open/closed).

### 2b. Conversation History

Use `conversation_history_search_search` com query baseada no `Name` da tarefa.

Extraia: sessões recentes que mencionaram o tema, decisões tomadas, próximos passos discutidos.

### 2c. Microsoft 365 (Teams + Email)

Use `outlook_email_search` e `chat_message_search` com query baseada no `Name` da tarefa. Filtre por data recente (últimas `config.proactive.m365_lookback_hours` horas, default: 24h).

Extraia: mensagens recentes sobre o tema, resoluções mencionadas, novos pedidos.

---

## Etapa 3 — Analisar e classificar

Para cada tarefa, com base no contexto coletado, classifique em uma das categorias:

| Categoria | Critério |
|-----------|----------|
| `likely_resolved` | Encontrou PR merged, mensagem de conclusão, ou confirmação explícita |
| `in_progress` | Encontrou PR aberta, commits recentes, ou discussão ativa |
| `blocked` | Encontrou menção a bloqueio, dependência, ou aguardando algo |
| `no_context` | Nenhum contexto adicional encontrado nas fontes |
| `needs_attention` | Tarefa antiga sem progresso aparente e com prioridade alta |

---

## Etapa 4 — Notificar o usuário

Envie **uma única notificação** consolidada via `gateway_send_notification` com o resumo de todas as tarefas analisadas.

### Formato da notificação

```
📋 Tarefas abertas há mais de {threshold}h — {count} encontrada(s)

{Para cada tarefa:}
━━━━━━━━━━━━━━━━━━━━
📌 {Name}
⏰ Aberta há {age_hours}h | {Prioridade} | {Origem}
🔍 Status inferido: {categoria}

{Se likely_resolved:}
✅ Parece resolvida: {evidência}
💡 Sugestão: verificar e marcar como concluída

{Se in_progress:}
🔄 Em andamento: {evidência}
💡 Sugestão: {próximo passo inferido}

{Se blocked:}
🚫 Possível bloqueio: {evidência}
💡 Sugestão: {ação para desbloquear}

{Se no_context:}
❓ Sem contexto adicional encontrado
💡 Sugestão: revisar manualmente — pode estar esquecida

{Se needs_attention:}
⚠️ Prioridade alta sem progresso
💡 Sugestão: priorizar ou delegar
━━━━━━━━━━━━━━━━━━━━
```

### Regras da notificação

- Máximo `config.proactive.max_tasks_per_notification` tarefas (default: 10)
- Se houver mais, agrupe as restantes como "e mais N tarefas..."
- Priorize tarefas `needs_attention` e `blocked` no topo
- Use markdown compatível com Telegram (sem HTML)

---

## Etapa 5 — Retornar resultado

Responda com JSON estruturado:

```json
{
  "checked_at": "ISO timestamp",
  "threshold_hours": 3,
  "total_open_tasks": 0,
  "total_stale": 0,
  "results": [
    {
      "name": "...",
      "path": "...",
      "age_hours": 0,
      "category": "likely_resolved|in_progress|blocked|no_context|needs_attention",
      "evidence": "resumo do contexto encontrado",
      "suggestion": "próximo passo sugerido"
    }
  ],
  "notification_sent": true
}
```

---

## Regras Gerais

1. **NUNCA modifique tarefas** — este comando é somente leitura + notificação
2. **NUNCA marque tarefas como concluídas** — apenas sugira ao usuário
3. Respeite rate limits — se houver muitas tarefas, processe em batches
4. Se uma fonte de contexto falhar, continue com as demais e mencione na análise
5. Log de execução: registre stats em `{config.logs.base_path}/check-stale-latest.json`
