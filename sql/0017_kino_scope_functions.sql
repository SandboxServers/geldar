-- Migration 0017 (Kino review fix A): Glass reads who may watch whom through read-only definer functions.
-- geldar_glass holds no grant on mcp_identities or agents.owner (0005, 0014, 0016) and keeps none. The
-- Kino scope store used to select those columns directly and failed with "permission denied", so
-- every subscribe was refused. kino_viewer answers for the one identity named; kino_agent_scope answers for
-- one agent or, with NULL, for every agent. Both are STABLE, read-only, pin search_path (pg_temp last),
-- qualify every table, and are executable by geldar_glass alone.

-- One row, always: the owner behind the identity (NULL when unknown), whether it is banned, whether it is a Kino admin.
CREATE FUNCTION kino_viewer(p_identity_hash BYTEA)
RETURNS TABLE (owner_id TEXT, banned BOOLEAN, admin BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $viewer$
  SELECT (SELECT i.owner_id FROM public.mcp_identities i WHERE i.identity_hash = p_identity_hash),
         COALESCE((SELECT i.banned_at IS NOT NULL FROM public.mcp_identities i WHERE i.identity_hash = p_identity_hash), FALSE),
         EXISTS (SELECT 1 FROM public.kino_admins k WHERE k.identity_hash = p_identity_hash)
$viewer$;
REVOKE ALL ON FUNCTION kino_viewer(BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kino_viewer(BYTEA) TO geldar_glass;

-- The owner id and the public-camera flag of one agent (none for an unknown agent), or of every agent when NULL.
CREATE FUNCTION kino_agent_scope(p_agent_id TEXT)
RETURNS TABLE (agent_id TEXT, owner TEXT, public_camera BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $scope$
  SELECT a.agent_id, a.owner, a.public_camera
    FROM public.agents a
   WHERE p_agent_id IS NULL OR a.agent_id = p_agent_id
   ORDER BY a.agent_id
   LIMIT 1000
$scope$;
REVOKE ALL ON FUNCTION kino_agent_scope(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kino_agent_scope(TEXT) TO geldar_glass;

INSERT INTO schema_migrations (version) VALUES ('0017') ON CONFLICT DO NOTHING;