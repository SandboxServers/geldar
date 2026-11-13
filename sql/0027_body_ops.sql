-- Migration 0027 (C7-03a, decision 0170): the body supervisor's counters and its grants.
-- body_ops keeps one row per accepted start or restart (refused and failed requests keep no row).
-- The supervisor counts its per-agent hourly and per-owner daily starts from it. Rows are never
-- updated or deleted by the supervisor role. The supervisor role reads the admin flag through
-- register_is_admin (0025) and appends to register_audit (0025); it gets no write on mcp_owners.

CREATE TABLE IF NOT EXISTS body_ops (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  owner_id TEXT NOT NULL CHECK (char_length(owner_id) BETWEEN 1 AND 64),
  agent_id TEXT NOT NULL CHECK (char_length(agent_id) BETWEEN 1 AND 128),
  op TEXT NOT NULL CHECK (op IN ('start', 'restart'))
);

CREATE INDEX IF NOT EXISTS body_ops_agent_at ON body_ops (agent_id, at);
CREATE INDEX IF NOT EXISTS body_ops_owner_at ON body_ops (owner_id, at);

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geldar_supervisor') THEN
    CREATE ROLE geldar_supervisor NOLOGIN;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
END
$role$;

REVOKE ALL ON body_ops FROM PUBLIC;
GRANT SELECT, INSERT ON body_ops TO geldar_supervisor;
REVOKE UPDATE, DELETE, TRUNCATE ON body_ops FROM geldar_supervisor;
GRANT USAGE ON SEQUENCE body_ops_id_seq TO geldar_supervisor;

GRANT SELECT ON mcp_roster TO geldar_supervisor;
-- The supervisor reads the admin flag through its own definer function, not register_is_admin: every
-- register_* function is executable by geldar_register only (check-schema.sql, gates of 0011).
-- It delegates to register_is_admin, so the flag rule has one implementation.
CREATE OR REPLACE FUNCTION supervisor_is_admin(p_owner TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT public.register_is_admin(p_owner)
$fn$;
REVOKE ALL ON FUNCTION supervisor_is_admin(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervisor_is_admin(TEXT) TO geldar_supervisor;
GRANT INSERT ON register_audit TO geldar_supervisor;
GRANT USAGE ON SEQUENCE register_audit_id_seq TO geldar_supervisor;

INSERT INTO schema_migrations (version) VALUES ('0027') ON CONFLICT DO NOTHING;
