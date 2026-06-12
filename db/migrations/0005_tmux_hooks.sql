-- 0005: colunas hook_* + tmux_session_events — precisão de ciclo de vida (fase 2).
--
-- Alimentadas pelo hook_reporter.py do tmux-agents-orchestrator, registrado nos
-- hooks do Claude Code (UserPromptSubmit, Stop, Notification,
-- PreToolUse[AskUserQuestion], SessionEnd) de cada host.
--
-- Colunas hook_* são SEPARADAS das heurísticas: o coletor nunca as escreve e o
-- reporter nunca atualiza as colunas heurísticas — zero corrida entre escritores.
-- O dashboard prefere a visão do hook quando hook_event_at >= state_since.
--
-- tmux_session_events: histórico append-only de eventos (retenção de 30 dias,
-- aplicada pelo coletor a cada ciclo). Base para métricas e fases 3/4.
--
-- Aditiva, zero impacto nos agentes existentes. Aplicar ANTES de ativar os hooks.

SET search_path TO braion, public;

ALTER TABLE braion.tmux_sessions
  ADD COLUMN IF NOT EXISTS hook_state    text,
  ADD COLUMN IF NOT EXISTS hook_detail   text,
  ADD COLUMN IF NOT EXISTS hook_event    text,
  ADD COLUMN IF NOT EXISTS hook_event_at timestamptz;

CREATE TABLE IF NOT EXISTS braion.tmux_session_events (
  id           bigserial   PRIMARY KEY,
  host         text        NOT NULL,
  session      text        NOT NULL,
  window_index int         NOT NULL,
  pane_index   int         NOT NULL,
  event        text        NOT NULL,  -- prompt_submit|stop|notification|ask_question|session_end
  state        text,
  detail       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tmux_session_events_host_created
  ON braion.tmux_session_events (host, created_at DESC);
