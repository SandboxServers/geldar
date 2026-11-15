-- Migration 0063 (BH-1, body-host design, decisions 0260 and 0261): the life id and the managed
-- player-host config that the body helper and a managed Body read. Additive: functions, one role and grants.
--
-- managed_life_id(player_id) is the one place the managed life id is computed: 'ag_' followed by the first
-- 12 lower-case hex digits of sha256 of the agent's player_id (mcp_players, the stable agent key; the schema
-- has no uuid column). It is 15 characters, matches ^ag_[a-z0-9]{1,12}$, and does not change when the
-- display name changes. It is not granted to anyone: the definer functions below run as the owner.
--
-- supervisor_player_life_id(owner, name) (role geldar_helper, 0038) answers the life id of a live player on
-- the owner's roster (0024), matched as 0033 matches the name. It answers NULL when the name is not on the
-- roster, when the owner does not hold it, or when the name matches no single live player. It raises
-- 23505 when another agent maps to the same id, so the helper refuses rather than guesses.
--
-- player_host_config(life_id) (role geldar_body_host, NOLOGIN, created here) answers one JSON object with
-- exactly four keys: display_name, harness, model, character_sheet. It answers NULL for an id that maps to no
-- agent, for a retired player, and for an owner with a banned identity (0008). It raises 23505 on a
-- collision, as above. It never returns a token hash, an identity hash or an owner id. The role gets
-- EXECUTE on this one function and no table privilege.

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geldar_body_host') THEN
    CREATE ROLE geldar_body_host NOLOGIN;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
END
$role$;

CREATE OR REPLACE FUNCTION managed_life_id(p_player_id TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT 'ag_' || left(encode(sha256(convert_to(p_player_id, 'UTF8')), 'hex'), 12)
$fn$;

CREATE OR REPLACE FUNCTION supervisor_player_life_id(p_owner TEXT, p_name TEXT) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  n INT;
  pid TEXT;
  lid TEXT;
BEGIN
  SELECT count(*), min(p.player_id) INTO n, pid
    FROM public.mcp_players p
    JOIN public.mcp_roster r ON r.player_name = lower(p_name) AND r.owner_id = p_owner
   WHERE p.owner_id = p_owner
     AND lower(p.display_name) = lower(p_name)
     AND p.status <> 'retired';
  IF n <> 1 THEN
    RETURN NULL;
  END IF;
  lid := managed_life_id(pid);
  SELECT count(*) INTO n FROM public.mcp_players q WHERE managed_life_id(q.player_id) = lid;
  IF n <> 1 THEN
    RAISE EXCEPTION 'supervisor_player_life_id: two agents map to one life id' USING ERRCODE = '23505';
  END IF;
  RETURN lid;
END
$fn$;

CREATE OR REPLACE FUNCTION player_host_config(p_life_id TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  n INT;
  cfg JSONB;
BEGIN
  SELECT count(*) INTO n FROM public.mcp_players q WHERE managed_life_id(q.player_id) = p_life_id;
  IF n = 0 THEN
    RETURN NULL;
  END IF;
  IF n <> 1 THEN
    RAISE EXCEPTION 'player_host_config: two agents map to one life id' USING ERRCODE = '23505';
  END IF;
  SELECT jsonb_build_object(
           'display_name', p.display_name,
           'harness', p.harness,
           'model', a.declared_model,
           'character_sheet', a.character_sheet)
    INTO cfg
    FROM public.mcp_players p
    JOIN public.agents a ON a.agent_id = p.life_id
   WHERE managed_life_id(p.player_id) = p_life_id
     AND p.status <> 'retired'
     AND NOT EXISTS (SELECT 1 FROM public.mcp_identities i
                      WHERE i.owner_id = p.owner_id AND i.banned_at IS NOT NULL);
  RETURN cfg;
END
$fn$;

REVOKE ALL ON FUNCTION managed_life_id(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION supervisor_player_life_id(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervisor_player_life_id(TEXT, TEXT) TO geldar_helper;
REVOKE ALL ON FUNCTION player_host_config(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION player_host_config(TEXT) TO geldar_body_host;

INSERT INTO schema_migrations (version) VALUES ('0063') ON CONFLICT DO NOTHING;
