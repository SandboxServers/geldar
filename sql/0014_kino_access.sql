-- Migration 0014 (decision 0135 amendment, rulings R40 to R42; Kino access flags).
-- R40: registration is Microsoft personal accounts only, so mcp_identities accepts provider 'microsoft'
--      (the old values stay valid for existing rows) and register_create_owner takes only 'microsoft'.
-- R41: the daily new-owner cap of 0013 is gone; the service rate-limits sign-in and creation instead.
--      register_count_new_owners (0012) stays, unused by the service. The lifetime 10 players per owner (R36) stay.
-- Kino: kino_admins (written only by tools/mcp-tokens `admin grant|revoke`, read by glass) and a per-agent
--      public_camera flag (set by the owner through a definer function or by the admin CLI, read by glass).

ALTER TABLE mcp_identities DROP CONSTRAINT mcp_identities_provider_check;
ALTER TABLE mcp_identities ADD CONSTRAINT mcp_identities_provider_check
  CHECK (provider IN ('github', 'discord', 'microsoft'));

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
  IF p_provider <> 'microsoft' THEN
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

-- not in spec Appendix D: Kino administrators, keyed by the identity hash. No grant but the glass read.
CREATE TABLE kino_admins (
  identity_hash BYTEA PRIMARY KEY CHECK (octet_length(identity_hash) = 32),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON kino_admins FROM PUBLIC;
GRANT SELECT ON kino_admins TO geldar_glass;

ALTER TABLE agents ADD COLUMN public_camera BOOLEAN NOT NULL DEFAULT FALSE;
GRANT SELECT (public_camera) ON agents TO geldar_glass;

-- The owner switches the flag on their own agent. A banned or unknown identity is refused; an agent that is
-- not the owner's returns FALSE.
CREATE FUNCTION register_set_public_camera(p_identity_hash BYTEA, p_player_id TEXT, p_value BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $camera$
DECLARE
  who TEXT;
  hit TEXT;
BEGIN
  SELECT i.owner_id INTO who
    FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash AND i.banned_at IS NULL;
  IF who IS NULL THEN
    RAISE EXCEPTION 'register_set_public_camera: unknown or banned identity' USING ERRCODE = '42501';
  END IF;
  IF p_value IS NULL THEN
    RAISE EXCEPTION 'register_set_public_camera: bad value' USING ERRCODE = '22023';
  END IF;
  UPDATE public.agents SET public_camera = p_value
    WHERE owner = who
      AND agent_id = (SELECT p.life_id FROM public.mcp_players p
                      WHERE p.player_id = p_player_id AND p.owner_id = who)
    RETURNING agent_id INTO hit;
  RETURN hit IS NOT NULL;
END
$camera$;
REVOKE ALL ON FUNCTION register_set_public_camera(BYTEA, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_set_public_camera(BYTEA, TEXT, BOOLEAN) TO geldar_register;

INSERT INTO schema_migrations (version) VALUES ('0014') ON CONFLICT DO NOTHING;
