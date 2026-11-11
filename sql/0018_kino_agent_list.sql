-- Migration 0018 (Kino fix D1): kino_agent_scope no longer answers "every agent" for NULL.
-- 0017 let kino_agent_scope(NULL) return every agent's owner id to geldar_glass, which is a bug waiting for a
-- caller that passes a missing id. The one-agent lookup now rejects NULL and the empty string (22004), and the
-- picker's list is its own function, kino_agent_list(), with no row cap. Same hardening as 0017: STABLE,
-- read-only, search_path pinned (pg_temp last), tables qualified, EXECUTE for geldar_glass alone.

CREATE OR REPLACE FUNCTION kino_agent_scope(p_agent_id TEXT)
RETURNS TABLE (agent_id TEXT, owner TEXT, public_camera BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $scope$
BEGIN
  IF p_agent_id IS NULL OR btrim(p_agent_id) = '' THEN
    RAISE EXCEPTION 'kino_agent_scope needs an agent id' USING ERRCODE = '22004';
  END IF;
  RETURN QUERY
    SELECT a.agent_id, a.owner, a.public_camera
      FROM public.agents a
     WHERE a.agent_id = p_agent_id;
END
$scope$;
REVOKE ALL ON FUNCTION kino_agent_scope(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kino_agent_scope(TEXT) TO geldar_glass;

CREATE FUNCTION kino_agent_list()
RETURNS TABLE (agent_id TEXT, owner TEXT, public_camera BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $list$
  SELECT a.agent_id, a.owner, a.public_camera FROM public.agents a ORDER BY a.agent_id
$list$;
REVOKE ALL ON FUNCTION kino_agent_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kino_agent_list() TO geldar_glass;

INSERT INTO schema_migrations (version) VALUES ('0018') ON CONFLICT DO NOTHING;