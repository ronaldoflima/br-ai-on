---
name: agent-inbox-router
description: Lê notas do Obsidian inbox, determina o agente responsável via config.yaml de cada agente, cria handoffs e atualiza as notas
---

# Agent Inbox Router

Este skill é o **único responsável** por converter notas do Obsidian inbox em handoffs. Nenhum outro agente ou skill deve fazer esta conversão.

O prompt contém `Agent: <nome>` — use esse nome como agente roteador em todos os paths e comandos abaixo.

Processe as notas do inbox e crie handoffs para os agentes corretos. Ao terminar, encerre a sessão.

## 1. Carregar Configuração e Construir Mapa de Domínios

Leia `agents/<nome>/config.yaml` e extraia o diretório inbox local (padrão: `agents/inbox`).

Use **Glob** para encontrar todos os configs: `agents/*/config.yaml`

Para cada config encontrado, use **Read** e extraia:
- `name` — identificador do agente
- `domain` — domínio de atuação

Monte um mapa `{ nome → domain }` com todos os agentes encontrados.

**Não hardcode nomes de agentes nem caminhos de pasta** — tudo é lido dos configs em tempo real.

## 2. Listar Notas do Inbox

Use **Glob** para listar arquivos `.md` no inbox:
```
Glob: agents/inbox/*.md
```

Para cada nota:

### 2.1 Verificar se Já Foi Roteada

Use **Read** para ler o arquivo e extraia o frontmatter YAML (entre `---`).

Se o frontmatter já tiver `assigned_to` preenchido → **pule esta nota**.

### 2.2 Ler Conteúdo

Use **Read** para ler o conteúdo completo da nota.

### 2.3 Determinar Agente

Compare o conteúdo da nota com os domínios do mapa construído no passo 1.
Escolha o agente cujo `domain` melhor descreve o assunto da nota.
Se ambíguo, prefira o domínio mais específico.

### 2.4 Criar Handoff

```bash
BRAION="<BR.AI.ON base>"
bash "$BRAION/lib/handoff.sh" send "<nome>" "<agente>" action null \
  "<título ou primeira linha da nota>" \
  "<conteúdo completo da nota>" \
  "Processar conforme o conteúdo da nota"
```

Guarde o caminho do arquivo retornado para extrair o `handoff_id` (formato `HO-YYYYMMDD-NNN`).

### 2.5 Atualizar e Mover Nota

Adicione frontmatter de roteamento ao conteúdo da nota:
```yaml
---
assigned_to: "<agente>"
routed_at: "<timestamp ISO>"
handoff_id: "<HO-id>"
status: "forwarded"
---
```

Use **Write** para salvar a nota atualizada em `agents/forwarded/<nome-do-arquivo>`.

Depois, delete o arquivo original do inbox:
```bash
rm "$BRAION/agents/inbox/<nome-do-arquivo>"
```

## 3. Log e Encerramento

```bash
bash "$BRAION/lib/logger.sh" "<nome>" "Inbox roteado" \
  '{"notas_processadas": N, "handoffs_criados": N}'
```

Após o log, mate a sessão tmux para liberar o slot:

```bash
tmux kill-session -t "$(tmux display-message -p '#S')" 2>/dev/null || true
```
