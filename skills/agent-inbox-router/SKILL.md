---
name: agent-inbox-router
description: Lê notas do Obsidian inbox, determina o agente responsável via config.yaml de cada agente, cria handoffs e atualiza as notas
---

# Agent Inbox Router

O prompt contém `Agent: <nome>` — use esse nome como agente roteador em todos os paths e comandos abaixo.

Processe as notas do inbox e crie handoffs para os agentes corretos. Ao terminar, encerre a sessão.

## 1. Carregar Configuração e Construir Mapa de Domínios

Leia `agents/<nome>/config.yaml` e extraia:
- `integrations.obsidian.inbox` → diretório inbox no Obsidian (ex: `agents/inbox`)
- `integrations.obsidian.forwarded` → diretório destino após roteamento (ex: `agents/encaminhado`)

Use **Glob** para encontrar todos os configs: `agents/*/config.yaml`

Para cada config encontrado, use **Read** e extraia:
- `name` — identificador do agente
- `domain` — domínio de atuação

Monte um mapa `{ nome → domain }` com todos os agentes encontrados.

**Não hardcode nomes de agentes nem caminhos de pasta** — tudo é lido dos configs em tempo real.

## 2. Listar Notas do Inbox

```
mcp__personal-mcp-gateway__obsidian_list_notes(directory: "<inbox_dir do config>")
```

Para cada nota:

### 2.1 Verificar se Já Foi Roteada

```
mcp__personal-mcp-gateway__obsidian_extract_frontmatter(path: "<nota>")
```

Se o frontmatter já tiver `assigned_to` preenchido → **pule esta nota**.

### 2.2 Ler Conteúdo

```
mcp__personal-mcp-gateway__obsidian_read_note(path: "<nota>")
```

### 2.3 Determinar Agente

Compare o conteúdo da nota com os domínios do mapa construído no passo 1.
Escolha o agente cujo `domain` melhor descreve o assunto da nota.
Se ambíguo, prefira o domínio mais específico.

### 2.4 Criar Handoff

```bash
HAWKAI="<HawkAI base>"
bash "$HAWKAI/lib/handoff.sh" send "<nome>" "<agente>" action null \
  "<título ou primeira linha da nota>" \
  "<conteúdo completo da nota>" \
  "Processar conforme o conteúdo da nota"
```

Guarde o caminho do arquivo retornado para extrair o `handoff_id` (formato `HO-YYYYMMDD-NNN`).

### 2.5 Atualizar Nota

```
mcp__personal-mcp-gateway__obsidian_update_note(
  path: "<nota>",
  frontmatter: {
    assigned_to: "<agente>",
    routed_at: "<timestamp ISO>",
    handoff_id: "<HO-id>",
    status: "forwarded"
  }
)
```

### 2.6 Mover para Forwarded

Leia a nota atualizada para obter o conteúdo completo com o frontmatter novo:

```
mcp__personal-mcp-gateway__obsidian_read_note(path: "<nota>")
```

Extraia o nome do arquivo da nota (ex: `agents/inbox/minha-nota.md` → `minha-nota.md`).

Crie a nota na pasta forwarded (use o `forwarded_dir` lido do config):

```
mcp__personal-mcp-gateway__obsidian_create_note(
  path: "<forwarded_dir>/<nome-do-arquivo>",
  content: "<conteúdo lido acima>"
)
```

Delete a nota original do inbox:

```
mcp__personal-mcp-gateway__obsidian_delete_note(path: "<nota>")
```

## 3. Log e Encerramento

```bash
bash "$HAWKAI/lib/logger.sh" "<nome>" "Inbox roteado" \
  '{"notas_processadas": N, "handoffs_criados": N}'
```

Após o log, mate a sessão tmux para liberar o slot:

```bash
tmux kill-session -t "$(tmux display-message -p '#S')" 2>/dev/null || true
```
