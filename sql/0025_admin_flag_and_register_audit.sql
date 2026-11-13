-- Migration 0025 (decision 0170, C7-12): the admin flag and the append-only register audit table.
-- is_admin is set and unset only by the operator CLI (tools/mcp-tokens owner admin set|unset), which
-- runs with the operator database role. The register role reads the flag (to exempt an admin's
-- fixed-window limits) only through register_is_admin below, and gets no privilege on mcp_owners:
-- no UPDATE, no column SELECT. No API route, page or key scope can write the flag.
-- The flag never grants reach: an admin still sees only their own owner's rows (0170).
-- register_audit.actor is left(encode(sha256(convert_to(owner_id, 'UTF8')), 'hex'), 16) for an owner's
-- action. The SQL functions (0032 renew and revoke) write this sha256 hex prefix. The TypeScript audit
-- writer must produce the same value when C7-10 wires it (no code change in this migration); the
-- supervisor (C7-03a) writes the same form today.
-- The operator CLI writes 'operator'. The trigger refuses UPDATE and DELETE for every role. The table
-- owner or a superuser can still TRUNCATE the table or disable the trigger, as 0007 documents.

ALTER TABLE mcp_owners ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- The register reads the flag through this definer function, not through the table: a WHERE on
-- owner_id would need a column grant on owner_id, which the 0012 read gates forbid. Fails closed:
-- an unknown owner reads false.
CREATE OR REPLACE FUNCTION register_is_admin(p_owner TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT coalesce((SELECT o.is_admin FROM public.mcp_owners o WHERE o.owner_id = p_owner), false)
$fn$;

REVOKE ALL ON FUNCTION register_is_admin(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_is_admin(TEXT) TO geldar_register;

-- The audit base (0085): one row per state-changing action. Rows are never updated or deleted.
-- actor is the owner id hash (the form in the header) or 'operator'; detail is short and carries no names or emails.
CREATE TABLE IF NOT EXISTS register_audit (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL CHECK (char_length(actor) BETWEEN 1 AND 64),
  action TEXT NOT NULL CHECK (char_length(action) BETWEEN 1 AND 64),
  target TEXT NOT NULL CHECK (char_length(target) BETWEEN 1 AND 128),
  outcome TEXT NOT NULL CHECK (char_length(outcome) BETWEEN 1 AND 32),
  admin BOOLEAN NOT NULL DEFAULT false,
  detail TEXT NOT NULL DEFAULT '' CHECK (char_length(detail) <= 256)
);

CREATE OR REPLACE FUNCTION register_audit_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $fn$
BEGIN
  RAISE EXCEPTION 'append-only: % on % is refused', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation',
          HINT = 'the audit trail is never edited; a correction is a new row';
END
$fn$;

DROP TRIGGER IF EXISTS register_audit_append_only ON register_audit;
CREATE TRIGGER register_audit_append_only
BEFORE UPDATE OR DELETE ON register_audit
FOR EACH ROW EXECUTE FUNCTION register_audit_append_only();

-- A trigger function is not an API: no role but the migration owner may execute it (gates of 0011).
REVOKE ALL ON FUNCTION register_audit_append_only() FROM PUBLIC;

REVOKE ALL ON register_audit FROM PUBLIC;
GRANT SELECT, INSERT ON register_audit TO geldar_register;
REVOKE UPDATE, DELETE, TRUNCATE ON register_audit FROM geldar_register;
-- The register writes its own audit rows by a direct INSERT (renew and revoke rows come from 0032, and
-- the TypeScript audit writes), so it needs the id sequence too.
GRANT USAGE ON SEQUENCE register_audit_id_seq TO geldar_register;

INSERT INTO schema_migrations (version) VALUES ('0025') ON CONFLICT DO NOTHING;
