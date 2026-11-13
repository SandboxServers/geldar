-- Migration 0032 (C7-02a, decision 0170 point 1): the player token lifecycle.
-- A token lives 90 days from issue. A renewal rotates the token: the new token keeps the player id,
-- and every older live token of that player gets a 10 minute grace by ending its expiry. The grace
-- is an expiry, not a revoke, so revoked_at stays NULL and the mcp check (expires_at > now()) reads it
-- as usable until the grace ends. A revoke-only action ends every live token of one player at once.
-- Every function is owner-scoped: an unknown or banned identity, or a player that is not the caller's,
-- is refused with 42501. The register role gets EXECUTE only; it has no write to expires_at.

-- The mint: 90 days (was 30 in 0010). The rest is unchanged: a mint revokes the older tokens at once.
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
    VALUES (p_token_id, p_player_id, p_token_hash, now() + interval '90 days');
END
$mint$;

-- The renewal: needs a live token to rotate (an expired player gets a mint, not a renewal). The new
-- token gets 90 days; each older live token ends at the earliest of its own expiry, p_grace_until and
-- 10 minutes and 1 second from now (the database caps the caller's grace, so a caller cannot extend it).
CREATE FUNCTION register_renew_token(
  p_identity_hash BYTEA,
  p_player_id TEXT,
  p_token_id TEXT,
  p_token_hash BYTEA,
  p_grace_until TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $renew$
DECLARE
  who TEXT;
  status_now TEXT;
  live INT;
BEGIN
  SELECT i.owner_id INTO who
    FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash AND i.banned_at IS NULL
    FOR UPDATE;
  IF who IS NULL THEN
    RAISE EXCEPTION 'register_renew_token: unknown or banned identity' USING ERRCODE = '42501';
  END IF;
  SELECT p.status INTO status_now
    FROM public.mcp_players p
    WHERE p.player_id = p_player_id AND p.owner_id = who
    FOR UPDATE;
  IF status_now IS NULL THEN
    RAISE EXCEPTION 'register_renew_token: not your player' USING ERRCODE = '42501';
  END IF;
  IF status_now = 'retired' THEN
    RAISE EXCEPTION 'register_renew_token: player is retired' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO live
    FROM public.mcp_tokens t
    WHERE t.player_id = p_player_id AND t.revoked_at IS NULL AND t.expires_at > now();
  IF live = 0 THEN
    RAISE EXCEPTION 'register_renew_token: no live token to renew' USING ERRCODE = '42501';
  END IF;
  UPDATE public.mcp_tokens t
    SET expires_at = LEAST(t.expires_at, p_grace_until, now() + interval '10 minutes 1 second')
    WHERE t.player_id = p_player_id AND t.revoked_at IS NULL AND t.expires_at > now();
  INSERT INTO public.mcp_tokens (token_id, player_id, token_hash, expires_at)
    VALUES (p_token_id, p_player_id, p_token_hash, now() + interval '90 days');
END
$renew$;

-- The revoke-only action: no replacement is minted. Returns how many live tokens it ended.
CREATE FUNCTION register_revoke_tokens(p_identity_hash BYTEA, p_player_id TEXT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $revoke$
DECLARE
  who TEXT;
  ended INT;
BEGIN
  SELECT i.owner_id INTO who
    FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash AND i.banned_at IS NULL
    FOR UPDATE;
  IF who IS NULL THEN
    RAISE EXCEPTION 'register_revoke_tokens: unknown or banned identity' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mcp_players p WHERE p.player_id = p_player_id AND p.owner_id = who) THEN
    RAISE EXCEPTION 'register_revoke_tokens: not your player' USING ERRCODE = '42501';
  END IF;
  UPDATE public.mcp_tokens t SET revoked_at = now()
    WHERE t.player_id = p_player_id AND t.revoked_at IS NULL;
  GET DIAGNOSTICS ended = ROW_COUNT;
  RETURN ended;
END
$revoke$;

-- The account data: the newest live token's expiry and last use, for the expiry line and the renewal flag.
-- Zero rows when the player has no live token. Owner-scoped like the functions above.
CREATE FUNCTION register_token_info(p_identity_hash BYTEA, p_player_id TEXT)
RETURNS TABLE (token_expires_at TIMESTAMPTZ, token_last_used_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $info$
DECLARE
  who TEXT;
BEGIN
  SELECT i.owner_id INTO who
    FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash AND i.banned_at IS NULL;
  IF who IS NULL THEN
    RAISE EXCEPTION 'register_token_info: unknown or banned identity' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mcp_players p WHERE p.player_id = p_player_id AND p.owner_id = who) THEN
    RAISE EXCEPTION 'register_token_info: not your player' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT t.expires_at, t.last_used_at
      FROM public.mcp_tokens t
      WHERE t.player_id = p_player_id AND t.revoked_at IS NULL AND t.expires_at > now()
      ORDER BY t.expires_at DESC
      LIMIT 1;
END
$info$;

REVOKE ALL ON FUNCTION register_mint_token(BYTEA, TEXT, TEXT, BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_mint_token(BYTEA, TEXT, TEXT, BYTEA) TO geldar_register;
REVOKE ALL ON FUNCTION register_renew_token(BYTEA, TEXT, TEXT, BYTEA, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_renew_token(BYTEA, TEXT, TEXT, BYTEA, TIMESTAMPTZ) TO geldar_register;
REVOKE ALL ON FUNCTION register_revoke_tokens(BYTEA, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_revoke_tokens(BYTEA, TEXT) TO geldar_register;
REVOKE ALL ON FUNCTION register_token_info(BYTEA, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_token_info(BYTEA, TEXT) TO geldar_register;

INSERT INTO schema_migrations (version) VALUES ('0032') ON CONFLICT DO NOTHING;
