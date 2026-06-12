-- 0004: tmux_sessions + collector_heartbeats — visibilidade de panes tmux por host.
--
-- Alimentadas pelo coletor heurístico do tmux-agents-orchestrator (mac, vps-mcpgw,
-- vps-pessoal): cada host faz upsert do snapshot de panes por ciclo (Mac ~30s via
-- launchd, VPS 1min via cron) e registra heartbeat ao fim do ciclo.
--
-- state_since = quando o pane entrou no estado atual (alimenta "esperando há X min"
-- para qualquer estado). collector_heartbeats distingue "host sem sessões tmux" de
-- "coletor morto": dashboard marca host offline quando last_run > 3 min (ou host
-- ausente); host online sem linhas em tmux_sessions = "sem sessões".
--
-- Aditiva, zero impacto nos agentes existentes. Churn de PK quando panes são
-- reindexados é intencional — o snapshot reconstrói tudo a cada ciclo.

SET search_path TO braion, public;

CREATE TABLE IF NOT EXISTS braion.tmux_sessions (
  host          text        NOT NULL,
  session       text        NOT NULL,
  window_index  int         NOT NULL,
  pane_index    int         NOT NULL,
  window_name   text,
  command       text,
  cwd           text,
  state         text        NOT NULL,  -- claude_working|claude_waiting_input|claude_idle|shell
  state_detail  text,
  last_output   text,
  attached      boolean     NOT NULL DEFAULT false,
  state_since   timestamptz NOT NULL,
  last_seen     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (host, session, window_index, pane_index)
);

CREATE TABLE IF NOT EXISTS braion.collector_heartbeats (
  host      text        PRIMARY KEY,
  last_run  timestamptz NOT NULL
);
