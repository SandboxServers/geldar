-- Migration 0011: sign-up goes through an owner-checked SECURITY DEFINER function too, so the
-- register role writes no table directly (decision 0135; rulings R34, and pass-2 findings F12 to F17).
-- 0010 is applied on nodes and is not edited.
--
-- F12: with a direct INSERT on mcp_identities the role could name the owner of any identity-less
-- (operator-created) owner and mint tokens for it, and with a direct INSERT on mcp_owners it chose
-- owner ids and caps. Both inserts now happen only in register_create_owner.
-- F13: the starting credits are a constant inside register_create_player, not an argument; the life
-- id must be the player id with '-' written '_'; the shard is checked for shape.
-- F14: the owner-cap trigger function pins its own search_path (pg_temp last) and qualifies tables.
-- F17: mint and create lock the identity row, so a concurrent ban either commits first (the mint
-- refuses) or waits for the mint (and the ban's token update then sees the new token).

-- Sign-up: one owner (player_cap stays at its default) and its one identity, in the caller's
-- transaction. An owner id that exists, or an identity hash that exists, fails on its unique key.
CREATE FUNCTION register_create_owner(
  p_identity_hash BYTEA,
  p_provider TEXT,
  p_owner_id TEXT,
  p_display TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $owner$
BEGIN
  IF p_provider NOT IN ('github', 'discord') THEN
    RAISE EXCEPTION 'register_create_owner: unknown provider' USING ERRCODE = '22023';
  END IF;
  IF p_owner_id !~ '^[a-z0-9][a-z0-9-]{0,39}$' THEN
    RAISE EXCEPTION 'register_create_owner: bad owner id' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.mcp_owners (owner_id, display) VALUES (p_owner_id, p_display);
  INSERT INTO public.mcp_identities (identity_hash, provider, owner_id)
    VALUES (p_identity_hash, p_provider, p_owner_id);
END
$owner$;

-- the cap trigger of 0006, with its path pinned: it runs inside the definer functions and inherits
-- the caller's path otherwise, and a temp table named mcp_owners could lift the owner's cap
CREATE OR REPLACE FUNCTION mcp_enforce_owner_cap() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  owner_cap INT;
  counted INT;
BEGIN
  IF NEW.status = 'retired' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'retired' AND OLD.owner_id = NEW.owner_id THEN
    RETURN NEW;
  END IF;
  SELECT player_cap INTO owner_cap FROM public.mcp_owners WHERE owner_id = NEW.owner_id FOR UPDATE;
  IF owner_cap IS NULL THEN
    RAISE EXCEPTION 'owner % does not exist', NEW.owner_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  SELECT count(*)::int INTO counted FROM public.mcp_players
    WHERE owner_id = NEW.owner_id AND status <> 'retired' AND player_id <> NEW.player_id;
  IF counted + 1 > owner_cap THEN
    RAISE EXCEPTION 'owner % is at the cap of % sovereign players', NEW.owner_id, owner_cap
      USING ERRCODE = 'check_violation',
            HINT = 'retire a player or raise the cap with mcp-tokens owner set-cap';
  END IF;
  RETURN NEW;
END
$fn$;

-- mint: the identity row is locked (F17)
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
    WHERE i.identity_hash = p_identity_hash AND i.banned_at IS NULL
    FOR UPDATE;
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

-- create: the credits argument goes away (F13), the identity row is locked (F17)
DROP FUNCTION register_create_player(BYTEA, TEXT, TEXT, TEXT, TEXT, TEXT, INT, TEXT, BYTEA);
CREATE FUNCTION register_create_player(
  p_identity_hash BYTEA,
  p_player_id TEXT,
  p_life_id TEXT,
  p_name TEXT,
  p_harness TEXT,
  p_shard TEXT,
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
  -- the shard's sovereign.budget.cap_credits; a repo check pins it to the shard file
  start_credits CONSTANT INT := 240;
BEGIN
  IF p_life_id IS DISTINCT FROM replace(p_player_id, '-', '_') THEN
    RAISE EXCEPTION 'register_create_player: the life id must be the player id with underscores'
      USING ERRCODE = '22023';
  END IF;
  IF p_shard !~ '^[a-z0-9][a-z0-9_-]{0,31}$' THEN
    RAISE EXCEPTION 'register_create_player: bad shard' USING ERRCODE = '22023';
  END IF;
  SELECT i.owner_id INTO who
    FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash AND i.banned_at IS NULL
    FOR UPDATE;
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
  INSERT INTO public.mcp_budget (life_id, credits, accrued_at) VALUES (p_life_id, start_credits, now());
  PERFORM public.register_mint_token(p_identity_hash, p_player_id, p_token_id, p_token_hash);
END
$create$;

-- every definer function: no PUBLIC execute, the register role only
REVOKE ALL ON FUNCTION register_create_owner(BYTEA, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_create_player(BYTEA, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_mint_token(BYTEA, TEXT, TEXT, BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_retire_player(BYTEA, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_create_owner(BYTEA, TEXT, TEXT, TEXT) TO geldar_register;
GRANT EXECUTE ON FUNCTION register_create_player(BYTEA, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BYTEA)
  TO geldar_register;
GRANT EXECUTE ON FUNCTION register_mint_token(BYTEA, TEXT, TEXT, BYTEA) TO geldar_register;
GRANT EXECUTE ON FUNCTION register_retire_player(BYTEA, TEXT) TO geldar_register;

-- F12: no direct insert on owners or identities; the role keeps its reads
REVOKE INSERT ON mcp_owners FROM geldar_register;
REVOKE INSERT ON mcp_identities FROM geldar_register;

INSERT INTO schema_migrations (version) VALUES ('0011') ON CONFLICT DO NOTHING;
