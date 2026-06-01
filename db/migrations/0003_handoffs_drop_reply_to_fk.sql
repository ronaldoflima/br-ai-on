-- 0003: handoffs — remove FK auto-referencial de reply_to.
--
-- Bug: reply_to REFERENCES handoffs(id) é integridade rígida demais para dados
-- históricos e para a ordem de inserção da migração:
--   1) handoffs são arquivados/limpos independentemente, deixando reply_to
--      apontando para um pai que já não existe (referência pendente);
--   2) a migração insere um handoff por transação, então um pai inserido depois
--      do filho violaria a FK mesmo quando ambos existem.
--
-- Fix: reply_to vira ponteiro soft (coluna TEXT sem FK). Threading continua
-- via JOIN manual; pais ausentes simplesmente não casam.

SET search_path TO braion, public;

ALTER TABLE braion.handoffs DROP CONSTRAINT IF EXISTS handoffs_reply_to_fkey;
