-- Migration 0063 (BH-1, body-host design, decisions 0260 and 0261): the life id and the managed
-- player-host config that the body helper and a managed Body read. Additive: one column, functions, one
-- role and grants.
--
-- mcp_players.host_key (uuid) is a per-agent key the server generates: DEFAULT gen_random_uuid() (built in
-- from PG13, no extension). The life id is derived from it, not from player_id, because the owner chooses
-- player_id at sign-up: an id derived from player_id could be steered to collide with a victim's id, a
-- targeted denial of service. The default backfills existing rows on ADD COLUMN. host_key is never returned
-- by any function or view here, and no role but the table owner reads it: geldar_mcp keeps SELECT on the six
-- existing columns only (explicit column grant), and the helper and body roles hold no table privilege.
--
-- managed_life_id(host key text) is the one place the managed life id is computed: 'ag_' followed by the
-- first 12 lower-case hex digits of sha256 of the host key text. It is 15 characters, matches
-- ^ag_[a-z0-9]{1,12}$, and does not change when player_id or the display name changes. It is not granted to
-- anyone: the definer functions below run as the owner.
--
-- supervisor_player_life_id(owner, name) (role geldar_helper, 0038) answers the life id of a live player on
-- the owner's roster (0024), matched as 0033 matches the name. It answers NULL when the name is not on the
-- roster, when the owner does not hold it, when the owner has a banned identity (0008), or when the name
-- matches no single live player. It raises 23505 when another agent maps to the same id: with a server key
-- that is a chance collision only (48 bits, about 1.8e-9 at 1,000 agents), and the helper refuses rather
-- than guesses.
--
-- player_host_config(life_id) (role geldar_body_host, NOLOGIN, created here) answers one JSON object with
-- exactly four keys: display_name, harness, model, character_sheet. It answers NULL for an id that maps to no
-- agent, for a retired player, for an owner with a banned identity, and for a player whose roster row is gone
-- (0024, same join as 0033): a removed or account-deleted agent's Body must not boot. It raises 23505 on a
-- collision, as above. It never returns host_key, a token hash, an identity hash or an owner id. The role
-- gets EXECUTE on this one function and no table privilege.

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geldar_body_host') THEN
    CREATE ROLE geldar_body_host NOLOGIN;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
END
$role$;

ALTER TABLE mcp_players ADD COLUMN IF NOT EXISTS host_key UUID NOT NULL DEFAULT gen_random_uuid();

-- geldar_mcp read the whole table (0002). Narrow it to the six columns it has always read, so the new key
-- is not readable by the MCP role. Any future column needs its own grant.
REVOKE SELECT ON mcp_players FROM geldar_mcp;
GRANT SELECT (player_id, owner_id, life_id, display_name, harness, status) ON mcp_players TO geldar_mcp;

CREATE OR REPLACE FUNCTION managed_life_id(p_host_key TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT 'ag_' || left(encode(sha256(convert_to(p_host_key, 'UTF8')), 'hex'), 12)
$fn$;

CREATE OR REPLACE FUNCTION supervisor_player_life_id(p_owner TEXT, p_name TEXT) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  n INT;
  hk TEXT;
  lid TEXT;
BEGIN
  SELECT count(*), min(p.host_key::text) INTO n, hk
    FROM public.mcp_players p
    JOIN public.mcp_roster r ON r.player_name = lower(p_name) AND r.owner_id = p_owner
   WHERE p.owner_id = p_owner
     AND lower(p.display_name) = lower(p_name)
     AND p.status <> 'retired'
     AND NOT EXISTS (SELECT 1 FROM public.mcp_identities i
                      WHERE i.owner_id = p.owner_id AND i.banned_at IS NOT NULL);
  IF n <> 1 THEN
    RETURN NULL;
  END IF;
  lid := managed_life_id(hk);
  SELECT count(*) INTO n FROM public.mcp_players q WHERE managed_life_id(q.host_key::text) = lid;
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
  SELECT count(*) INTO n FROM public.mcp_players q WHERE managed_life_id(q.host_key::text) = p_life_id;
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
   WHERE managed_life_id(p.host_key::text) = p_life_id
     AND p.status <> 'retired'
     AND NOT EXISTS (SELECT 1 FROM public.mcp_identities i
                      WHERE i.owner_id = p.owner_id AND i.banned_at IS NOT NULL)
     AND EXISTS (SELECT 1 FROM public.mcp_roster r
                  WHERE r.owner_id = p.owner_id AND r.player_name = lower(p.display_name));
  RETURN cfg;
END
$fn$;

REVOKE ALL ON FUNCTION managed_life_id(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION supervisor_player_life_id(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervisor_player_life_id(TEXT, TEXT) TO geldar_helper;
REVOKE ALL ON FUNCTION player_host_config(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION player_host_config(TEXT) TO geldar_body_host;

INSERT INTO schema_migrations (version) VALUES ('0063') ON CONFLICT DO NOTHING;
