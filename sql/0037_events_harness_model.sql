-- Migration 0037 (GX-01a): the harness and model stamp on the event envelope and the events table. The Body and
-- the MCP stamp each event with the harness that produced it (for example claude) and the model it declared
-- (for example claude-sonnet-5.5). Both are optional: an event no Body or MCP stamped keeps NULL, so every
-- existing event stays valid. The sink writes the two columns from the envelope. No index: a cohort export reads
-- the table offline. geldar_glass keeps its column list (0005), so Glass cannot read the two new columns.
-- The GRANT lets the MCP read the declared model of an agent; 0003 limited geldar_mcp to six columns of agents.

ALTER TABLE events ADD COLUMN harness TEXT CHECK (harness IS NULL OR harness ~ '^[a-z][a-z0-9-]{0,31}$'),
                   ADD COLUMN model   TEXT CHECK (model IS NULL OR length(model) BETWEEN 1 AND 128);
GRANT SELECT (declared_model) ON agents TO geldar_mcp;

INSERT INTO schema_migrations (version) VALUES ('0037') ON CONFLICT DO NOTHING;
