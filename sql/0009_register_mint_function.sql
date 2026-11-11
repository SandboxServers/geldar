-- Migration 0009: the register role mints tokens only through an owner-checked function
-- (decision 0135, orchestrator ruling R33). 0008 gave geldar_register a direct INSERT on
-- mcp_tokens, so a bug or an SQL injection in the register service could mint a token for any
-- player, including another owner's. Now the role has no INSERT on the table: it calls
-- register_mint_token, which inserts a token only when the player's owner is the owner of the
-- calling registration identity, and the identity is not banned.

REVOKE INSERT ON mcp_tokens FROM geldar_register;

-- Revokes the player's active tokens and inserts the new one in one statement block, so a rotation
-- never leaves two live tokens. The token value never reaches the database: only its hash.
-- SECURITY DEFINER runs as the migration owner; search_path is pinned so no object can be shadowed.
CREATE FUNCTION register_mint_token(
  p_identity_hash BYTEA,
  p_player_id TEXT,
  p_token_id TEXT,
  p_token_hash BYTEA
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $mint$
DECLARE
  who TEXT;
  status_now TEXT;
BEGIN
  SELECT i.owner_id INTO who
    FROM mcp_identities i
    WHERE i.identity_hash = p_identity_hash AND i.banned_at IS NULL;
  IF who IS NULL THEN
    RAISE EXCEPTION 'register_mint_token: unknown or banned identity' USING ERRCODE = '42501';
  END IF;
  SELECT p.status INTO status_now
    FROM mcp_players p
    WHERE p.player_id = p_player_id AND p.owner_id = who
    FOR UPDATE;
  IF status_now IS NULL THEN
    RAISE EXCEPTION 'register_mint_token: not your player' USING ERRCODE = '42501';
  END IF;
  IF status_now = 'retired' THEN
    RAISE EXCEPTION 'register_mint_token: player is retired' USING ERRCODE = '42501';
  END IF;
  UPDATE mcp_tokens SET revoked_at = now() WHERE player_id = p_player_id AND revoked_at IS NULL;
  INSERT INTO mcp_tokens (token_id, player_id, token_hash, expires_at)
    VALUES (p_token_id, p_player_id, p_token_hash, now() + interval '30 days');
END
$mint$;

REVOKE ALL ON FUNCTION register_mint_token(BYTEA, TEXT, TEXT, BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_mint_token(BYTEA, TEXT, TEXT, BYTEA) TO geldar_register;

INSERT INTO schema_migrations (version) VALUES ('0009') ON CONFLICT DO NOTHING;
