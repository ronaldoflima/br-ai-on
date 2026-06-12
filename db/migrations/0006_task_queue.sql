-- 0006: task_queue — fila de prioridades (fase 3 do tmux-agents-orchestrator).
--
-- Espelho de leitura do workspace Obsidian geral/br-ai-on/tasks/ (fonte de
-- verdade). Alimentada pelo queue_sync.py (VPS, usuário mcpgw, sob demanda):
-- upsert por task_key + delete de órfãs em uma transação. Sync é UMA VIA
-- (Obsidian → PG): a fase 4 (nudge) LÊ daqui e NÃO escreve.
--
-- Consumo (fase 4 / dashboard):
--   SELECT * FROM braion.task_queue WHERE status='pending' ORDER BY rank;
-- Roteamento p/ sessões: projeto casa com cwd de braion.tmux_sessions.
--
-- rank NULL = done (espelhada para histórico de status, fora da fila).
-- Aditiva, zero impacto nos agentes existentes.

SET search_path TO braion, public;

CREATE TABLE IF NOT EXISTS braion.task_queue (
  task_key    text        PRIMARY KEY,        -- slug do arquivo no vault
  title       text        NOT NULL,
  status      text        NOT NULL,           -- pending|in_progress|blocked|done
  prioridade  text,                           -- declarada ou sugerida pelo LLM
  score       int         NOT NULL,
  rank        int,
  projeto     text,
  due         date,
  origem      text,
  source_path text        NOT NULL,
  payload     jsonb,                          -- frontmatter completo
  updated_at  timestamptz NOT NULL DEFAULT now()
);
