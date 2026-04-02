# Configurar Tasks Plugin

Gerencia a configuração do plugin `tasks`. O arquivo de config fica em `.claude/commands/tasks/tasks-config.json`.

## Etapa 0 — Parsear argumento

O argumento `$ARGUMENTS` pode ser:

1. **Vazio** — mostra a config atual formatada
2. **`init`** — cria o config com valores default (interativo)
3. **`set <chave> <valor>`** — altera um campo específico (dot notation)
4. **`show`** — mostra a config atual
5. **`validate`** — valida se o config está completo e funcional

## Se `show` ou vazio — Mostrar config atual

Leia `.claude/commands/tasks/tasks-config.json` e exiba formatado em seções:

```
📋 Tasks Config

👤 Usuário
   Email: seu.email@empresa.com
   Aliases: @SeuNome
   Idioma: pt-br

🔍 Extração
   Período default: 24h
   Cache TTL: 30 min
   Teams: chat 50, canais 50
   Email: 20/query, 5 queries
   Calendário: +2 dias, limite 50

🏷️ Classificação
   Prioridades: 🔥 Alta | ⚡ Média | 🐌 Baixa
   Origens: Slack, Github, Manual, Interno, Email, Produção, Outros, Teams
   Status default: ⏳ Pendente

💾 Destinos ativos: notion, obsidian
   Notion: ✅ (database: Organização de Tarefas)
   Obsidian: ✅ (vault: pessoal/inbox)

📁 Logs: logs/extract-tasks/
```

## Se `init` — Setup interativo

Guie o usuário pelas configurações essenciais, perguntando uma seção por vez:

### 1. Dados do usuário
- Email corporativo (usado para busca Teams)
- Aliases de menção (como te chamam no Teams/Slack)
- Idioma das buscas (pt-br, en, es — afeta os search_queries do email)

### 2. Notion (opcional)
- Deseja salvar no Notion? (sim/não → `notion.enabled`)
- Se sim: ID do database de tarefas
- Nomes das propriedades (mostrar defaults, confirmar ou alterar)

### 3. Obsidian (opcional)
- Deseja salvar no Obsidian? (sim/não → `obsidian.enabled`)
- Se sim: path do vault para inbox (default: `pessoal/inbox`)
- Tags default

### 4. Extração
- Período default (24h)
- Cache TTL em minutos (30)
- Queries de email (mostrar defaults, perguntar se quer ajustar)

### 5. Destinos
- Montar `save_targets` baseado no que foi habilitado

Após coletar, salve em `.claude/commands/tasks/tasks-config.json` e confirme:
`✅ Config salvo em .claude/commands/tasks/tasks-config.json`

## Se `set <chave> <valor>` — Alterar campo

Use dot notation para acessar campos aninhados:

- `/tasks:config set user.email maria@empresa.com`
- `/tasks:config set extract.cache_ttl_minutes 60`
- `/tasks:config set notion.enabled false`
- `/tasks:config set obsidian.vault_path work/inbox`
- `/tasks:config set save_targets ["notion"]`

Leia o JSON, altere o campo, salve e confirme:
`✅ {chave} alterado para {valor}`

Se a chave não existir, pergunte se deseja criar.

## Se `validate` — Validar config

Verifique:

1. **Arquivo existe** — `.claude/commands/tasks/tasks-config.json`
2. **Campos obrigatórios** preenchidos:
   - `user.email`
   - `classification.status_default`
   - `logs.base_path`
3. **Destinos habilitados** têm config completa:
   - Se `notion` em `save_targets` → `notion.database_id` preenchido
   - Se `obsidian` em `save_targets` → `obsidian.vault_path` preenchido
4. **Sem destinos** — avisar se `save_targets` está vazio

Resultado:
```
✅ Config válido
   Destinos: notion (✅), obsidian (✅)
   Campos obrigatórios: OK
```
ou
```
❌ Config inválido
   - notion.database_id está vazio mas notion está em save_targets
   - user.email está vazio
```
