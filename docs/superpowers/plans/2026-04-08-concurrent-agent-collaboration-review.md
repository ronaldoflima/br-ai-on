# Code Review: Concurrent Agent Collaboration Plan

**Reviewer**: Claude Opus 4.6
**Data**: 2026-04-08
**Plano revisado**: `2026-04-08-concurrent-agent-collaboration.md`
**Status**: Aprovado com correções obrigatórias

---

## Referências de Linha

Todas validadas contra o código atual. Uma exceção menor:
- AGENTS.md: heartbeat.json está na **linha 28**, não 29 (off-by-one).

---

## Correções Obrigatórias (bloqueia execução)

### FIX-1: Test de integração vai falhar — `handoff_send` retorna ID, não path

**Task 9, linhas 992-998 do plano**

`handoff_send` faz `echo "$ho_id"` (retorna `HO-20260408-001`), mas o teste captura como se fosse um filepath e faz `[ -f "$ho1" ]`.

**Correção**: alterar o teste para construir o path:

```bash
ho1_id=$(bash "$PROJECT_ROOT/lib/handoff.sh" send orchestrator analista-kpi-company-v2 action null \
  "Test sub-task 1" "Test context" "Test expected" "$thread_id" "$job_id")
ho1="$PROJECT_ROOT/agents/analista-kpi-company-v2/handoffs/inbox/${ho1_id}_from-orchestrator.md"

ho2_id=$(bash "$PROJECT_ROOT/lib/handoff.sh" send orchestrator px-growth-agent action null \
  "Test sub-task 2" "Test context" "Test expected" "$thread_id" "$job_id")
ho2="$PROJECT_ROOT/agents/px-growth-agent/handoffs/inbox/${ho2_id}_from-orchestrator.md"
```

Ou, alternativamente, modificar `handoff_send` para retornar o filepath em vez do ID. Mas isso quebra consumidores existentes — preferir a correção no teste.

### FIX-2: Orchestrator no diretório errado

**Task 4**

O plano cria o orchestrator em `agents/orchestrator/`, que é para agentes do usuário (ignorados pelo git). Agentes versionados ficam em `agents/_defaults/` conforme AGENTS.md linhas 13-14.

**Correção**: trocar todas as referências de `agents/orchestrator/` para `agents/_defaults/orchestrator/` na Task 4. Isso inclui:
- Todos os `mkdir` e paths de arquivos no Step 1-5
- O IDENTITY.md (paths internos)
- O commit message

Atenção: o `agent-cron.sh` já itera sobre `agents/*/config.yaml` — verificar se o glob também cobre `agents/_defaults/*/config.yaml`. Se não, o orchestrator não será detectado pelo scheduler/cron.

### FIX-3: `expects: orchestrate` ausente no schema do frontmatter

**Task 8**

O plano adiciona `orchestrate` como novo valor na tabela de expects, mas não atualiza a definição do frontmatter do handoff (AGENTS.md linha 179):

```
expects: action | info | review
```

**Correção**: atualizar para:

```
expects: action | info | review | orchestrate
```

---

## Correções Recomendadas (não bloqueiam, mas melhoram robustez)

### REC-1: Race condition em `job_next_id`

**Task 2, `job_create`**

O `lock.sh` usa `created_by` como lock owner, mas dois agentes diferentes obtêm locks independentes. Se orchestrator e cron chamam `job_create` simultaneamente, podem gerar o mesmo JOB ID.

**Correção**: usar lock com resource fixo:

```bash
bash "$LOCK_SH" acquire "job-system" jobs > /dev/null 2>&1 || true
# ... gerar ID e criar arquivo ...
bash "$LOCK_SH" release "job-system" jobs > /dev/null 2>&1 || true
```

Isso serializa todas as criações de job independente do caller.

### REC-2: `local` em for-loop aninhado no cron

**Task 5, Step 4, ~linhas 720-723 do plano**

```bash
for reply_file in "$inbox_dir"/HO-*.md; do
    local reply_job    # <-- local dentro de for dentro de for
```

Funciona em bash (escopo é da função, não do bloco), mas é confuso. Declarar `reply_job` e `claimed_path` no início do bloco do `for config` externo.

### REC-3: `notify_user_handoff` não definida no plano

**Task 5, Step 4, ~linha 689 do plano**

O código chama `notify_user_handoff "$agent_dir/handoffs/archive/$filename"` mas essa função não é criada no plano. Verificar se já existe em `agent-cron.sh`. Se não existir, ou remover a chamada (apenas arquivar) ou adicionar a definição.

### REC-4: Task 10 usa `git add -A`

**Task 10, Step 4**

`git add -A` pode commitar arquivos indesejados (artefatos de teste, arquivos temporários). Trocar por `git add` dos arquivos específicos, ou pelo menos fazer `git status` antes para revisar.

### REC-5: Cleanup incompleto no teste de integração

**Task 9, linha 1020**

O teste cria diretórios em `agents/analista-kpi-company-v2/` e `agents/px-growth-agent/` via `handoff.sh send`, mas só limpa os arquivos de handoff. Se esses agentes não existiam antes, os diretórios ficam como lixo.

**Correção**: adicionar ao final do teste:

```bash
# Cleanup test agent directories if they were created by this test
rmdir agents/analista-kpi-company-v2/handoffs/inbox 2>/dev/null || true
rmdir agents/px-growth-agent/handoffs/inbox 2>/dev/null || true
```

Ou usar agentes que já existem no repo para o teste.

### REC-6: Ambiguidade entre thread de conversa e thread de job

`job_create` gera `THR-*` como thread_id, mas o sistema de handoffs já usa thread_id como conceito de "thread de conversa" (via `handoff.sh thread-history`). Usar o mesmo namespace pode gerar confusão.

Considerar renomear para `JOB_THREAD-*` ou documentar claramente que threads de job e threads de conversa compartilham o mesmo namespace intencionalmente.

---

## Resumo

| Categoria | Qtd | IDs |
|-----------|-----|-----|
| Bloqueante | 3 | FIX-1, FIX-2, FIX-3 |
| Recomendado | 6 | REC-1 a REC-6 |

O plano é sólido em arquitetura (fan-out/fan-in via filesystem, waiting state com tmux, TDD). As correções bloqueantes são pontuais — o FIX-1 faz o teste de integração passar, o FIX-2 garante que o orchestrator seja versionado, e o FIX-3 completa a documentação.
