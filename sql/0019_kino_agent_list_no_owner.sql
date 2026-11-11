-- Migration 0019 (Kino fix E2): kino_agent_list() no longer returns each agent's owner.
-- The picker needs only the agent id and whether its camera is public. The owner stays inside
-- kino_agent_scope (ownership matching on a subscribe); a signed-in viewer's own agents come from
-- glass_owner_agents (0016). The return type changes, so the function is dropped and created again.
-- Same hardening as 0018: STABLE, read-only, search_path pinned (pg_temp last), tables qualified,
-- EXECUTE for geldar_glass alone.

DROP FUNCTION kino_agent_list();

CREATE FUNCTION kino_agent_list()
RETURNS TABLE (agent_id TEXT, public_camera BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $list$
  SELECT a.agent_id, a.public_camera FROM public.agents a ORDER BY a.agent_id
$list$;
REVOKE ALL ON FUNCTION kino_agent_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kino_agent_list() TO geldar_glass;

INSERT INTO schema_migrations (version) VALUES ('0019') ON CONFLICT DO NOTHING;