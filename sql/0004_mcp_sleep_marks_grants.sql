-- Migration 0004: the grants review of wave M fix round 2 (F5). 0003 is applied and is not edited;
-- this file narrows its grant. Like every migration, it inserts its own schema_migrations row.

INSERT INTO schema_migrations (version) VALUES ('0004') ON CONFLICT DO NOTHING;

-- 0003 granted UPDATE on the whole mcp_sleep_marks table, so the MCP could rewrite the life_id that
-- keys the mark. The server's upsert (pg-agents.ts) writes three columns only: the sleep day, the
-- cursor and the timestamp. The table-level UPDATE goes; the column grant covers those three.
REVOKE UPDATE ON mcp_sleep_marks FROM geldar_mcp;
GRANT UPDATE (last_sleep_day, sleep_cursor, updated_at) ON mcp_sleep_marks TO geldar_mcp;

-- DELETE on mcp_journal stays table-wide by design. The journal store trims each life to its newest
-- 1000 rows (pg-journal.ts). Postgres grants cannot limit DELETE to a life's rows, so the WHERE
-- life_id = $1 in that store is what keeps the trim to one life.
