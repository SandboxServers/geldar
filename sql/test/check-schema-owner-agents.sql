-- Migration 0036 (C7-04b-5): behaviour of the owner-id agent loaders. Run after check-schema-session-owner-keys.sql.
-- Fixtures are written by the superuser; every call runs under geldar_register (the only role with EXECUTE).
DO $owner_agents$
DECLARE
  step TEXT;
  refused BOOLEAN;
  n INT;
  cam BOOLEAN;
  h_own BYTEA := decode(repeat('f1', 32), 'hex');
  h_other BYTEA := decode(repeat('f2', 32), 'hex');
  h_ban BYTEA := decode(repeat('f3', 32), 'hex');
BEGIN
  step := 'fixture: owners ag-own, ag-other, ag-ban (banned identity), two players for ag-own, one for ag-other';
  INSERT INTO mcp_owners (owner_id, display, player_cap, is_admin) VALUES
    ('ag-own', 'own', 5, false), ('ag-other', 'other', 5, false), ('ag-ban', 'ban', 5, false);
  INSERT INTO mcp_identities (identity_hash, provider, owner_id, banned_at) VALUES
    (h_own, 'microsoft', 'ag-own', NULL), (h_other, 'microsoft', 'ag-other', NULL),
    (h_ban, 'microsoft', 'ag-ban', now());
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
                      declared_model, model_config, tier, personality_seed,
                      public_camera, thoughts_delayed_public) VALUES
    ('ag_p1', 'p1', 1, 'ag_p1', 'main', 'sovereign', 'ag-own', 'harness-x',
     'self-reported', 'declared:unverified', 'sovereign', NULL, true, true),
    ('ag_p2', 'p2', 1, 'ag_p2', 'main', 'sovereign', 'ag-own', 'harness-x',
     'self-reported', 'declared:unverified', 'sovereign', NULL, false, false),
    ('ag_foreign', 'fo', 1, 'ag_foreign', 'main', 'sovereign', 'ag-other', 'harness-x',
     'self-reported', 'declared:unverified', 'sovereign', NULL, false, false),
    ('ag_banned_p', 'bp', 1, 'ag_banned_p', 'main', 'sovereign', 'ag-ban', 'harness-x',
     'self-reported', 'declared:unverified', 'sovereign', NULL, false, false);
  INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status) VALUES
    ('ag-p1', 'ag-own', 'ag_p1', 'p1', 'harness-x', 'active'),
    ('ag-p2', 'ag-own', 'ag_p2', 'p2', 'harness-x', 'paused'),
    ('ag-foreign', 'ag-other', 'ag_foreign', 'fo', 'harness-x', 'active'),
    ('ag-banned-p', 'ag-ban', 'ag_banned_p', 'bp', 'harness-x', 'active');

  step := 'grants: EXECUTE for geldar_register only; no PUBLIC grant; other roles have no EXECUTE';
  IF NOT has_function_privilege('geldar_register', 'register_owner_list_players(text)', 'EXECUTE')
     OR NOT has_function_privilege('geldar_register', 'register_owner_get_player(text,text)', 'EXECUTE')
     OR has_function_privilege('geldar_mcp', 'register_owner_list_players(text)', 'EXECUTE')
     OR has_function_privilege('geldar_mcp', 'register_owner_get_player(text,text)', 'EXECUTE')
     OR has_function_privilege('geldar_glass', 'register_owner_list_players(text)', 'EXECUTE')
     OR has_function_privilege('geldar_glass', 'register_owner_get_player(text,text)', 'EXECUTE')
     OR has_function_privilege('geldar_supervisor', 'register_owner_list_players(text)', 'EXECUTE')
     OR has_function_privilege('geldar_supervisor', 'register_owner_get_player(text,text)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.proname IN ('register_owner_list_players', 'register_owner_get_player')
                  AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'schema check: owner agent loaders must be run by geldar_register only' USING ERRCODE = 'P0002';
  END IF;

  step := 'definer: both loaders are SECURITY DEFINER with the pinned search_path';
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.proname IN ('register_owner_list_players', 'register_owner_get_player')
         AND p.prosecdef
         AND coalesce(p.proconfig, '{}') @> ARRAY['search_path=pg_catalog, public, pg_temp']) <> 2 THEN
    RAISE EXCEPTION 'schema check: owner agent loaders must be definer functions with the pinned search_path'
      USING ERRCODE = 'P0002';
  END IF;

  step := 'list: the owner sees exactly its own two players, with the flags';
  SELECT count(*) INTO n FROM register_owner_list_players('ag-own');
  IF n <> 2 OR EXISTS (SELECT 1 FROM register_owner_list_players('ag-own') WHERE player_id = 'ag-foreign') THEN
    RAISE EXCEPTION 'schema check: list for ag-own must return its two players and no foreign one' USING ERRCODE = 'P0002';
  END IF;
  SELECT public_camera INTO cam FROM register_owner_list_players('ag-own') WHERE player_id = 'ag-p1';
  IF cam IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'schema check: list must carry the public camera flag' USING ERRCODE = 'P0002';
  END IF;

  step := 'list: an unknown owner returns no rows (not a refusal)';
  SELECT count(*) INTO n FROM register_owner_list_players('ag-nobody');
  IF n <> 0 THEN
    RAISE EXCEPTION 'schema check: list for an unknown owner must be empty' USING ERRCODE = 'P0002';
  END IF;

  step := 'get: the owner gets its own player, and a foreign or unknown player returns no row';
  SELECT count(*) INTO n FROM register_owner_get_player('ag-own', 'ag-p1');
  IF n <> 1 THEN
    RAISE EXCEPTION 'schema check: get of an own player must return one row' USING ERRCODE = 'P0002';
  END IF;
  SELECT count(*) INTO n FROM register_owner_get_player('ag-own', 'ag-foreign');
  IF n <> 0 THEN
    RAISE EXCEPTION 'schema check: get of another owner''s player must return no row' USING ERRCODE = 'P0002';
  END IF;
  SELECT count(*) INTO n FROM register_owner_get_player('ag-own', 'ag-missing');
  IF n <> 0 THEN
    RAISE EXCEPTION 'schema check: get of an unknown player must return no row' USING ERRCODE = 'P0002';
  END IF;

  step := 'banned: list and get refuse a banned owner with 42501 (not an empty result)';
  refused := false;
  BEGIN
    SET LOCAL ROLE geldar_register;
    PERFORM 1 FROM register_owner_list_players('ag-ban');
  EXCEPTION WHEN SQLSTATE '42501' THEN refused := true;
  END;
  RESET ROLE;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check: list must refuse a banned owner with 42501' USING ERRCODE = 'P0002';
  END IF;
  refused := false;
  BEGIN
    SET LOCAL ROLE geldar_register;
    PERFORM 1 FROM register_owner_get_player('ag-ban', 'ag-banned-p');
  EXCEPTION WHEN SQLSTATE '42501' THEN refused := true;
  END;
  RESET ROLE;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check: get must refuse a banned owner with 42501' USING ERRCODE = 'P0002';
  END IF;

  step := 'other roles: geldar_mcp cannot execute the list (42501)';
  refused := false;
  BEGIN
    SET LOCAL ROLE geldar_mcp;
    PERFORM 1 FROM register_owner_list_players('ag-own');
  EXCEPTION WHEN SQLSTATE '42501' THEN refused := true;
  END;
  RESET ROLE;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check: geldar_mcp must not execute register_owner_list_players' USING ERRCODE = 'P0002';
  END IF;
END
$owner_agents$;
