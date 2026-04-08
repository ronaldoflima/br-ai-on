---
name: agent-inbox-router
description: Lê notas do Obsidian inbox, determina o agente responsável via config.yaml de cada agente, cria handoffs e atualiza as notas
---

# Agent Inbox Router

Este command é o **único responsável** por converter notas do Obsidian inbox em handoffs. Nenhum outro agente ou command deve fazer esta conversão.

O prompt contém `Agent: <nome>` — use esse nome como agente roteador em todos os paths e comandos abaixo.

## 1. Determinar Pasta do Inbox

Se o prompt contiver `Folder: /caminho/para/pasta`, use esse caminho como pasta do inbox.
Caso contrário, use `$BRAION/agents/inbox/` como pasta padrão (onde `$BRAION` é o BR.AI.ON base do prompt).

Guarde esse caminho como `INBOX_FOLDER`.

## 2. Carregar Configuração e Construir Mapa de Domínios

Use **Glob** para encontrar todos os configs: `agents/*/config.yaml`

Para cada config encontrado, use **Read** e extraia:
- `name` — identificador do agente
- `domain` — domínio de atuação

Monte um mapa `{ nome → domain }` com todos os agentes encontrados.
Ignore agentes cujo `name` começa com `_` ou que não têm `domain`.

**Não hardcode nomes de agentes nem caminhos de pasta** — tudo é lido dos configs em tempo real.

## 3. Listar Notas do Inbox

Use **Bash** para listar arquivos `.md` no `INBOX_FOLDER`:
```bash
find "$INBOX_FOLDER" -maxdepth 1 -name "*.md" -not -name ".*" 2>/dev/null
```

Para cada nota encontrada:

### 3.1 Verificar se Já Foi Roteada

Use **Read** para ler o arquivo e extraia o frontmatter YAML (entre `---`).

Se o frontmatter já tiver `assigned_to` preenchido → **pule esta nota**.

### 3.2 Ler Conteúdo

Use **Read** para ler o conteúdo completo da nota.

### 3.3 Determinar Agente

Compare o conteúdo da nota com os domínios do mapa construído no passo 2.
Escolha o agente cujo `domain` melhor descreve o assunto da nota.
Se ambíguo, prefira o domínio mais específico.

### 3.4 Criar Handoff

```bash
BRAION="<BR.AI.ON base>"
bash "$BRAION/lib/handoff.sh" send "<nome>" "<agente>" action null \
  "<título ou primeira linha da nota>" \
  "<conteúdo completo da nota>" \
  "Processar conforme o conteúdo da nota"
```

Guarde o caminho do arquivo retornado para extrair o `handoff_id` (formato `HO-YYYYMMDD-NNN`).

### 3.5 Atualizar e Mover Nota

Use **Write** para salvar a nota com frontmatter atualizado no mesmo arquivo:
```yaml
---
assigned_to: "<agente>"
routed_at: "<timestamp ISO>"
handoff_id: "<HO-id>"
status: "forwarded"
---
<conteúdo original>
```

Em seguida, mova a nota para `$INBOX_FOLDER/forwarded/`:
```bash
mkdir -p "$INBOX_FOLDER/forwarded"
mv "<caminho-da-nota>" "$INBOX_FOLDER/forwarded/<nome-do-arquivo>"
```

## 4. Log e Encerramento

```bash
bash "$BRAION/lib/logger.sh" "<nome>" "Inbox roteado" \
  '{"notas_processadas": N, "handoffs_criados": N, "inbox_folder": "<INBOX_FOLDER>"}'
```

Após o log, mate a sessão tmux para liberar o slot:

```bash
tmux kill-session -t "$(tmux display-message -p '#S')" 2>/dev/null || true
```
