-- Schema check for migration 0034 (operator route to set a player's public camera and thoughts flags; C7-14).
-- Run last, as the migration owner (postgres in CI), with ON_ERROR_STOP=1, on a freshly migrated database.
DO $check$
DECLARE
  step TEXT;
  res TEXT;
  n INT;
  r RECORD;
  role_name TEXT;
  fn TEXT := 'operator_set_player_flags(text,boolean,boolean)';
BEGIN
  step := 'fixtures';
  INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES ('reg-opf-a', 'operator flags owner', 3);
  INSERT INTO mcp_identities (identity_hash, provider, owner_id)
    VALUES (decode(repeat('d4', 32), 'hex'), 'microsoft', 'reg-opf-a');
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
                      declared_model, model_config, tier)
    VALUES ('ag_opf_01', 'Opf One', 1, 'ag_opf_01', 'phase0', 'sovereign', 'reg-opf-a', 'opf-harness',
            'self-reported', 'declared:unverified', 'sovereign'),
           ('ag_opf_02', 'Opf Two', 1, 'ag_opf_02', 'phase0', 'sovereign', 'reg-opf-a', 'opf-harness',
            'self-reported', 'declared:unverified', 'sovereign');
  INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status)
    VALUES ('ag-opf-01', 'reg-opf-a', 'ag_opf_01', 'Opf One', 'opf-harness', 'active'),
           ('ag-opf-02', 'reg-opf-a', 'ag_opf_02', 'Opf Two', 'opf-harness', 'retired');

  step := 'an unknown player is refused, not raised';
  res := operator_set_player_flags('ag-opf-99', TRUE, NULL);
  IF res <> 'unknown-player' THEN RAISE EXCEPTION 'schema check: %: %', step, res; END IF;

  step := 'a retired player is refused';
  res := operator_set_player_flags('ag-opf-02', TRUE, NULL);
  IF res <> 'retired-player' THEN RAISE EXCEPTION 'schema check: %: %', step, res; END IF;

  step := 'no flag at all is refused';
  res := operator_set_player_flags('ag-opf-01', NULL, NULL);
  IF res <> 'no-flags' THEN RAISE EXCEPTION 'schema check: %: %', step, res; END IF;

  step := 'the camera flag changes with no time window and leaves the thoughts stamp alone';
  res := operator_set_player_flags('ag-opf-01', TRUE, NULL);
  IF res <> 'ok' OR NOT (SELECT public_camera FROM agents WHERE agent_id = 'ag_opf_01')
     OR (SELECT thoughts_flag_changed_at FROM agents WHERE agent_id = 'ag_opf_01') IS NOT NULL THEN
    RAISE EXCEPTION 'schema check: %: %', step, res;
  END IF;

  step := 'the thoughts flag changes and starts the 10-second window';
  res := operator_set_player_flags('ag-opf-01', NULL, TRUE);
  IF res <> 'ok' OR NOT (SELECT thoughts_delayed_public FROM agents WHERE agent_id = 'ag_opf_01') THEN
    RAISE EXCEPTION 'schema check: %: %', step, res;
  END IF;

  step := 'a second thoughts change at once is refused and changes nothing';
  res := operator_set_player_flags('ag-opf-01', NULL, FALSE);
  IF res <> 'too-soon' OR NOT (SELECT thoughts_delayed_public FROM agents WHERE agent_id = 'ag_opf_01') THEN
    RAISE EXCEPTION 'schema check: %: %', step, res;
  END IF;

  step := 'at 9.9 seconds the window still holds';
  UPDATE agents SET thoughts_flag_changed_at = now() - interval '9.9 seconds' WHERE agent_id = 'ag_opf_01';
  res := operator_set_player_flags('ag-opf-01', NULL, FALSE);
  IF res <> 'too-soon' THEN RAISE EXCEPTION 'schema check: %: %', step, res; END IF;

  step := 'at exactly 10 seconds the window is open (the last allowed attempt)';
  UPDATE agents SET thoughts_flag_changed_at = now() - interval '10 seconds' WHERE agent_id = 'ag_opf_01';
  res := operator_set_player_flags('ag-opf-01', NULL, FALSE);
  IF res <> 'ok' OR (SELECT thoughts_delayed_public FROM agents WHERE agent_id = 'ag_opf_01') THEN
    RAISE EXCEPTION 'schema check: %: %', step, res;
  END IF;

  step := 'the camera-only change ignores the thoughts window';
  UPDATE agents SET thoughts_flag_changed_at = now() - interval '1 second' WHERE agent_id = 'ag_opf_01';
  res := operator_set_player_flags('ag-opf-01', FALSE, NULL);
  IF res <> 'ok' OR (SELECT public_camera FROM agents WHERE agent_id = 'ag_opf_01') IS NOT FALSE THEN
    RAISE EXCEPTION 'schema check: %: %', step, res;
  END IF;

  step := 'every call wrote one audit row, refusals included';
  SELECT count(*) INTO n FROM register_audit
    WHERE actor = 'operator' AND action = 'player.flags' AND target = 'ag-opf-01' AND outcome = 'ok';
  IF n <> 4 THEN RAISE EXCEPTION 'schema check: %: % ok rows', step, n; END IF;
  SELECT count(*) INTO n FROM register_audit
    WHERE actor = 'operator' AND action = 'player.flags' AND target = 'ag-opf-01'
      AND outcome = 'refused' AND detail = 'too-soon';
  IF n <> 2 THEN RAISE EXCEPTION 'schema check: %: % too-soon rows', step, n; END IF;
  SELECT count(*) INTO n FROM register_audit
    WHERE actor = 'operator' AND action = 'player.flags' AND target = 'ag-opf-01'
      AND outcome = 'refused' AND detail = 'no-flags';
  IF n <> 1 THEN RAISE EXCEPTION 'schema check: %: % no-flags rows', step, n; END IF;
  SELECT count(*) INTO n FROM register_audit
    WHERE actor = 'operator' AND action = 'player.flags' AND target = 'ag-opf-99'
      AND outcome = 'refused' AND detail = 'unknown-player';
  IF n <> 1 THEN RAISE EXCEPTION 'schema check: %: % unknown-player rows', step, n; END IF;
  SELECT count(*) INTO n FROM register_audit
    WHERE actor = 'operator' AND action = 'player.flags' AND target = 'ag-opf-02'
      AND outcome = 'refused' AND detail = 'retired-player';
  IF n <> 1 THEN RAISE EXCEPTION 'schema check: %: % retired-player rows', step, n; END IF;
  IF NOT EXISTS (SELECT 1 FROM register_audit WHERE target = 'ag-opf-01' AND detail = 'camera=on thoughts=unchanged') THEN
    RAISE EXCEPTION 'schema check: %: the ok detail is not the fixed codes', step;
  END IF;

  step := 'PUBLIC cannot execute the function';
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
              WHERE p.proname = 'operator_set_player_flags' AND a.grantee = 0) THEN
    RAISE EXCEPTION 'schema check: %', step;
  END IF;

  step := 'the function is a definer with a pinned search_path';
  SELECT prosecdef, proconfig INTO r FROM pg_proc WHERE proname = 'operator_set_player_flags';
  IF NOT r.prosecdef OR NOT ('search_path=pg_catalog, public, pg_temp' = ANY (r.proconfig)) THEN
    RAISE EXCEPTION 'schema check: %', step;
  END IF;

  step := 'the operator role geldar can execute it';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geldar')
     AND NOT has_function_privilege('geldar', fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'schema check: %', step;
  END IF;

  step := 'the other roles cannot execute it';
  FOREACH role_name IN ARRAY ARRAY['geldar_register', 'geldar_mcp', 'geldar_glass', 'geldar_supervisor'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name)
       AND has_function_privilege(role_name, fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'schema check: % (%)', step, role_name;
    END IF;
  END LOOP;

  RAISE NOTICE 'check-schema-operator-flags: ok';
END
$check$;
