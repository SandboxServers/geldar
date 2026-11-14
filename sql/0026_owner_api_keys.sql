-- Migration 0026 (C7-02b, decision 0170 point 2, decision 0152): owner API keys.
-- An owner key is "gowner-" plus 64 hex. The database stores only its HMAC-SHA256 under the token pepper;
-- the value is shown once at mint and never stored, listed or logged. A key has scopes read, body and manage,
-- lives 90 days, and is revoked at once by a revoke. It is refused when revoked, expired or when the owner
-- has a banned identity. Keys live in their own table: they never match mcp_tokens, so the MCP endpoint
-- refuses them, and player tokens never match owner_api_keys, so the management routes refuse them.
-- Every function is definer-owned, takes the presented key hash, and runs its audit row in the same
-- transaction as the change. A refused presenter returns NULL (or no rows) rather than raising, so the
-- use-refusal audit row commits. The register role gets EXECUTE only; it has no table privilege.

CREATE TABLE IF NOT EXISTS owner_api_keys (
  key_id TEXT PRIMARY KEY CHECK (key_id ~ '^gok-[0-9a-f]{16}$'),
  owner_id TEXT NOT NULL REFERENCES mcp_owners (owner_id),
  key_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(key_hash) = 32),
  scopes TEXT[] NOT NULL CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['read', 'body', 'manage']::TEXT[]),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS owner_api_keys_owner ON owner_api_keys (owner_id);

-- Resolves a presented key: the owner, the key id and the scopes of a live key, or no rows. A use that
-- is refused for a known key (revoked, expired, owner banned) writes one 'key.use' audit row and returns
-- no rows. A successful use stamps last_used_at.
CREATE FUNCTION register_owner_key_resolve(p_key_hash BYTEA)
RETURNS TABLE (owner_id TEXT, key_id TEXT, scopes TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $resolve$
DECLARE
  k public.owner_api_keys%ROWTYPE;
  banned BOOLEAN;
  why TEXT;
BEGIN
  SELECT * INTO k FROM public.owner_api_keys ok WHERE ok.key_hash = p_key_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.mcp_identities i WHERE i.owner_id = k.owner_id AND i.banned_at IS NOT NULL
  ) INTO banned;
  IF k.revoked_at IS NOT NULL THEN
    why := 'refused_revoked';
  ELSIF k.expires_at <= now() THEN
    why := 'refused_expired';
  ELSIF banned THEN
    why := 'refused_banned';
  END IF;
  IF why IS NOT NULL THEN
    INSERT INTO public.register_audit (actor, action, target, outcome, admin)
      VALUES (left(encode(sha256(convert_to(k.owner_id, 'UTF8')), 'hex'), 16), 'key.use', k.key_id, why,
        public.register_is_admin(k.owner_id));
    RETURN;
  END IF;
  UPDATE public.owner_api_keys ok SET last_used_at = now() WHERE ok.key_id = k.key_id;
  RETURN QUERY SELECT k.owner_id, k.key_id, k.scopes;
END
$resolve$;

-- The mint: needs a presented key with manage. Returns the new key's expiry, or NULL when the presenter is
-- refused. A duplicate hash or a bad scope raises, so the whole mint (row and audit) rolls back.
-- A mint raises 42501 'scope_escalation' unless the new scopes are a subset of the presenter's scopes, and
-- raises 53400 'live_key_cap' when the owner already has 10 live keys (live: not revoked, not expired).
-- The cap applies to admins too; admins are exempt only from the rate windows. The owner row lock
-- serialises concurrent mints for one owner so the cap cannot be overrun. READ COMMITTED assumed: the
-- live count runs after the lock is taken, so it sees the commit of the mint before it.
CREATE FUNCTION register_mint_owner_key(
  p_presenter_hash BYTEA,
  p_key_id TEXT,
  p_key_hash BYTEA,
  p_scopes TEXT[]
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $mint$
DECLARE
  who TEXT;
  granted TEXT[];
  expires TIMESTAMPTZ;
  live INT;
BEGIN
  SELECT r.owner_id, r.scopes INTO who, granted FROM public.register_owner_key_resolve(p_presenter_hash) r;
  IF who IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT ('manage' = ANY (granted)) THEN
    RAISE EXCEPTION 'register_mint_owner_key: scope_missing' USING ERRCODE = '42501';
  END IF;
  IF NOT (p_scopes <@ granted) THEN
    RAISE EXCEPTION 'register_mint_owner_key: scope_escalation' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.mcp_owners mo WHERE mo.owner_id = who FOR UPDATE;
  SELECT count(*) INTO live FROM public.owner_api_keys ok
    WHERE ok.owner_id = who AND ok.revoked_at IS NULL AND ok.expires_at > now();
  IF live >= 10 THEN
    RAISE EXCEPTION 'register_mint_owner_key: live_key_cap' USING ERRCODE = '53400';
  END IF;
  INSERT INTO public.owner_api_keys (key_id, owner_id, key_hash, scopes, expires_at)
    VALUES (p_key_id, who, p_key_hash, p_scopes, now() + interval '90 days')
    RETURNING public.owner_api_keys.expires_at INTO expires;
  INSERT INTO public.register_audit (actor, action, target, outcome, admin)
    VALUES (left(encode(sha256(convert_to(who, 'UTF8')), 'hex'), 16), 'key.mint', p_key_id, 'minted',
      public.register_is_admin(who));
  RETURN expires;
END
$mint$;

-- The revoke: needs a presented key with manage. Returns NULL when the presenter is refused, FALSE when the
-- target is not a live key of that owner (another owner's key id is FALSE too), TRUE when it was revoked.
CREATE FUNCTION register_revoke_owner_key(p_presenter_hash BYTEA, p_target_key_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $revoke$
DECLARE
  who TEXT;
  granted TEXT[];
  changed INT;
BEGIN
  SELECT r.owner_id, r.scopes INTO who, granted FROM public.register_owner_key_resolve(p_presenter_hash) r;
  IF who IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT ('manage' = ANY (granted)) THEN
    RAISE EXCEPTION 'register_revoke_owner_key: scope_missing' USING ERRCODE = '42501';
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
$revoke$;

-- The listing: the owner's keys, without any value or hash. Needs a presented key with read. A presenter
-- that is refused, or lacks read, gets no rows.
CREATE FUNCTION register_list_owner_keys(p_presenter_hash BYTEA)
RETURNS TABLE (key_id TEXT, scopes TEXT[], created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $list$
DECLARE
  who TEXT;
  granted TEXT[];
BEGIN
  SELECT r.owner_id, r.scopes INTO who, granted FROM public.register_owner_key_resolve(p_presenter_hash) r;
  IF who IS NULL OR NOT ('read' = ANY (granted)) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT ok.key_id, ok.scopes, ok.created_at, ok.expires_at, ok.revoked_at, ok.last_used_at
      FROM public.owner_api_keys ok
      WHERE ok.owner_id = who
      ORDER BY ok.created_at, ok.key_id;
END
$list$;

REVOKE ALL ON TABLE owner_api_keys FROM PUBLIC;
REVOKE ALL ON FUNCTION register_owner_key_resolve(BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_owner_key_resolve(BYTEA) TO geldar_register;
REVOKE ALL ON FUNCTION register_mint_owner_key(BYTEA, TEXT, BYTEA, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_mint_owner_key(BYTEA, TEXT, BYTEA, TEXT[]) TO geldar_register;
REVOKE ALL ON FUNCTION register_revoke_owner_key(BYTEA, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_revoke_owner_key(BYTEA, TEXT) TO geldar_register;
REVOKE ALL ON FUNCTION register_list_owner_keys(BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_list_owner_keys(BYTEA) TO geldar_register;

INSERT INTO schema_migrations (version) VALUES ('0026') ON CONFLICT DO NOTHING;
