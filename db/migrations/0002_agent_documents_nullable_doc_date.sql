-- 0002: agent_documents — permite doc_date NULL para docs flat.
--
-- Bug: a PK (agent_name, doc_type, doc_date) tornava doc_date NOT NULL, mas
-- tanto lib/state.sh (_state_pg_doc_set) quanto scripts/migrate_fs_to_pg.py
-- gravam docs flat (notebooklm_sources, last_commit, fallback flat dos docs
-- diários) com doc_date = NULL. Isso quebrava migração e runtime do backend pg.
--
-- Fix: troca a PK por UNIQUE NULLS NOT DISTINCT (Postgres 15+), que permite
-- NULL e trata dois NULLs como iguais — preservando o upsert via
-- ON CONFLICT (agent_name, doc_type, doc_date).

SET search_path TO braion, public;

ALTER TABLE braion.agent_documents DROP CONSTRAINT IF EXISTS agent_documents_pkey;

-- Dropar a PK não remove o NOT NULL implícito que ela impôs em doc_date.
ALTER TABLE braion.agent_documents ALTER COLUMN doc_date DROP NOT NULL;

ALTER TABLE braion.agent_documents
  ADD CONSTRAINT agent_documents_uq
  UNIQUE NULLS NOT DISTINCT (agent_name, doc_type, doc_date);
