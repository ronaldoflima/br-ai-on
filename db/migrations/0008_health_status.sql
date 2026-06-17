-- 0008_health_status.sql
-- Healthcheck do ecossistema: snapshot de estado (escritor único = avaliador no mcpgw),
-- heartbeats de crons sem sinal natural, e self-report do collector do Mac.

SET search_path TO braion, public;

CREATE TABLE IF NOT EXISTS braion.health_status (
  component   text PRIMARY KEY,
  status      text NOT NULL,
  summary     text,
  detail      jsonb,
  checked_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS braion.cron_heartbeats (
  job       text PRIMARY KEY,
  last_run  timestamptz NOT NULL
);

ALTER TABLE braion.collector_heartbeats ADD COLUMN IF NOT EXISTS probe jsonb;
