-- Migration 0038 (C7-03c1, decision 0260): the body helper's narrow Postgres role.
-- The helper is a root-owned host process. It checks a roster name before it starts a Body, and the
-- only database read it needs is supervisor_player_display_name (0033), a definer function that answers
-- one name for one owner. The role is created NOLOGIN here; C7-03c2 sets its password, and only then
-- can it log in. It gets no table privilege, so it cannot read mcp_roster or mcp_players directly.

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geldar_helper') THEN
    CREATE ROLE geldar_helper NOLOGIN;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
END
$role$;

GRANT EXECUTE ON FUNCTION supervisor_player_display_name(TEXT, TEXT) TO geldar_helper;

INSERT INTO schema_migrations (version) VALUES ('0038') ON CONFLICT DO NOTHING;
