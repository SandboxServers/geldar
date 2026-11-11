-- Migration 0010: every write the register role makes to players and tokens goes through an
-- owner-checked SECURITY DEFINER function (decision 0135; orchestrator rulings R34, R35, R36).
-- 0009 is applied on nodes and is not edited.
--
-- F1: 0009 pinned search_path = pg_catalog, public. Postgres searches pg_temp FIRST for relations
-- when it is not listed, and geldar_register may create temp tables, so a session could shadow
-- mcp_identities and mcp_players with its own and fool the owner check. Every function here pins
-- the path with pg_temp LAST and also schema-qualifies each table.
-- F2: the role loses its direct INSERT and UPDATE on players, tokens, budgets and agents.
-- R36: a lifetime cap of 10 player creations per owner (retired players count), so create and
-- retire cannot churn for ever.
-- R35: geldar_mcp reads banned_at, so the MCP refuses the tokens of a banned identity.

-- mints a token only for a player of the calling identity's owner (replaces 0009's body)
CREATE OR REPLACE FUNCTION register_mint_token(
  p_identity_hash BYTEA,
  p_player_id TEXT,
  p_token_id TEXT,
  p_token_hash BYTEA
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $mint$
DECLARE
  who TEXT;
  status_now TEXT;
BEGIN
  SELECT i.owner_id INTO who
    FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash AND i.banned_at IS NULL;
  IF who IS NULL THEN
    RAISE EXCEPTION 'register_mint_token: unknown or banned identity' USING ERRCODE = '42501';
  END IF;
  SELECT p.status INTO status_now
    FROM public.mcp_players p
    WHERE p.player_id = p_player_id AND p.owner_id = who
    FOR UPDATE;
  IF status_now IS NULL THEN
    RAISE EXCEPTION 'register_mint_token: not your player' USING ERRCODE = '42501';
  END IF;
  IF status_now = 'retired' THEN
    RAISE EXCEPTION 'register_mint_token: player is retired' USING ERRCODE = '42501';
  END IF;
  UPDATE public.mcp_tokens SET revoked_at = now()
    WHERE player_id = p_player_id AND revoked_at IS NULL;
  INSERT INTO public.mcp_tokens (token_id, player_id, token_hash, expires_at)
    VALUES (p_token_id, p_player_id, p_token_hash, now() + interval '30 days');
END
$mint$;

-- Creates the life, the player, its first budget and its first token for the calling identity's
-- owner, in the caller's transaction. The owner row is locked so two creates cannot both pass the
-- lifetime count. The cap trigger (0006) still refuses a player past the owner's player_cap.
CREATE FUNCTION register_create_player(
  p_identity_hash BYTEA,
  p_player_id TEXT,
  p_life_id TEXT,
  p_name TEXT,
  p_harness TEXT,
  p_shard TEXT,
  p_credits INT,
  p_token_id TEXT,
  p_token_hash BYTEA
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $create$
DECLARE
  who TEXT;
  made INT;
  lifetime_max CONSTANT INT := 10;
BEGIN
  SELECT i.owner_id INTO who
    FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash AND i.banned_at IS NULL;
  IF who IS NULL THEN
    RAISE EXCEPTION 'register_create_player: unknown or banned identity' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.mcp_owners o WHERE o.owner_id = who FOR UPDATE;
  SELECT count(*)::int INTO made FROM public.mcp_players p WHERE p.owner_id = who;
  IF made >= lifetime_max THEN
    RAISE EXCEPTION 'owner % has made % players, the lifetime limit', who, made
      USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
                             declared_model, model_config, tier, personality_seed)
    VALUES (p_life_id, p_name, 1, p_life_id, p_shard, 'sovereign', who, p_harness,
            'self-reported', 'declared:unverified', 'sovereign', NULL);
  INSERT INTO public.mcp_players (player_id, owner_id, life_id, display_name, harness, status)
    VALUES (p_player_id, who, p_life_id, p_name, p_harness, 'active');
  INSERT INTO public.mcp_budget (life_id, credits, accrued_at) VALUES (p_life_id, p_credits, now());
  PERFORM public.register_mint_token(p_identity_hash, p_player_id, p_token_id, p_token_hash);
END
$create$;

-- Retires the calling identity's own player and revokes its tokens. False when the player is not
-- theirs or is already retired.
CREATE FUNCTION register_retire_player(p_identity_hash BYTEA, p_player_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $retire$
DECLARE
  who TEXT;
  hit TEXT;
BEGIN
  SELECT i.owner_id INTO who
    FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash AND i.banned_at IS NULL;
  IF who IS NULL THEN
    RAISE EXCEPTION 'register_retire_player: unknown or banned identity' USING ERRCODE = '42501';
  END IF;
  UPDATE public.mcp_players SET status = 'retired'
    WHERE player_id = p_player_id AND owner_id = who AND status <> 'retired'
    RETURNING player_id INTO hit;
  IF hit IS NULL THEN
    RETURN FALSE;
  END IF;
  UPDATE public.mcp_tokens SET revoked_at = now()
    WHERE player_id = p_player_id AND revoked_at IS NULL;
  RETURN TRUE;
END
$retire$;

REVOKE ALL ON FUNCTION register_create_player(BYTEA, TEXT, TEXT, TEXT, TEXT, TEXT, INT, TEXT, BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_retire_player(BYTEA, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_create_player(BYTEA, TEXT, TEXT, TEXT, TEXT, TEXT, INT, TEXT, BYTEA)
  TO geldar_register;
GRANT EXECUTE ON FUNCTION register_retire_player(BYTEA, TEXT) TO geldar_register;

-- The role keeps its reads, and the inserts of owners and identities (sign-up). Nothing else is
-- writable: the functions above do the rest as the migration owner, so the cap trigger no longer
-- runs as the role and needs no UPDATE on mcp_owners.
REVOKE INSERT ON mcp_players FROM geldar_register;
REVOKE INSERT ON mcp_budget FROM geldar_register;
REVOKE INSERT (agent_id, name, life_seq, game_account, shard, mode, owner, harness, declared_model,
               model_config, tier, personality_seed) ON agents FROM geldar_register;
REVOKE UPDATE (status) ON mcp_players FROM geldar_register;
REVOKE UPDATE (revoked_at) ON mcp_tokens FROM geldar_register;
REVOKE UPDATE (display) ON mcp_owners FROM geldar_register;

-- R35: the MCP refuses a token whose owner identity is banned.
GRANT SELECT (owner_id, banned_at) ON mcp_identities TO geldar_mcp;

INSERT INTO schema_migrations (version) VALUES ('0010') ON CONFLICT DO NOTHING;
