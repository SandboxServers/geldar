-- Migration 0038 (C7-03c1): the geldar_helper role. Run as a superuser after every migration, like
-- check-schema-supervisor-display-name.sql. It reads no data; it asserts the grants only.
DO $check$
DECLARE
  step TEXT;
  sig CONSTANT TEXT := 'supervisor_player_display_name(text,text)';
BEGIN
  step := 'body helper: geldar_helper exists and is NOLOGIN';
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geldar_helper' AND NOT rolcanlogin) THEN
    RAISE EXCEPTION 'schema check (%): geldar_helper must exist as NOLOGIN', step;
  END IF;

  step := 'body helper: geldar_helper may execute the display name function';
  IF NOT has_function_privilege('geldar_helper', sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'schema check (%): geldar_helper must execute it', step;
  END IF;

  step := 'body helper: geldar_helper has no table privilege on the roster or the players';
  IF has_table_privilege('geldar_helper', 'mcp_roster', 'SELECT')
     OR has_table_privilege('geldar_helper', 'mcp_players', 'SELECT')
     OR has_table_privilege('geldar_helper', 'mcp_roster', 'INSERT')
     OR has_table_privilege('geldar_helper', 'mcp_players', 'UPDATE') THEN
    RAISE EXCEPTION 'schema check (%): geldar_helper must hold no table privilege', step;
  END IF;

  step := 'body helper: schema_migrations records 0038';
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0038') THEN
    RAISE EXCEPTION 'schema check (%): schema_migrations must record 0038', step;
  END IF;
END
$check$;
