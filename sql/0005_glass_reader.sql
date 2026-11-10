-- Migration 0005: the read-only role for Glass and the report generator (wave 6 section 4 item 11,
-- provisional; the one stated exception to decision D-P0-11). 0004 is applied and is not edited.
-- Like every migration, it inserts its own schema_migrations row.

INSERT INTO schema_migrations (version) VALUES ('0005') ON CONFLICT DO NOTHING;

-- NOLOGIN here: the password is set by `migrate --set-role-password geldar_glass`, and the login is
-- granted by that step, never by this file. The role can read the five tables Glass reads and six
-- columns of events, and nothing else: no writes, no sequences, no default privileges, no mcp_*
-- table (mcp_tokens holds token hashes).
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geldar_glass') THEN
    CREATE ROLE geldar_glass NOLOGIN;
  END IF;
END
$role$;

GRANT USAGE ON SCHEMA public TO geldar_glass;
GRANT SELECT ON thoughts, actions, receipts, intents, agents TO geldar_glass;

-- events carries raw world text in payload, so the report generator (wave 6 item 12, interface
-- request) gets column-level SELECT only: the type, the agent, the world day and tick, the time and
-- the source event id. payload is not granted to geldar_glass.
GRANT SELECT (type, agent_id, world_day, world_tick, at, source_event_id) ON events TO geldar_glass;
