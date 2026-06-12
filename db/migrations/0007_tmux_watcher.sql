-- 0007: tmux_actions + tmux_notifications — watcher Telegram + nudge (fase 4).
--
-- tmux_actions: fila de nudges. Inserida pelo telegram-bridge (reply a uma
-- notificação com marcador ⟦nudge host:session:w.p⟧); executada pelo coletor
-- do próprio host via tmux send-keys com GATE DE ESTADO (só pane classificado
-- claude_waiting_input/claude_idle no ciclo corrente — 'shell' executaria o
-- texto como comando). Expiry: 10 min pelo executor, sweep de 15 min pelo
-- watcher (cobre coletor morto). Trilha de auditoria completa.
--
-- tmux_notifications: anti-spam do watcher — 1 notificação por transição
-- (chave inclui `since`) + lembrete a cada 30 min. Retenção de 30 dias pelo
-- watcher. Para o gatilho 'offline', colunas de pane recebem sentinelas
-- (session='', window_index=-1, pane_index=-1).
--
-- Aditiva, zero impacto nos agentes existentes. Aplicar ANTES de ativar o
-- watcher e a extensão do bridge.

SET search_path TO braion, public;

CREATE TABLE IF NOT EXISTS braion.tmux_actions (
  id           bigserial   PRIMARY KEY,
  host         text        NOT NULL,
  session      text        NOT NULL,
  window_index int         NOT NULL,
  pane_index   int         NOT NULL,
  action_text  text        NOT NULL,
  status       text        NOT NULL DEFAULT 'pending',  -- pending|done|error|expired
  requested_by text,                                    -- 'telegram:<chat_id>'
  result       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  executed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS tmux_actions_pending
  ON braion.tmux_actions (host, status, created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS braion.tmux_notifications (
  host          text        NOT NULL,
  session       text        NOT NULL,
  window_index  int         NOT NULL,
  pane_index    int         NOT NULL,
  trigger       text        NOT NULL,  -- waiting|offline|idle
  since         timestamptz NOT NULL,
  first_sent_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at  timestamptz NOT NULL DEFAULT now(),
  reminders     int         NOT NULL DEFAULT 0,
  PRIMARY KEY (host, session, window_index, pane_index, trigger, since)
);
