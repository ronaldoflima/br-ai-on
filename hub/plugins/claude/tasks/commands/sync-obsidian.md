# Sincronizar Tarefas no Obsidian

Você recebe um array de updates de status e aplica as atualizações nas notas correspondentes do vault Obsidian.

## Pré-requisito — Carregar config

Leia `.claude/commands/tasks/tasks-config.json` e use `config.obsidian` para todas as etapas abaixo.

Se `config.obsidian.enabled` for `false`, responda: `⏭️ Obsidian desabilitado no config.` e retorne JSON vazio.

---

## Etapa 0 — Parsear entrada

O argumento `$ARGUMENTS` é um JSON array de updates:

```json
[
  {
    "task_name": "Nome ou slug da tarefa",
    "new_status": "✅ Concluído | 🔄 Em progresso | ❌ Cancelado",
    "notes": "Contexto adicional (opcional)",
    "source": "conversa | manual",
    "notion_url": "https://notion.so/... (se veio do sync-notion)"
  }
]
```

Se o array estiver vazio ou inválido, responda: `⏭️ Nenhuma atualização para sincronizar no Obsidian.`

## Etapa 1 — Localizar notas

Para cada update, localize a nota correspondente no vault:

- Slugifique o `task_name`: lowercase, sem acentos, espaços → hífens, max `config.obsidian.slug_max_length` chars
- Tente localizar em `{config.obsidian.vault_path}/[slug].md`
- Se não encontrar pelo path direto, use `obsidian_search` com o `task_name` no vault
- Colete: `path`, status atual do frontmatter

Se não encontrar, marque como `not_found`.

## Etapa 2 — Aplicar atualizações

Para cada nota encontrada, atualize o frontmatter preservando o conteúdo:

1. Leia a nota atual com `obsidian_read_note`
2. Atualize no frontmatter:
   - **status**: novo valor do `new_status`
   - **ultima_verificacao**: data atual `YYYY-MM-DD`
   - **notion_url**: se veio enriquecido do sync-notion e ainda não existia
3. Salve com `obsidian_update_note` — **preservar todo o conteúdo** abaixo do frontmatter

**Não sobrescreva** outros campos do frontmatter.

## Etapa 3 — Retornar resultado

Responda com um JSON estruturado:

```json
{
  "updated": [
    {
      "task_name": "...",
      "obsidian_path": "vault_path/nome-da-tarefa.md",
      "old_status": "⏳ Pendente",
      "new_status": "✅ Concluído"
    }
  ],
  "not_found": [
    {
      "task_name": "...",
      "reason": "nota não encontrada no vault"
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
