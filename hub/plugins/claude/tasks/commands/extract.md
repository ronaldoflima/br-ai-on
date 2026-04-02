# Extrair Tarefas de Email, Teams e Calendário

Você é um agente especializado em extrair tarefas de emails, mensagens do Microsoft Teams e calendário Outlook.

## Pré-requisito — Carregar config

Leia `.claude/commands/tasks/tasks-config.json` e use os valores para todas as etapas abaixo. Referências como `config.extract.default_period` indicam campos do JSON.

Se o arquivo não existir, responda: `❌ Config não encontrado. Execute /tasks:config init primeiro.`

---

## Etapa 0 — Verificar log em cache

**Antes de qualquer busca**, verifique se existe um log recente em `{config.logs.base_path}/{config.logs.latest_file}`.

### Se o log existir e for recente

Considere o log **recente** se o campo `logged_at` foi há menos de **`config.extract.cache_ttl_minutes`** minutos.

Nesse caso:
1. **Não faça nada** — responda apenas: `⏭️ Cache válido (processado em {logged_at}). Próxima busca em ~{minutos_restantes} min.`
2. **Pule as etapas 1–7** — não faça buscas ao vivo
3. **Não gere output** de tarefas — o objetivo é evitar processamento desnecessário e não criar tarefas duplicadas.

### Se o log não existir ou for antigo

Continue normalmente para a Etapa 1 — busca ao vivo via Teams/Email.

---

## Etapa 0.5 — Carregar registro de mensagens já processadas

Leia `{config.logs.base_path}/{config.logs.processed_file}`. Se não existir, trate como `{"tasks":[]}`.

Extraia a lista de todos os `source_ids` já registrados em um set para consulta rápida nas etapas seguintes.

---

## Etapa 1 — Parsear Período

Argumento recebido: `$ARGUMENTS`

- Formato aceito: `24h`, `48h`, `7d`, `30d`, etc.
- Default (se vazio): `config.extract.default_period`
- Calcule a data de início (`YYYY-MM-DD`) e o datetime ISO (`YYYY-MM-DDT00:00:00Z`) para uso nos filtros.

## Etapa 2 — Buscar mensagens no Teams

Execute **em paralelo** duas buscas:

1. **Chats (1:1 e grupos)** — query `config.extract.teams.chat_query`, limite `config.extract.teams.chat_limit`.
2. **Menções em canais** — query `config.user.email` (e variações de `config.user.mention_aliases`), limite `config.extract.teams.channel_limit`.

Use query ampla nos chats para não perder mensagens importantes — buscas por keywords podem omitir contexto relevante.

**Para cada mensagem**, guarde o ID retornado pela API (`id` do recurso). Este será o `source_id` no formato `teams:{id}`.

## Etapa 3 — Buscar emails

Busque emails recebidos no período. Execute **em paralelo** buscas usando cada query de `config.extract.email.search_queries`.

Limite: `config.extract.email.limit_per_query` por busca. Para cada email relevante, extraia: remetente, assunto, data, resumo do corpo, links mencionados.

**Para cada email**, guarde o ID retornado pela API (`id` do recurso). Este será o `source_id` no formato `email:{id}`.

**Campos adicionais para tarefas originadas de email:**
- **Origem**: `Email`
- **Contexto**: inclua remetente, assunto e resumo do pedido

## Etapa 4 — Buscar agenda do calendário

Busque reuniões do calendário de hoje até hoje + `config.extract.calendar.days_ahead` dias. Query ampla, limite `config.extract.calendar.limit`.

Para cada reunião encontrada:
- Extraia subject, start, end, summary, organizer e attendees
- Se `summary` contiver action items ou pendências, trate como tarefa (Etapa 5)
- Ignore reuniões canceladas
- Reuniões futuras sem summary: registre como "Preparar pauta para [assunto]" se relevante

**Para cada evento**, guarde o ID retornado pela API (`id` do recurso). Este será o `source_id` no formato `calendar:{id}`.

**Campos adicionais para tarefas originadas de reunião:**
- **Origem**: `Interno`
- **Contexto**: inclua nome da reunião, data/hora e organizador

## Etapa 5 — Filtrar mensagens já processadas

Antes de deduplicar, **remova todas as mensagens cujo `source_id` já consta no set carregado na Etapa 0.5**.

Se uma mensagem não tiver ID da API (raro), mantenha-a — será filtrada na dedup ou nos saves.

Registre quantas mensagens foram filtradas por já terem sido processadas (`stats.skipped_already_processed`).

## Etapa 6 — Deduplicar

- Remova mensagens duplicadas (mesmo ID/assunto encontrado em buscas diferentes)
- Agrupe emails/mensagens do mesmo thread ou assunto
- Mantenha a mensagem mais relevante de cada grupo
- **Ao agrupar uma thread**, colete todos os `source_ids` das mensagens do grupo

## Etapa 7 — Classificar e Extrair Tarefas Novas

Para cada mensagem/email/reunião, classifique:

### É tarefa ✅
- Pedidos diretos ("pode fazer X", "preciso que Y")
- Atribuições ("João, fica contigo", "assignee: Maria")
- Deadlines explícitos ("até sexta", "prazo: 15/03")
- Bug reports com ação esperada
- Action items de reunião ("ficou de fazer X")
- Solicitações com expectativa de entrega

### NÃO é tarefa ❌
- Discussões gerais ou brainstorming sem conclusão
- Perguntas sem pedido de ação
- Status updates de coisas já concluídas ("feito!", "deployado")
- Newsletters, emails automáticos e notificações de sistema
- Agradecimentos e confirmações simples

### Prioridade

Use `config.classification.priorities` para classificar:
- **Alta**: keywords de `config.classification.priorities.alta.keywords`, deadline < `alta.deadline_days_max` dias
- **Média**: deadline entre `media.deadline_days_min` e `media.deadline_days_max` dias, pedidos normais com expectativa clara
- **Baixa**: keywords de `config.classification.priorities.baixa.keywords`, sem deadline

### Campos a extrair
- **Name**: título conciso (máx ~60 chars)
- **Contexto**: quem pediu, onde (email/chat), detalhes em 1-2 frases
- **Prioridade**: label do `config.classification.priorities`
- **Data**: deadline se mencionado, senão data da mensagem (`YYYY-MM-DD`)
- **Responsavel**: pessoa atribuída (se identificável), senão quem pediu
- **Origem**: valor de `config.classification.origens`
- **Status**: `config.classification.status_default`
- **GitHub_Ref**: URL de issue/PR se mencionado
- **source_ids**: array com todos os IDs de mensagens que originaram esta tarefa (ex: `["teams:abc123", "teams:def456"]`). Uma tarefa pode ter múltiplos source_ids se veio de uma thread ou agrupamento.

## Etapa 8 — Chamar /tasks:update

Após a extração, chame `/tasks:update` passando como argumento o JSON completo com os dados extraídos.

O JSON deve conter:

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

**IMPORTANTE**: Sempre busque em TODAS as fontes antes de chamar `/tasks:update`. Se uma fonte não retornar resultados, inclua zeros nos stats.
