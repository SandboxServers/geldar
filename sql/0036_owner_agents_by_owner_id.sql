-- Migration 0036 (C7-04b-5, orchestrator ruling 1): the owner agent loaders keyed by the owner id. The owner API
-- holds an owner id (a Bearer owner key carries an owner id; a cookie session resolves to one), but 0012's
-- register_list_players takes an identity hash and returns no owner id, so the API could not list or read an
-- agent without a hash. These two functions take the owner id and return the player columns the agent view
-- reads: the player id, display name, status and the two agents flags (public camera, delayed public thoughts).
-- Body and credits are not database facts of the account view, so the loader leaves them to its defaults.
-- A banned owner (any identity of the owner banned, the rule 0026 register_owner_key_resolve applies) is refused
-- with 42501 by both, so a refusal never reads as an empty list or a missing player. An unknown owner, or a
-- player that is not the owner's, returns no row. READ COMMITTED assumed: each call reads the ban and the rows
-- in one statement snapshot. Both are read-only SECURITY DEFINER functions with the pinned search_path; the
-- register role gets EXECUTE only.

-- the owner's players, ordered by player id
CREATE FUNCTION register_owner_list_players(p_owner_id TEXT)
RETURNS TABLE (player_id TEXT, display_name TEXT, status TEXT,
               public_camera BOOLEAN, thoughts_delayed_public BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $owner_list$
BEGIN
  IF EXISTS (SELECT 1 FROM public.mcp_identities i
             WHERE i.owner_id = p_owner_id AND i.banned_at IS NOT NULL) THEN
    RAISE EXCEPTION 'register_owner_list_players: unknown or banned owner' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.player_id, p.display_name, p.status, a.public_camera, a.thoughts_delayed_public
      FROM public.mcp_players p
      JOIN public.agents a ON a.agent_id = p.life_id
      WHERE p.owner_id = p_owner_id
      ORDER BY p.player_id;
END
$owner_list$;

-- one of the owner's players; a player of another owner, or an unknown one, returns no row
CREATE FUNCTION register_owner_get_player(p_owner_id TEXT, p_player_id TEXT)
RETURNS TABLE (player_id TEXT, display_name TEXT, status TEXT,
               public_camera BOOLEAN, thoughts_delayed_public BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $owner_get$
BEGIN
  IF EXISTS (SELECT 1 FROM public.mcp_identities i
             WHERE i.owner_id = p_owner_id AND i.banned_at IS NOT NULL) THEN
    RAISE EXCEPTION 'register_owner_get_player: unknown or banned owner' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.player_id, p.display_name, p.status, a.public_camera, a.thoughts_delayed_public
      FROM public.mcp_players p
      JOIN public.agents a ON a.agent_id = p.life_id
      WHERE p.owner_id = p_owner_id AND p.player_id = p_player_id;
END
$owner_get$;

REVOKE ALL ON FUNCTION register_owner_list_players(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_owner_get_player(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_owner_list_players(TEXT) TO geldar_register;
GRANT EXECUTE ON FUNCTION register_owner_get_player(TEXT, TEXT) TO geldar_register;

INSERT INTO schema_migrations (version) VALUES ('0036') ON CONFLICT DO NOTHING;
