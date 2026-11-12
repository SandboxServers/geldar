-- Migration 0020 (decision 0138): Glass shows a sovereign player's journal in the Thought Stream.
-- A sovereign player has no row in `thoughts` (its only writer is the Mind side); the MCP layer mirrors what the
-- player writes into mcp_journal. geldar_glass holds no grant on mcp_journal and keeps none. Two STABLE read-only
-- definer functions return only the columns the page needs, and the 0138 visibility rule is applied INSIDE them, so a
-- bug in Glass cannot widen it:
--   shown to a viewer when  (show living sovereign OR agent is not sovereign OR the life is dead
--                            OR the owner opted in (thoughts_delayed_public) OR the viewer owns the agent)
--                      and  (no cut-off OR at <= cut-off OR the life is dead OR the viewer owns the agent).
-- glass_journal_page serves the REST list (newest first, owner and dead-life rules); glass_journal_after serves the
-- shared stream (oldest first, the delay for every row: no owner and no dead-life exception, as thoughtsAfter).
-- The row id 'j' + the zero padded journal id never collides with a thought id and sorts like the journal id.

CREATE FUNCTION glass_journal_page(
  p_shown_until TIMESTAMPTZ, p_owned TEXT[], p_show_living BOOLEAN,
  p_life_id TEXT, p_tier TEXT, p_since TIMESTAMPTZ,
  p_before_at TIMESTAMPTZ, p_before_id TEXT, p_limit INTEGER)
RETURNS TABLE (thought_id TEXT, life_id TEXT, at TIMESTAMPTZ, cursor_at TEXT, journal_text TEXT, name TEXT, tier TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $page$
  SELECT 'j' || lpad(j.id::text, 19, '0'), j.life_id, j.at, j.at::text, j.text, a.name, a.tier
    FROM public.mcp_journal j JOIN public.agents a ON a.agent_id = j.life_id
   WHERE (p_life_id IS NULL OR j.life_id = p_life_id)
     AND (p_tier IS NULL OR a.tier = p_tier)
     AND (p_since IS NULL OR j.at >= p_since)
     AND (p_before_at IS NULL
          OR (j.at, 'j' || lpad(j.id::text, 19, '0')) < (p_before_at, coalesce(p_before_id, '')))
     AND (coalesce(p_show_living, FALSE) OR a.mode IS DISTINCT FROM 'sovereign' OR a.died_at IS NOT NULL
          OR a.thoughts_delayed_public OR a.agent_id = ANY (coalesce(p_owned, ARRAY[]::TEXT[])))
     AND (p_shown_until IS NULL OR j.at <= p_shown_until OR a.died_at IS NOT NULL
          OR a.agent_id = ANY (coalesce(p_owned, ARRAY[]::TEXT[])))
   ORDER BY j.at DESC, j.id DESC
   LIMIT least(greatest(coalesce(p_limit, 0), 0), 500)
$page$;
REVOKE ALL ON FUNCTION glass_journal_page(TIMESTAMPTZ, TEXT[], BOOLEAN, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION glass_journal_page(TIMESTAMPTZ, TEXT[], BOOLEAN, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INTEGER) TO geldar_glass;

CREATE FUNCTION glass_journal_after(
  p_after_at TIMESTAMPTZ, p_after_id TEXT, p_shown_until TIMESTAMPTZ, p_show_living BOOLEAN, p_limit INTEGER)
RETURNS TABLE (thought_id TEXT, life_id TEXT, at TIMESTAMPTZ, cursor_at TEXT, journal_text TEXT, name TEXT, tier TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $after$
  SELECT 'j' || lpad(j.id::text, 19, '0'), j.life_id, j.at, j.at::text, j.text, a.name, a.tier
    FROM public.mcp_journal j JOIN public.agents a ON a.agent_id = j.life_id
   WHERE (j.at, 'j' || lpad(j.id::text, 19, '0')) > (p_after_at, coalesce(p_after_id, ''))
     AND (coalesce(p_show_living, FALSE) OR a.mode IS DISTINCT FROM 'sovereign' OR a.died_at IS NOT NULL
          OR a.thoughts_delayed_public)
     AND (p_shown_until IS NULL OR j.at <= p_shown_until)
   ORDER BY j.at, j.id
   LIMIT least(greatest(coalesce(p_limit, 0), 0), 500)
$after$;
REVOKE ALL ON FUNCTION glass_journal_after(TIMESTAMPTZ, TEXT, TIMESTAMPTZ, BOOLEAN, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION glass_journal_after(TIMESTAMPTZ, TEXT, TIMESTAMPTZ, BOOLEAN, INTEGER) TO geldar_glass;

INSERT INTO schema_migrations (version) VALUES ('0020') ON CONFLICT DO NOTHING;
