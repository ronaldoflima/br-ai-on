-- br-ai-on: Postgres schema (fonte da verdade para estado multi-cluster)
-- Aplica em banco vazio. Para migrations versionadas use db/migrations/.

CREATE SCHEMA IF NOT EXISTS braion;
SET search_path TO braion, public;

CREATE TABLE IF NOT EXISTS agents (
  name              TEXT PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS heartbeat (
  agent_name         TEXT PRIMARY KEY REFERENCES agents(name) ON DELETE CASCADE,
  last_ping          TIMESTAMPTZ NOT NULL,
  status             TEXT NOT NULL,
  waiting_since      TIMESTAMPTZ,
  active_protections JSONB NOT NULL DEFAULT '[]'::jsonb,
  extra              JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS agent_documents (
  agent_name        TEXT NOT NULL REFERENCES agents(name) ON DELETE CASCADE,
  doc_type          TEXT NOT NULL,
  doc_date          DATE,
  content           TEXT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_name, doc_type, doc_date)
);

CREATE TABLE IF NOT EXISTS episodic_memory (
  id                BIGSERIAL PRIMARY KEY,
  agent_name        TEXT NOT NULL REFERENCES agents(name) ON DELETE CASCADE,
  ts                TIMESTAMPTZ NOT NULL DEFAULT now(),
  date              DATE NOT NULL,
  action            TEXT NOT NULL,
  context           TEXT,
  outcome           TEXT,
  importance        INT,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS episodic_memory_agent_ts_idx
  ON episodic_memory (agent_name, ts DESC);

CREATE TABLE IF NOT EXISTS cache_kv (
  agent_name        TEXT NOT NULL REFERENCES agents(name) ON DELETE CASCADE,
  key               TEXT NOT NULL,
  value             JSONB NOT NULL,
  expires_at        TIMESTAMPTZ,
  PRIMARY KEY (agent_name, key)
);

CREATE TABLE IF NOT EXISTS handoffs (
  id                TEXT PRIMARY KEY,
  from_agent        TEXT NOT NULL,
  to_agent          TEXT NOT NULL REFERENCES agents(name) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL,
  expects           TEXT,
  reply_to          TEXT REFERENCES handoffs(id),
  thread_id         TEXT,
  job_id            TEXT,
  frontmatter       JSONB NOT NULL DEFAULT '{}'::jsonb,
  body              TEXT NOT NULL,
  archived_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS handoffs_to_status_idx ON handoffs (to_agent, status);
CREATE INDEX IF NOT EXISTS handoffs_thread_idx   ON handoffs (thread_id);

CREATE TABLE IF NOT EXISTS handoff_artifacts (
  handoff_id        TEXT NOT NULL REFERENCES handoffs(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  content           TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (handoff_id, name)
);

CREATE TABLE IF NOT EXISTS jobs (
  id                TEXT PRIMARY KEY,
  thread_id         TEXT,
  description       TEXT NOT NULL,
  created_by        TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL,
  expected          JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed         JSONB NOT NULL DEFAULT '[]'::jsonb,
  failed            JSONB NOT NULL DEFAULT '[]'::jsonb,
  result_summary    TEXT,
  archived_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS shared_kv (
  key               TEXT PRIMARY KEY,
  value             JSONB NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS logs (
  id                BIGSERIAL PRIMARY KEY,
  ts                TIMESTAMPTZ NOT NULL,
  agent_name        TEXT NOT NULL,
  action            TEXT NOT NULL,
  message           TEXT,
  prompt_version    TEXT,
  status            TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS logs_agent_ts_idx ON logs (agent_name, ts DESC);
