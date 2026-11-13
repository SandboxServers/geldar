-- Migration 0033 (C7-03b3): the exact-case login name of a roster player, for the supervisor's Body.
-- The roster keys names lower-cased (0024), but a Body logs in with the player's display_name as
-- stored in mcp_players, which keeps its case. geldar_supervisor has no SELECT on mcp_players, so the
-- read goes through this definer function, like supervisor_is_admin (0027). It answers one name for
-- one owner, or NULL, and never reads another owner's rows.
--
-- The name is returned only when the owner's live players (status not 'retired') that match the
-- roster name in any case agree on one spelling. Two spellings give NULL: the supervisor then refuses
-- the start instead of guessing a case. The owner must hold the roster name (0024), so a foreign owner
-- gets NULL even when a player of that name exists under another owner.
CREATE OR REPLACE FUNCTION supervisor_player_display_name(p_owner_id TEXT, p_player_name TEXT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT CASE WHEN count(DISTINCT p.display_name) = 1 THEN min(p.display_name) END
    FROM public.mcp_players p
    JOIN public.mcp_roster r ON r.player_name = lower(p_player_name) AND r.owner_id = p_owner_id
   WHERE p.owner_id = p_owner_id
     AND lower(p.display_name) = lower(p_player_name)
     AND p.status <> 'retired'
$fn$;

REVOKE ALL ON FUNCTION supervisor_player_display_name(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervisor_player_display_name(TEXT, TEXT) TO geldar_supervisor;
