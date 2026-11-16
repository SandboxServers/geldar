-- Migration 0066 (T-08): the W3C trace id of an event, on the events table. The sink reads the traceparent
-- header of each NATS message and writes its 32-hex trace id here; an event without one keeps NULL.
-- Apply 0066 BEFORE the new eventsink image starts: until this column exists, every INSERT from the new sink
-- fails with 42703 and is retried until the migration lands. The column
-- is nullable with no default and no backfill, so the ALTER only changes metadata. The events table is large
-- (570k+ messages in JetStream), so nothing in this file may rewrite or scan it: no default, no NOT NULL, no
-- index. Rollback: the column stays and is harmless; nothing reads it, and dropping it is not needed to recover.
-- Trace ids are never projected into an agent-visible table. geldar_glass keeps its fixed column list (0005),
-- and the MCP reads no events columns (0003 limits geldar_mcp), so the column stays hidden from both, the
-- same as the harness and model columns of 0037. ADD COLUMN IF NOT EXISTS makes a reapply of this file a no-op.

ALTER TABLE events ADD COLUMN IF NOT EXISTS trace_id TEXT;

INSERT INTO schema_migrations (version) VALUES ('0066') ON CONFLICT DO NOTHING;
