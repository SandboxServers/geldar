-- Migration 0012: the register role reads identities only through functions (decision 0135; pass-3
-- finding F19). 0008 to 0011 are applied on nodes and are not edited.
--
-- With a table-wide SELECT on mcp_identities the role could read every identity hash and pass any
-- of them to the owner-checked definer functions, which derive the owner from the hash. It now reads
-- nothing directly: each read the service needs is one SECURITY DEFINER function that answers for the
-- identity hash the caller names, or (the churn cap) returns a count.
-- Known limit: the service holds the HMAC pepper, so it can still derive the hash of a provider id
-- it knows; a database grant cannot prevent that (threshold/register/README.md, Known limits).
--
-- F22: free text and ids that the service creates are bounded in the definer functions.

-- the owner of the named identity, and whether it is banned
CREATE FUNCTION register_find_owner(p_identity_hash BYTEA)
RETURNS TABLE (owner_id TEXT, banned BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $find$
  SELECT i.owner_id, i.banned_at IS NOT NULL
    FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash;
$find$;

-- the players of the named identity's owner: the four columns the account page shows
CREATE FUNCTION register_list_players(p_identity_hash BYTEA)
RETURNS TABLE (player_id TEXT, display_name TEXT, harness TEXT, status TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $list$
  SELECT p.player_id, p.display_name, p.harness, p.status
    FROM public.mcp_players p
    JOIN public.mcp_identities i ON i.owner_id = p.owner_id
    WHERE i.identity_hash = p_identity_hash
    ORDER BY p.player_id;
$list$;

-- the sign-up churn cap: how many identities were created since a time (a count, no hash)
CREATE FUNCTION register_count_new_owners(p_since TIMESTAMPTZ) RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $count$
  SELECT count(*)::int FROM public.mcp_identities i WHERE i.created_at >= p_since;
$count$;

REVOKE ALL ON FUNCTION register_find_owner(BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_list_players(BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_count_new_owners(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_find_owner(BYTEA) TO geldar_register;
GRANT EXECUTE ON FUNCTION register_list_players(BYTEA) TO geldar_register;
GRANT EXECUTE ON FUNCTION register_count_new_owners(TIMESTAMPTZ) TO geldar_register;

-- no direct read of any table the service touches
REVOKE SELECT ON mcp_identities, mcp_owners, mcp_players FROM geldar_register;
REVOKE SELECT (agent_id, name, life_seq, shard, mode, owner) ON agents FROM geldar_register;
REVOKE SELECT (token_id, player_id, label, created_at, expires_at, revoked_at, last_used_at)
  ON mcp_tokens FROM geldar_register;

-- F22: bounds. The owner id is the shape the service makes (reg-<hex>), at most 40 characters.
CREATE OR REPLACE FUNCTION register_create_owner(
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
  IF p_owner_id !~ '^reg-[a-z0-9-]{1,36}$' THEN
    RAISE EXCEPTION 'register_create_owner: bad owner id' USING ERRCODE = '22023';
  END IF;
  IF p_display IS NULL OR char_length(p_display) > 100 THEN
    RAISE EXCEPTION 'register_create_owner: bad display' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.mcp_owners (owner_id, display) VALUES (p_owner_id, p_display);
  INSERT INTO public.mcp_identities (identity_hash, provider, owner_id)
    VALUES (p_identity_hash, p_provider, p_owner_id);
END
$owner$;

-- create: the name is 1 to 64 characters. Body of 0011 otherwise unchanged.
CREATE OR REPLACE FUNCTION register_create_player(
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
  IF p_name IS NULL OR char_length(p_name) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'register_create_player: bad name' USING ERRCODE = '22023';
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

INSERT INTO schema_migrations (version) VALUES ('0012') ON CONFLICT DO NOTHING;
