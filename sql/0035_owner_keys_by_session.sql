-- Migration 0035 (C7-04b-3, decision 0173): owner API keys keyed by the cookie session. Decision 0170 point 2
-- says keys are minted, listed and revoked on the account page, but migration 0026 takes a presented key, so a
-- human with only a cookie session could not mint a first key. These functions take the identity hash of the
-- signed-in session, the way the 0032 token functions do, and resolve the owner from it. A banned or unknown
-- identity is refused with 42501 (the list raises too, so a refusal never reads as an empty list). The key
-- value is shown once at mint and never stored, listed or audited; the audit actor is the 0026 hash of the
-- owner id. Keys keep the 0026 table, scopes (read, body, manage), 90-day life and 10-live-key cap.
-- Every function is definer-owned and runs its audit row in the same transaction as the change. The register
-- role gets EXECUTE only. READ COMMITTED assumed: the live count runs after the owner row lock is taken.

-- The mint: any subset of read, body and manage. Returns the new key's expiry. Raises 42501 for a banned or
-- unknown identity and 53400 'live_key_cap' when the owner already has 10 live keys (admins included).
CREATE FUNCTION register_session_mint_owner_key(
  p_identity_hash BYTEA,
  p_key_id TEXT,
  p_key_hash BYTEA,
  p_scopes TEXT[]
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $session_mint$
DECLARE
  who TEXT;
  expires TIMESTAMPTZ;
  live INT;
BEGIN
  SELECT i.owner_id INTO who
    FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash AND i.banned_at IS NULL;
  IF who IS NULL THEN
    RAISE EXCEPTION 'register_session_mint_owner_key: unknown or banned identity' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.mcp_owners mo WHERE mo.owner_id = who FOR UPDATE;
  SELECT count(*) INTO live FROM public.owner_api_keys ok
    WHERE ok.owner_id = who AND ok.revoked_at IS NULL AND ok.expires_at > now();
  IF live >= 10 THEN
    RAISE EXCEPTION 'register_session_mint_owner_key: live_key_cap' USING ERRCODE = '53400';
  END IF;
  INSERT INTO public.owner_api_keys (key_id, owner_id, key_hash, scopes, expires_at)
    VALUES (p_key_id, who, p_key_hash, p_scopes, now() + interval '90 days')
    RETURNING public.owner_api_keys.expires_at INTO expires;
  INSERT INTO public.register_audit (actor, action, target, outcome, admin)
    VALUES (left(encode(sha256(convert_to(who, 'UTF8')), 'hex'), 16), 'key.mint', p_key_id, 'minted',
      public.register_is_admin(who));
  RETURN expires;
END
$session_mint$;

-- The listing: the owner's keys, without any value or hash. Raises 42501 for a banned or unknown identity, so
-- a refused caller is never shown as an owner with no keys.
CREATE FUNCTION register_session_list_owner_keys(p_identity_hash BYTEA)
RETURNS TABLE (key_id TEXT, scopes TEXT[], created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $session_list$
DECLARE
  who TEXT;
BEGIN
  SELECT i.owner_id INTO who
    FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash AND i.banned_at IS NULL;
  IF who IS NULL THEN
    RAISE EXCEPTION 'register_session_list_owner_keys: unknown or banned identity' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT ok.key_id, ok.scopes, ok.created_at, ok.expires_at, ok.revoked_at, ok.last_used_at
      FROM public.owner_api_keys ok
      WHERE ok.owner_id = who
      ORDER BY ok.created_at, ok.key_id;
END
$session_list$;

-- The revoke: owner-scoped. Returns TRUE when a live key of the session's owner was revoked, FALSE when the
-- target is not a live key of that owner (another owner's key id is FALSE too). Raises 42501 for a banned or
-- unknown identity. The audit row is written only for a revoke that happened.
CREATE FUNCTION register_session_revoke_owner_key(p_identity_hash BYTEA, p_target_key_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $session_revoke$
DECLARE
  who TEXT;
  changed INT;
BEGIN
  SELECT i.owner_id INTO who
    FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash AND i.banned_at IS NULL;
  IF who IS NULL THEN
    RAISE EXCEPTION 'register_session_revoke_owner_key: unknown or banned identity' USING ERRCODE = '42501';
  END IF;
  UPDATE public.owner_api_keys ok SET revoked_at = now()
    WHERE ok.key_id = p_target_key_id AND ok.owner_id = who AND ok.revoked_at IS NULL;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed = 0 THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.register_audit (actor, action, target, outcome, admin)
    VALUES (left(encode(sha256(convert_to(who, 'UTF8')), 'hex'), 16), 'key.revoke', p_target_key_id, 'revoked',
      public.register_is_admin(who));
  RETURN TRUE;
END
$session_revoke$;

REVOKE ALL ON FUNCTION register_session_mint_owner_key(BYTEA, TEXT, BYTEA, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_session_mint_owner_key(BYTEA, TEXT, BYTEA, TEXT[]) TO geldar_register;
REVOKE ALL ON FUNCTION register_session_list_owner_keys(BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_session_list_owner_keys(BYTEA) TO geldar_register;
REVOKE ALL ON FUNCTION register_session_revoke_owner_key(BYTEA, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_session_revoke_owner_key(BYTEA, TEXT) TO geldar_register;

INSERT INTO schema_migrations (version) VALUES ('0035') ON CONFLICT DO NOTHING;
