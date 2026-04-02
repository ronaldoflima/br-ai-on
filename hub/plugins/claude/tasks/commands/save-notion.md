# Salvar Tarefas no Notion

Você recebe um array de tarefas e persiste no Notion.

## Pré-requisito — Carregar config

Leia `.claude/commands/tasks/tasks-config.json` e use `config.notion` para todas as etapas abaixo.

Se `config.notion.enabled` for `false`, responda: `⏭️ Notion desabilitado no config.` e retorne JSON vazio.

---

## Etapa 0 — Parsear entrada

O argumento `$ARGUMENTS` é um JSON array de tarefas:

```json
[
  {
    "Name": "...",
    "Contexto": "...",
    "Prioridade": "...",
    "Data": "YYYY-MM-DD",
    "Responsavel": "...",
    "Origem": "...",
    "Status": "...",
    "GitHub_Ref": "URL ou null"
  }
]
```

Se o array estiver vazio ou inválido, responda: `⏭️ Nenhuma tarefa para salvar no Notion.`

## Etapa 1 — Verificar duplicatas

Para cada tarefa, verifique se já existe no Notion com nome similar. Busque no database `config.notion.database_id` pela query do `Name`.

Se encontrar uma tarefa com similaridade > `config.notion.duplicate_threshold` com status `config.notion.status_values.pending` ou `config.notion.status_values.in_progress`, **pule a criação** e marque como `duplicada`.

## Etapa 2 — Criar tarefas

Para as tarefas não duplicadas, crie no Notion no database `config.notion.database_id` mapeando os campos conforme `config.notion.properties`:

- **`config.notion.properties.name`**: título da tarefa
- **`config.notion.properties.status`**: `config.notion.status_values.pending`
- **`config.notion.properties.priority`**: valor da prioridade
- **`config.notion.properties.origin`**: valor da origem
- **`config.notion.properties.context`**: contexto resumido
- **`config.notion.properties.responsible`**: nome ou vazio
- **`config.notion.properties.date`**: campo date com start em `YYYY-MM-DD`
- **`config.notion.properties.last_check`**: campo date com start na data atual `YYYY-MM-DD`
- **`config.notion.properties.github_ref`**: URL se houver — omita o campo se não houver URL

Crie **uma tarefa por vez** para facilitar rastreamento de erros.

## Etapa 3 — Retornar resultado

Responda com um JSON estruturado:

```json
{
  "created": [
    { "Name": "...", "notion_url": "https://notion.so/...", "Prioridade": "...", "Origem": "..." }
  ],
  "duplicates": [
    { "Name": "...", "existing_url": "https://notion.so/...", "reason": "nome similar encontrado" }
  ],
  "errors": [
    { "Name": "...", "error": "mensagem de erro" }
  ]
}
```
