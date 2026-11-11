-- Migration 0015 (decision 0138; packet C2c-thoughts): who may read a sovereign player's thoughts.
-- agents.thoughts_delayed_public: the owner's opt-in to the delayed public thought stream. Written only by
--   register_set_thoughts_delayed_public (SECURITY DEFINER, geldar_register), read by geldar_glass.
-- glass_owner_agents: a read-only definer function so Glass can learn which agents a signed-in identity owns
--   without a grant on mcp_identities or agents.owner (the Glass role stays at its column grants).

ALTER TABLE agents ADD COLUMN thoughts_delayed_public BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE agents ADD COLUMN thoughts_flag_changed_at TIMESTAMPTZ;
GRANT SELECT (thoughts_delayed_public) ON agents TO geldar_glass;

-- The owner switches the flag on their own player. Unknown or banned identity: refused (42501). Another owner's
-- player: FALSE. A second change within 10 seconds of the last: refused (54000), the database-side rate limit.
CREATE FUNCTION register_set_thoughts_delayed_public(p_identity_hash BYTEA, p_player_id TEXT, p_value BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $thoughts$
DECLARE
  who TEXT;
  target TEXT;
  last_change TIMESTAMPTZ;
BEGIN
  SELECT i.owner_id INTO who
    FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash AND i.banned_at IS NULL;
  IF who IS NULL THEN
    RAISE EXCEPTION 'register_set_thoughts_delayed_public: unknown or banned identity' USING ERRCODE = '42501';
  END IF;
  IF p_value IS NULL THEN
    RAISE EXCEPTION 'register_set_thoughts_delayed_public: bad value' USING ERRCODE = '22023';
  END IF;
  SELECT a.agent_id, a.thoughts_flag_changed_at INTO target, last_change
    FROM public.agents a
    WHERE a.owner = who
      AND a.agent_id = (SELECT p.life_id FROM public.mcp_players p
                        WHERE p.player_id = p_player_id AND p.owner_id = who)
    FOR UPDATE;
  IF target IS NULL THEN
    RETURN FALSE;
  END IF;
  IF last_change IS NOT NULL AND last_change > now() - interval '10 seconds' THEN
    RAISE EXCEPTION 'register_set_thoughts_delayed_public: too many changes' USING ERRCODE = '54000';
  END IF;
  UPDATE public.agents SET thoughts_delayed_public = p_value, thoughts_flag_changed_at = now()
    WHERE agent_id = target;
  RETURN TRUE;
END
$thoughts$;
REVOKE ALL ON FUNCTION register_set_thoughts_delayed_public(BYTEA, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_set_thoughts_delayed_public(BYTEA, TEXT, BOOLEAN) TO geldar_register;

-- The agent ids a live (not banned) identity owns. No row for a banned or unknown identity. Read-only.
CREATE FUNCTION glass_owner_agents(p_identity_hash BYTEA)
RETURNS SETOF TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $owned$
  SELECT a.agent_id
    FROM public.agents a
    JOIN public.mcp_identities i ON i.owner_id = a.owner
   WHERE i.identity_hash = p_identity_hash AND i.banned_at IS NULL
   ORDER BY a.agent_id
   LIMIT 500
$owned$;
REVOKE ALL ON FUNCTION glass_owner_agents(BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION glass_owner_agents(BYTEA) TO geldar_glass;

INSERT INTO schema_migrations (version) VALUES ('0015') ON CONFLICT DO NOTHING;
