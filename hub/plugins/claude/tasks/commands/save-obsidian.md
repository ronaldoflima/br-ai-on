# Salvar Tarefas no Obsidian

Você recebe um array de tarefas e cria uma nota individual no vault Obsidian para cada uma.

## Pré-requisito — Carregar config

Leia `.claude/commands/tasks/tasks-config.json` e use `config.obsidian` para todas as etapas abaixo.

Se `config.obsidian.enabled` for `false`, responda: `⏭️ Obsidian desabilitado no config.` e retorne JSON vazio.

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
    "notion_url": "https://notion.so/...",
    "GitHub_Ref": "URL ou null"
  }
]
```

Se o array estiver vazio ou inválido, responda: `⏭️ Nenhuma tarefa para salvar no Obsidian.`

## Etapa 1 — Criar notas

Para cada tarefa, crie uma nota no vault Obsidian:

### Path

`{config.obsidian.vault_path}/[nome-da-tarefa-slugificado].md`

Slugificação: lowercase, sem acentos, espaços → hífens, max `config.obsidian.slug_max_length` chars.

### Conteúdo

Use `config.obsidian.template` substituindo os placeholders `{campo}` pelos valores da tarefa.

### Frontmatter

```yaml
tags: config.obsidian.default_tags + [origem-lowercase]
status: "[Status]"
prioridade: "[Prioridade]"
origem: "[Origem]"
responsavel: "[Responsavel]"
data: "YYYY-MM-DD"
ultima_verificacao: "YYYY-MM-DD"
contexto: "[Contexto resumido]"
notion_url: "[URL se houver]"
github_ref: "[URL se houver, senão omitir]"
created: "YYYY-MM-DD"
```

### Regras

- O frontmatter espelha **todas** as propriedades da tarefa
- Omita `github_ref` do frontmatter se não houver URL
- Omita `notion_url` do frontmatter se não houver URL
- Se a nota já existir (mesmo path), **pule** — não sobrescrever

## Etapa 2 — Retornar resultado

Responda com um JSON estruturado:

```json
{
  "created": [
    { "Name": "...", "obsidian_path": "vault_path/nome-da-tarefa.md" }
  ],
  "skipped": [
    { "Name": "...", "obsidian_path": "vault_path/nome-da-tarefa.md", "reason": "nota já existe" }
  ],
  "errors": [
    { "Name": "...", "error": "mensagem de erro" }
  ]
}
```
