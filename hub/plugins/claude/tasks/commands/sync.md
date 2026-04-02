# Sincronizar Status de Tarefas

Você carrega as tarefas pendentes dos destinos, cruza com o contexto da conversa para identificar atualizações de status, e orquestra a sincronização chamando comandos especializados por destino.

## Pré-requisito — Carregar config

Leia `.claude/commands/tasks/tasks-config.json` e use os valores para todas as etapas abaixo.

Se o arquivo não existir, responda: `❌ Config não encontrado. Execute /tasks:config init primeiro.`

---

## Etapa 0 — Carregar tarefas pendentes dos destinos

**Antes de analisar qualquer contexto**, carregue as tarefas com status pendente/em progresso dos destinos habilitados em `config.save_targets`:

### Notion (se `config.notion.enabled`)

Consulte o database `config.notion.database_id` filtrando por status != `config.notion.status_values.done`. Colete: nome, status atual, page_id, URL.

### Obsidian (se `config.obsidian.enabled`)

Busque notas no vault `config.obsidian.vault_path` com tag `tarefa` e status != "✅ Concluído" no frontmatter. Use `obsidian_search` com query por tag. Colete: nome, status atual, path.

Monte uma **lista de referência** com todas as tarefas conhecidas e seus nomes/slugs. Esta lista é usada na Etapa 1 para correlação.

Se nenhum destino tiver tarefas pendentes, responda: `ℹ️ Nenhuma tarefa pendente encontrada nos destinos.`

## Etapa 1 — Identificar atualizações

O argumento `$ARGUMENTS` pode ser:

1. **JSON inline** — array de updates explícitos (use diretamente, pule para Etapa 2)
2. **Texto livre** — descrição das atualizações (ex: "tarefa X foi concluída")
3. **Vazio** — analise o contexto da conversa atual

### Análise de contexto da conversa

Quando `$ARGUMENTS` estiver vazio ou for texto livre, analise as mensagens da conversa buscando sinais de mudança de status:

**Keywords de conclusão**: "concluí", "terminei", "feito", "done", "pronto", "finalizado", "resolvido", "mergado", "deployed", "entregue"
**Keywords de cancelamento**: "cancelei", "cancelado", "não precisa mais", "descartado", "desisti"
**Keywords de progresso**: "comecei", "estou fazendo", "em andamento", "working on", "pegando pra fazer"

### Correlação com tarefas pendentes

Para cada sinal detectado, tente correlacionar com a lista de referência da Etapa 0. Use os critérios abaixo **em ordem de força** — o primeiro match suficiente resolve:

#### Match direto (atualizar sem perguntar)

Qualquer **um** destes basta para considerar match direto:

1. **source_id coincide** — a mensagem está no mesmo chat/thread/email de um `source_id` da tarefa (ex: chatId do Teams é o mesmo). Este é o match mais forte — se a tarefa veio desse chat e alguém diz "feito" nele, é sobre essa tarefa
2. **Nome explícito** — a mensagem menciona diretamente o nome ou slug da tarefa
3. **Responsável + contexto** — quem disse "feito" é o responsável da tarefa E o assunto do chat/thread corresponde ao contexto da tarefa

#### Match indireto (atualizar com nota no output)

Se 2 dos critérios abaixo forem atendidos, trate como match e atualize — mas sinalize no output que foi inferido:

- O responsável da tarefa é o mesmo que enviou o sinal
- O assunto da conversa tem relação com o campo `Contexto` da tarefa
- O timing faz sentido (tarefa foi criada recentemente, sinal é recente)

#### Sem match (perguntar ao usuário)

Só pergunte ao usuário quando o sinal existir mas **nenhum** critério direto ou indireto for atendido. Liste as tarefas pendentes como candidatas.

### Estrutura normalizada

Normalize todas as entradas para o JSON abaixo — este é o input que será passado aos comandos de sync:

```json
[
  {
    "task_name": "Nome da tarefa (conforme destino)",
    "new_status": "✅ Concluído | 🔄 Em progresso | ❌ Cancelado",
    "notes": "Contexto adicional sobre a atualização (opcional)",
    "source": "conversa | manual",
    "matched_from": "nome da pessoa ou contexto que gerou o match"
  }
]
```

Se nenhuma atualização for identificada, responda:

```
ℹ️ Nenhuma atualização de tarefa identificada.

Tarefas pendentes encontradas:
  - [listar tarefas pendentes dos destinos com status atual]

Formas de usar:
  1. Trabalhe na conversa e mencione conclusões, depois rode /tasks:sync
  2. Passe direto: /tasks:sync tarefa X foi concluída
  3. JSON: /tasks:sync [{"task_name": "...", "new_status": "✅ Concluído"}]
```

## Etapa 2 — Chamar comandos de sincronização

Leia `config.save_targets` para determinar quais destinos estão ativos.

Para cada target habilitado, chame o comando correspondente (`/tasks:sync-{target}`) passando o array de updates como argumento JSON.

Chame **sequencialmente** — o segundo destino recebe os updates enriquecidos com resultados do destino anterior (URLs, page_ids, paths).

Cada comando retorna um JSON com resultado. Colete todos os retornos para compor o relatório.

Se um comando falhar, registre o erro e continue com o próximo.

## Etapa 3 — Output

### Seção 1: Tarefas Atualizadas

Consolide os retornos de todos os comandos:

| # | Tarefa | Status Anterior | Novo Status | Destinos |
|---|--------|----------------|-------------|----------|
| 1 | Nome   | ⏳ Pendente    | ✅ Concluído | Notion, Obsidian |

Se nenhuma tarefa foi atualizada, informe o motivo.

### Seção 2: Tarefas Não Encontradas

Liste tarefas que não foram localizadas em nenhum destino, com sugestão de ação.

### Seção 3: Erros

Liste falhas na sincronização por destino.

### Resumo

- Total de tarefas atualizadas (por destino)
- Total não encontradas
- Total de erros

## Etapa 4 — Salvar log

Salve o resultado em `{config.logs.base_path}/sync-latest.json`:

```json
{
  "synced_at": "YYYY-MM-DDThh:mm:ss",
  "pending_tasks_loaded": 0,
  "updates": [
    {
      "task_name": "...",
      "old_status": "...",
      "new_status": "...",
      "synced_to": ["notion", "obsidian"],
      "notion_url": "...",
      "obsidian_path": "...",
      "matched_from": "..."
    }
  ],
  "not_found": [],
  "errors": [],
  "summary": {
    "total_updated": 0,
    "total_not_found": 0,
    "total_errors": 0
  }
}
```

Salve em **dois arquivos**:

1. `{config.logs.base_path}/sync-latest.json` — sempre sobrescreve
2. `{config.logs.base_path}/sync-YYYY-MM-DD_HHmm.json` — histórico

Confirme no output: `✅ Sync concluído` com totais.
