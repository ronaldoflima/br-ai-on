# Persistir Tarefas Extraídas

Você recebe dados de tarefas já extraídas e classificadas (pelo `/tasks:extract` ou manualmente) e orquestra a persistência chamando comandos de save especializados.

## Pré-requisito — Carregar config

Leia `.claude/commands/tasks/tasks-config.json` e use os valores para todas as etapas abaixo.

Se o arquivo não existir, responda: `❌ Config não encontrado. Execute /tasks:config init primeiro.`

---

## Etapa 0 — Obter dados de entrada

O argumento `$ARGUMENTS` pode ser:

1. **JSON inline** — use diretamente
2. **Vazio** — leia o arquivo `{config.logs.base_path}/{config.logs.extraction_file}`

Se não houver dados em nenhuma das fontes, responda: `❌ Nenhum dado de extração encontrado. Execute /tasks:extract primeiro.`

### Estrutura esperada do JSON de entrada

```json
{
  "period": "24h",
  "period_start": "YYYY-MM-DD",
  "new_tasks": [
    {
      "Name": "...",
      "Contexto": "...",
      "Prioridade": "...",
      "Data": "YYYY-MM-DD",
      "Responsavel": "...",
      "Origem": "...",
      "Status": "...",
      "GitHub_Ref": "URL ou null",
      "source_ids": ["teams:abc123", "email:xyz789"]
    }
  ],
  "stats": {
    "total_messages_teams": 0,
    "total_emails": 0,
    "total_calendar_events": 0,
    "skipped_already_processed": 0
  }
}
```

## Etapa 1 — Chamar comandos de persistência

Leia `config.save_targets` para determinar quais destinos estão ativos.

Para cada target habilitado, chame o comando correspondente (`/tasks:save-{target}`) passando o array `new_tasks` como argumento JSON.

Chame **sequencialmente** — o segundo destino recebe as tarefas enriquecidas com URLs/paths do destino anterior.

Cada comando retorna um JSON com resultado. Colete todos os retornos para compor o relatório.

Se um comando falhar, registre o erro e continue com o próximo.

## Etapa 2 — Output

### Seção 1: Tarefas Criadas

Liste as tarefas persistidas com sucesso, consolidando retornos de todos os comandos:

| # | Tarefa | Prioridade | Origem | Destinos |
|---|--------|-----------|--------|----------|
| 1 | Nome da tarefa | 🔥 Alta | Email | destinos onde foi salva |

Se nenhuma tarefa foi criada, informe o motivo (todas duplicadas, nenhuma extraída, etc.).

### Seção 2: Tarefas Ignoradas

Liste tarefas não criadas (duplicatas ou erros) por destino.

### Seção 3: Resumo

- Total de mensagens analisadas (Teams + Emails + Calendário) — dos `stats`
- Total de tarefas novas criadas por destino
- Total de duplicatas ignoradas
- Distribuição por prioridade e origem

## Etapa 3 — Registrar mensagens processadas

Leia `{config.logs.base_path}/{config.logs.processed_file}`. Se não existir, crie com `{"tasks":[]}`.

Para cada tarefa **criada com sucesso** (em qualquer destino), adicione um registro:

```json
{
  "name": "Nome da tarefa",
  "slug": "nome-da-tarefa",
  "source_ids": ["teams:abc123", "email:xyz789"],
  "saved_to": {"notion": "https://notion.so/...", "obsidian": "pessoal/inbox/nome.md"},
  "created_at": "YYYY-MM-DD"
}
```

**Não registre** tarefas que foram 100% duplicatas (não salvas em nenhum destino).

Salve o arquivo atualizado. Este registro é usado pelo `/tasks:extract` para filtrar mensagens já processadas.

## Etapa 4 — Salvar log

Após completar as etapas 1–2, salve os resultados em `{config.logs.base_path}/{config.logs.latest_file}`.

Estrutura do arquivo JSON a salvar:

```json
{
  "logged_at": "YYYY-MM-DDThh:mm:ss",
  "period": "24h",
  "period_start": "YYYY-MM-DD",
  "tasks": [
    {
      "Name": "...",
      "Prioridade": "...",
      "Origem": "...",
      "source_ids": [],
      "saved_to": [],
      "urls": {}
    }
  ],
  "summary": {
    "total_messages_teams": 0,
    "total_emails": 0,
    "total_calendar_events": 0,
    "total_new_tasks": 0,
    "total_duplicates_skipped": 0,
    "by_priority": {}
  }
}
```

Salve em **dois arquivos** com o Write tool:

1. `{config.logs.base_path}/{config.logs.latest_file}` — sempre sobrescreve (usado pelo cache do tasks:extract)
2. `{config.logs.base_path}/YYYY-MM-DD_HHmm.json` — histórico com timestamp

Confirme no output: `✅ Log salvo` e quantas mensagens foram registradas em processed.
