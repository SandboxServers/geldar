-- Migration 0007: the audit tables are append-only (decision 0085). receipts, thoughts,
-- suppressed_wakeups and mcp_journal record what happened, so a changed or deleted row is evidence
-- lost. A BEFORE UPDATE OR DELETE trigger on each table refuses the change for every role, the
-- superuser included. TRUNCATE is not blocked: a throwaway database may clear its tables, and the
-- integration tests do so behind a guard. 0002 to 0006 are applied and are not edited. Like every
-- migration, it inserts its own schema_migrations row. Every statement here may run again.

-- memories, goals and relationships change state (animus memory store), so they are not covered.
-- intents and actions are written in place by the projection, so they are not covered either.
CREATE OR REPLACE FUNCTION journal_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'append-only: % on % is refused', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation',
          HINT = 'these tables record evidence; a reset writes a new record and keeps the old rows';
END
$fn$;

DROP TRIGGER IF EXISTS receipts_append_only ON receipts;
CREATE TRIGGER receipts_append_only
BEFORE UPDATE OR DELETE ON receipts
FOR EACH ROW EXECUTE FUNCTION journal_append_only();

DROP TRIGGER IF EXISTS thoughts_append_only ON thoughts;
CREATE TRIGGER thoughts_append_only
BEFORE UPDATE OR DELETE ON thoughts
FOR EACH ROW EXECUTE FUNCTION journal_append_only();

DROP TRIGGER IF EXISTS suppressed_wakeups_append_only ON suppressed_wakeups;
CREATE TRIGGER suppressed_wakeups_append_only
BEFORE UPDATE OR DELETE ON suppressed_wakeups
FOR EACH ROW EXECUTE FUNCTION journal_append_only();

DROP TRIGGER IF EXISTS mcp_journal_append_only ON mcp_journal;
CREATE TRIGGER mcp_journal_append_only
BEFORE UPDATE OR DELETE ON mcp_journal
FOR EACH ROW EXECUTE FUNCTION journal_append_only();

-- 0003 granted geldar_mcp DELETE on mcp_journal for the trim that the bounded read replaces. The
-- role keeps INSERT and SELECT only, so the sovereign MCP cannot change its own journal.
REVOKE UPDATE, DELETE ON mcp_journal FROM geldar_mcp;

INSERT INTO schema_migrations (version) VALUES ('0007') ON CONFLICT DO NOTHING;
