-- Migration 0061 (ROSTER-AUTO, decision 0261 item 3a; DISPLAYNAME-SHAPE): the register writes the
-- roster row for a new agent, in the same transaction as the agent create (0012). The register role
-- has no direct write on mcp_roster; it calls register_roster_add once per create, after
-- register_create_player, inside one BEGIN and COMMIT in threshold/register/src/pg-store.ts.
--
-- The function resolves the owner from the identity hash (a banned identity is refused), refuses a
-- display name that is not a valid Minecraft login (3 to 16 letters, digits or underscore), and writes
-- the roster row keyed on the lower-cased name. The display name keeps its case in mcp_players, not
-- here. Idempotent: the same owner and name writes nothing and raises nothing. A name held by another
-- owner raises 23505 and leaves the row as it was. One register_audit row per successful call, with
-- the owner id, the action and the name only. The per-owner agent cap is the existing trigger 0006
-- on mcp_players (player_cap, default 3); this migration does not change it.
--
-- Additive: it adds the function and its grants only. It drops and changes no column.

CREATE OR REPLACE FUNCTION register_roster_add(p_identity_hash BYTEA, p_player_name TEXT) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $roster$
DECLARE
  who TEXT;
  held TEXT;
  key TEXT;
BEGIN
  IF p_player_name IS NULL OR p_player_name !~ '^[A-Za-z0-9_]{3,16}$' THEN
    RAISE EXCEPTION 'register_roster_add: bad display name' USING ERRCODE = '22023';
  END IF;
  SELECT i.owner_id INTO who
    FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash AND i.banned_at IS NULL
    FOR UPDATE;
  IF who IS NULL THEN
    RAISE EXCEPTION 'register_roster_add: unknown or banned identity' USING ERRCODE = '42501';
  END IF;
  key := lower(p_player_name);
  SELECT r.owner_id INTO held FROM public.mcp_roster r WHERE r.player_name = key FOR UPDATE;
  IF held IS NULL THEN
    INSERT INTO public.mcp_roster (player_name, owner_id) VALUES (key, who);
  ELSIF held <> who THEN
    RAISE EXCEPTION 'register_roster_add: the name is held by another owner' USING ERRCODE = '23505';
  END IF;
  -- One audit row per successful create, including the idempotent case. A refused call raised above and wrote nothing.
  INSERT INTO public.register_audit (actor, action, target, outcome, admin, detail)
    VALUES (who, 'roster.add', key, 'ok', false, p_player_name);
END
$roster$;

REVOKE ALL ON FUNCTION register_roster_add(BYTEA, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_roster_add(BYTEA, TEXT) TO geldar_register;

INSERT INTO schema_migrations (version) VALUES ('0061') ON CONFLICT DO NOTHING;
