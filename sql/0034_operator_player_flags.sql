-- Migration 0034 (decisions 0138 and 0014; packet C7-14): an operator route to set a player's public camera and
-- delayed public thoughts flags. The owner routes (0014 register_set_public_camera, 0016
-- register_set_thoughts_delayed_public) take the owner's identity hash and check ownership inside, so an operator
-- with no owner identity cannot use them. This function takes the player id instead.
--
-- operator_set_player_flags(player id, public camera, thoughts delayed public). NULL leaves that flag unchanged.
--   EXECUTE goes only to the operator role geldar, the role tools/mcp-tokens and tools/admin connect as (PGUSER).
--   The camera flag has no time window (0014). The thoughts flag keeps the 10-second window of 0016: a thoughts
--   change within 10 seconds of the last one returns 'too-soon' and changes nothing. The window is not bypassed;
--   the operator waits and runs the command again.
--   It returns a fixed outcome code and does not raise on a refusal, so the register_audit row written in the same
--   transaction is kept. Outcomes: ok, unknown-player, retired-player, no-flags, too-soon.
--   Every call writes one register_audit row: actor 'operator', action 'player.flags', target the player id,
--   outcome ok or refused, detail the fixed codes only. The name starts with operator_, so the register-definer
--   gate of check-schema.sql (register_% definers) does not count it.

CREATE FUNCTION operator_set_player_flags(
  p_player_id TEXT,
  p_public_camera BOOLEAN,
  p_thoughts_delayed_public BOOLEAN
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $operator_flags$
DECLARE
  target TEXT := left(coalesce(nullif(p_player_id, ''), '(none)'), 128);
  life TEXT;
  player_status TEXT;
  last_change TIMESTAMPTZ;
  result TEXT;
  detail TEXT;
BEGIN
  SELECT p.life_id, p.status INTO life, player_status
    FROM public.mcp_players p
    WHERE p.player_id = p_player_id;
  IF life IS NULL THEN
    result := 'unknown-player';
  ELSIF player_status = 'retired' THEN
    result := 'retired-player';
  ELSIF p_public_camera IS NULL AND p_thoughts_delayed_public IS NULL THEN
    result := 'no-flags';
  ELSE
    SELECT a.thoughts_flag_changed_at INTO last_change
      FROM public.agents a
      WHERE a.agent_id = life
      FOR UPDATE;
    IF NOT FOUND THEN
      result := 'unknown-player';
    ELSIF p_thoughts_delayed_public IS NOT NULL
      AND last_change IS NOT NULL AND last_change > now() - interval '10 seconds' THEN
      result := 'too-soon';
    ELSE
      UPDATE public.agents a
        SET public_camera = COALESCE(p_public_camera, a.public_camera),
            thoughts_delayed_public = COALESCE(p_thoughts_delayed_public, a.thoughts_delayed_public),
            thoughts_flag_changed_at = CASE WHEN p_thoughts_delayed_public IS NULL
              THEN a.thoughts_flag_changed_at ELSE now() END
        WHERE a.agent_id = life;
      result := 'ok';
    END IF;
  END IF;

  IF result = 'ok' THEN
    detail := 'camera='
      || CASE WHEN p_public_camera IS NULL THEN 'unchanged' WHEN p_public_camera THEN 'on' ELSE 'off' END
      || ' thoughts='
      || CASE WHEN p_thoughts_delayed_public IS NULL THEN 'unchanged'
              WHEN p_thoughts_delayed_public THEN 'on' ELSE 'off' END;
  ELSE
    detail := result;
  END IF;
  INSERT INTO public.register_audit (actor, action, target, outcome, admin, detail)
    VALUES ('operator', 'player.flags', target,
            CASE WHEN result = 'ok' THEN 'ok' ELSE 'refused' END, false, detail);
  RETURN result;
END
$operator_flags$;

REVOKE ALL ON FUNCTION operator_set_player_flags(TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC;

-- The operator role is geldar (PGUSER defaults to it in tools/mcp-tokens and tools/admin). The grant is guarded so a
-- database without that role still migrates; GRANT itself is idempotent. No other role is granted this function.
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geldar') THEN
    GRANT EXECUTE ON FUNCTION operator_set_player_flags(TEXT, BOOLEAN, BOOLEAN) TO geldar;
  END IF;
END
$grant$;

INSERT INTO schema_migrations (version) VALUES ('0034') ON CONFLICT DO NOTHING;
