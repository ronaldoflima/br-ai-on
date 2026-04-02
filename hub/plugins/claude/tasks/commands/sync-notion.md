# Sincronizar Tarefas no Notion

Você recebe um array de updates de status e aplica as atualizações nas páginas correspondentes do Notion.

## Pré-requisito — Carregar config

Leia `.claude/commands/tasks/tasks-config.json` e use `config.notion` para todas as etapas abaixo.

Se `config.notion.enabled` for `false`, responda: `⏭️ Notion desabilitado no config.` e retorne JSON vazio.

---

## Etapa 0 — Parsear entrada

O argumento `$ARGUMENTS` é um JSON array de updates:

```json
[
  {
    "task_name": "Nome ou slug da tarefa",
    "new_status": "✅ Concluído | 🔄 Em progresso | ❌ Cancelado",
    "notes": "Contexto adicional (opcional)",
    "source": "conversa | manual"
  }
]
```

Se o array estiver vazio ou inválido, responda: `⏭️ Nenhuma atualização para sincronizar no Notion.`

## Etapa 1 — Localizar tarefas

Para cada update, busque a tarefa correspondente no database `config.notion.database_id`:

- Busque pelo `config.notion.properties.name` usando o `task_name`
- Aceite match se similaridade > 0.7 (considere slugs, variações de acentuação, prefixos)
- Colete: `page_id`, nome atual, status atual, URL da página

Se não encontrar, marque como `not_found`.

## Etapa 2 — Aplicar atualizações

Para cada tarefa encontrada, atualize a página com `notion_update_page`:

- **`config.notion.properties.status`**: mapeie usando `config.notion.status_values`:
  - `✅ Concluído` → `config.notion.status_values.done`
  - `🔄 Em progresso` → `config.notion.status_values.in_progress`
  - `❌ Cancelado` → use "❌ Cancelado" como valor
- **`config.notion.properties.last_check`**: data atual `YYYY-MM-DD`

Atualize **uma tarefa por vez** para facilitar rastreamento de erros.

## Etapa 3 — Retornar resultado

Responda com um JSON estruturado:

```json
{
  "updated": [
    {
      "task_name": "...",
      "notion_url": "https://notion.so/...",
      "page_id": "...",
      "old_status": "⏳ Pendente",
      "new_status": "✅ Concluído"
    }
  ],
  "not_found": [
    {
      "task_name": "...",
      "reason": "tarefa não encontrada no database"
    }
  ],
  "errors": [
    {
      "task_name": "...",
      "error": "mensagem de erro"
    }
  ]
}
```
