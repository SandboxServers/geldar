-- Migration 0033 (C7-03b3): supervisor_player_display_name, the exact-case login name for a roster
-- player. Run as a superuser after every migration, like check-schema-body-ops.sql. The data is keyed
-- on the sdn- prefix so it cannot collide with the other check files that share the database.
INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES ('sdn-a', 'sdn a', 5), ('sdn-b', 'sdn b', 5);
INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
                    declared_model, model_config, tier, personality_seed, public_camera)
  VALUES ('ag_sdn_r1', 'sdnr1', 1, 'ag_sdn_r1', 'test', 'sovereign', 'sdn-a', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE),
         ('ag_sdn_r2', 'sdnr2', 1, 'ag_sdn_r2', 'test', 'sovereign', 'sdn-a', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE),
         ('ag_sdn_r3', 'sdnr3', 1, 'ag_sdn_r3', 'test', 'sovereign', 'sdn-a', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE),
         ('ag_sdn_b1', 'sdnb1', 1, 'ag_sdn_b1', 'test', 'sovereign', 'sdn-b', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE),
         ('ag_sdn_b2', 'sdnb2', 1, 'ag_sdn_b2', 'test', 'sovereign', 'sdn-b', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE),
         ('ag_sdn_r4', 'sdnr4', 1, 'ag_sdn_r4', 'test', 'sovereign', 'sdn-a', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE),
         ('ag_sdn_r5', 'sdnr5', 1, 'ag_sdn_r5', 'test', 'sovereign', 'sdn-a', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE);
INSERT INTO mcp_roster (player_name, owner_id) VALUES ('ranger', 'sdn-a'), ('miner', 'sdn-a'), ('scout', 'sdn-b'), ('quiet', 'sdn-a');
INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status) VALUES
  ('ag-sdn-r1', 'sdn-a', 'ag_sdn_r1', 'Ranger', 'claude-code', 'active'),
  ('ag-sdn-r2', 'sdn-a', 'ag_sdn_r2', 'Miner', 'claude-code', 'active'),
  ('ag-sdn-r3', 'sdn-a', 'ag_sdn_r3', 'miner', 'claude-code', 'active'),
  ('ag-sdn-b1', 'sdn-b', 'ag_sdn_b1', 'RANGER', 'claude-code', 'active'),
  ('ag-sdn-b2', 'sdn-b', 'ag_sdn_b2', 'Scout', 'claude-code', 'active'),
  -- A retired player under the same owner: it must not change the answer for Ranger (status <> 'retired').
  ('ag-sdn-r4', 'sdn-a', 'ag_sdn_r4', 'RANGER', 'claude-code', 'retired'),
  -- The only player of roster name quiet is retired: the answer is NULL.
  ('ag-sdn-r5', 'sdn-a', 'ag_sdn_r5', 'Quiet', 'claude-code', 'retired');

DO $check$
DECLARE
  step TEXT;
  sig CONSTANT TEXT := 'supervisor_player_display_name(text,text)';
BEGIN
  step := 'display name: function is a definer with a pinned search_path';
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = sig::regprocedure AND p.prosecdef
       AND 'search_path=pg_catalog, public, pg_temp' = ANY (p.proconfig)
  ) THEN
    RAISE EXCEPTION 'schema check (%): must be SECURITY DEFINER with the pinned search_path', step;
  END IF;

  step := 'display name: geldar_supervisor may execute';
  IF NOT has_function_privilege('geldar_supervisor', sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'schema check (%): geldar_supervisor must execute it', step;
  END IF;

  step := 'display name: PUBLIC has no execute (proacl NULL is the default, PUBLIC execute)';
  IF EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = sig::regprocedure
       AND (p.proacl IS NULL
            OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'schema check (%): PUBLIC must not execute it', step;
  END IF;

  step := 'display name: the other app roles cannot execute it';
  IF has_function_privilege('geldar_mcp', sig, 'EXECUTE')
     OR has_function_privilege('geldar_register', sig, 'EXECUTE')
     OR has_function_privilege('geldar_glass', sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'schema check (%): mcp, register and glass must not execute it', step;
  END IF;

  step := 'display name: a matching owner gets the exact case, whatever case is asked';
  IF supervisor_player_display_name('sdn-a', 'Ranger') IS DISTINCT FROM 'Ranger' THEN
    RAISE EXCEPTION 'schema check (%): owner sdn-a must get Ranger', step;
  END IF;

  step := 'display name: a foreign owner gets NULL for a name it does not hold';
  IF supervisor_player_display_name('sdn-b', 'ranger') IS NOT NULL THEN
    RAISE EXCEPTION 'schema check (%): owner sdn-b must get NULL for ranger', step;
  END IF;

  step := 'display name: a retired player under the same owner does not change the answer';
  IF supervisor_player_display_name('sdn-a', 'ranger') IS DISTINCT FROM 'Ranger' THEN
    RAISE EXCEPTION 'schema check (%): a retired RANGER must not change Ranger', step;
  END IF;

  step := 'display name: a roster name whose only player is retired gives NULL';
  IF supervisor_player_display_name('sdn-a', 'quiet') IS NOT NULL THEN
    RAISE EXCEPTION 'schema check (%): a retired-only roster name must give NULL', step;
  END IF;

  step := 'display name: two spellings of one owner name give NULL';
  IF supervisor_player_display_name('sdn-a', 'miner') IS NOT NULL THEN
    RAISE EXCEPTION 'schema check (%): two spellings must give NULL', step;
  END IF;

  step := 'display name: a name the owner does not hold gives NULL';
  IF supervisor_player_display_name('sdn-a', 'scout') IS NOT NULL THEN
    RAISE EXCEPTION 'schema check (%): sdn-a does not hold scout', step;
  END IF;

  step := 'display name: an unknown name gives NULL';
  IF supervisor_player_display_name('sdn-a', 'nobody') IS NOT NULL THEN
    RAISE EXCEPTION 'schema check (%): an unknown name must give NULL', step;
  END IF;

  step := 'display name: the holder of scout gets its exact case';
  IF supervisor_player_display_name('sdn-b', 'SCOUT') IS DISTINCT FROM 'Scout' THEN
    RAISE EXCEPTION 'schema check (%): sdn-b must get Scout', step;
  END IF;
END
$check$;
