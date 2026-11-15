-- Migration 0063 (BH-1): the life id and the managed player-host config. Run after the migrations, as a
-- superuser. Fixtures are inserted inside a sub-block that always rolls back (the P9999 trick), so the run
-- leaves no rows behind. RAISE EXCEPTION fails the run (ON_ERROR_STOP).

DO $check$
DECLARE
  r RECORD;
  step TEXT;
  cfg JSONB;
  lid TEXT;
  hk TEXT;
  keys TEXT[];
  n INT;
  h_own BYTEA := decode(repeat('b1', 32), 'hex');
  h_other BYTEA := decode(repeat('b2', 32), 'hex');
  h_ban BYTEA := decode(repeat('b3', 32), 'hex');
  h_col BYTEA := decode(repeat('b4', 32), 'hex');
  fn_sup TEXT := 'supervisor_player_life_id(text, text)';
  fn_cfg TEXT := 'player_host_config(text)';
  fn_mlid TEXT := 'managed_life_id(text)';
BEGIN
  BEGIN
    step := 'functions are SECURITY DEFINER with a pinned search_path';
    FOR r IN SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p
              WHERE p.oid IN (to_regprocedure(fn_sup), to_regprocedure(fn_cfg)) LOOP
      IF NOT r.prosecdef OR r.proconfig IS NULL OR NOT ('search_path=pg_catalog, public, pg_temp' = ANY (r.proconfig)) THEN
        RAISE EXCEPTION 'schema check (%): % is not a pinned definer', step, r.proname;
      END IF;
    END LOOP;
    IF (SELECT count(*) FROM pg_proc p WHERE p.oid IN (to_regprocedure(fn_sup), to_regprocedure(fn_cfg))) <> 2 THEN
      RAISE EXCEPTION 'schema check (%): one of the two functions is missing', step;
    END IF;

    step := 'PUBLIC cannot execute any of the three functions';
    IF has_function_privilege('public', fn_sup, 'EXECUTE') OR has_function_privilege('public', fn_cfg, 'EXECUTE')
       OR has_function_privilege('public', fn_mlid, 'EXECUTE') THEN
      RAISE EXCEPTION 'schema check (%): PUBLIC has execute', step;
    END IF;

    step := 'geldar_helper executes the supervisor function only; geldar_body_host executes the config function only';
    IF NOT has_function_privilege('geldar_helper', fn_sup, 'EXECUTE') THEN
      RAISE EXCEPTION 'schema check (%): geldar_helper lacks execute on supervisor_player_life_id', step;
    END IF;
    IF has_function_privilege('geldar_helper', fn_cfg, 'EXECUTE') THEN
      RAISE EXCEPTION 'schema check (%): geldar_helper can execute player_host_config', step;
    END IF;
    IF NOT has_function_privilege('geldar_body_host', fn_cfg, 'EXECUTE') THEN
      RAISE EXCEPTION 'schema check (%): geldar_body_host lacks execute on player_host_config', step;
    END IF;
    IF has_function_privilege('geldar_body_host', fn_sup, 'EXECUTE') THEN
      RAISE EXCEPTION 'schema check (%): geldar_body_host can execute supervisor_player_life_id', step;
    END IF;

    step := 'geldar_register, geldar_mcp, geldar_helper and geldar_body_host cannot execute managed_life_id';
    IF has_function_privilege('geldar_register', fn_mlid, 'EXECUTE') OR has_function_privilege('geldar_mcp', fn_mlid, 'EXECUTE')
       OR has_function_privilege('geldar_helper', fn_mlid, 'EXECUTE') OR has_function_privilege('geldar_body_host', fn_mlid, 'EXECUTE') THEN
      RAISE EXCEPTION 'schema check (%): a role can execute managed_life_id', step;
    END IF;

    step := 'geldar_register and geldar_mcp cannot execute either function';
    IF has_function_privilege('geldar_register', fn_sup, 'EXECUTE') OR has_function_privilege('geldar_register', fn_cfg, 'EXECUTE')
       OR has_function_privilege('geldar_mcp', fn_sup, 'EXECUTE') OR has_function_privilege('geldar_mcp', fn_cfg, 'EXECUTE') THEN
      RAISE EXCEPTION 'schema check (%): a register or mcp role can execute a body-host function', step;
    END IF;

    step := 'geldar_body_host is NOLOGIN and holds no table privilege';
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geldar_body_host' AND NOT rolcanlogin) THEN
      RAISE EXCEPTION 'schema check (%): geldar_body_host is missing or can log in', step;
    END IF;
    FOR r IN SELECT t.tbl FROM (VALUES ('mcp_roster'), ('mcp_players'), ('agents'), ('mcp_identities'), ('mcp_owners')) t(tbl) LOOP
      IF has_table_privilege('geldar_body_host', 'public.' || r.tbl, 'SELECT') THEN
        RAISE EXCEPTION 'schema check (%): geldar_body_host can SELECT %', step, r.tbl;
      END IF;
    END LOOP;

    step := 'geldar_helper cannot read the roster, the players, the agents or the identities';
    IF has_table_privilege('geldar_helper', 'public.mcp_roster', 'SELECT')
       OR has_table_privilege('geldar_helper', 'public.mcp_players', 'SELECT')
       OR has_table_privilege('geldar_helper', 'public.agents', 'SELECT')
       OR has_table_privilege('geldar_helper', 'public.mcp_identities', 'SELECT') THEN
      RAISE EXCEPTION 'schema check (%): geldar_helper can SELECT a table it must not read', step;
    END IF;

    step := 'host_key is a NOT NULL uuid with a generated default, and no body-host or MCP role reads it';
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'mcp_players' AND column_name = 'host_key'
                      AND data_type = 'uuid' AND is_nullable = 'NO' AND column_default LIKE 'gen_random_uuid()%') THEN
      RAISE EXCEPTION 'schema check (%): mcp_players.host_key is not a NOT NULL uuid with gen_random_uuid()', step;
    END IF;
    IF has_any_column_privilege('geldar_helper', 'public.mcp_players', 'SELECT')
       OR has_any_column_privilege('geldar_body_host', 'public.mcp_players', 'SELECT')
       OR has_column_privilege('geldar_mcp', 'public.mcp_players', 'host_key', 'SELECT') THEN
      RAISE EXCEPTION 'schema check (%): a helper, body or MCP role can read mcp_players.host_key', step;
    END IF;
    IF NOT has_column_privilege('geldar_mcp', 'public.mcp_players', 'player_id', 'SELECT') THEN
      RAISE EXCEPTION 'schema check (%): geldar_mcp lost SELECT on mcp_players.player_id', step;
    END IF;

    -- Fixtures. Owner reg-bh-own holds BhOne and BhSplit2; reg-bh-col holds BhCol1 and BhCol2 (a colliding pair).
    PERFORM register_create_owner(h_own, 'microsoft', 'reg-bh-own', 'bh own');
    PERFORM register_create_owner(h_other, 'microsoft', 'reg-bh-other', 'bh other');
    PERFORM register_create_owner(h_ban, 'microsoft', 'reg-bh-ban', 'bh ban');
    PERFORM register_create_owner(h_col, 'microsoft', 'reg-bh-col', 'bh col');
    PERFORM register_create_player(h_own, 'ag-bh-one', 'ag_bh_one', 'BhOne', 'harness-x', 'main', 'bh_t1', decode(repeat('c1', 32), 'hex'));
    PERFORM register_roster_add(h_own, 'BhOne');
    PERFORM register_create_player(h_ban, 'ag-bh-ban', 'ag_bh_ban', 'BhBan', 'harness-x', 'main', 'bh_t2', decode(repeat('c2', 32), 'hex'));
    PERFORM register_roster_add(h_ban, 'BhBan');
    PERFORM register_create_player(h_col, 'ag-cnsze3', 'ag_cnsze3', 'BhCol1', 'harness-x', 'main', 'bh_t3', decode(repeat('c3', 32), 'hex'));
    PERFORM register_roster_add(h_col, 'BhCol1');
    PERFORM register_create_player(h_col, 'ag-cwl9s6', 'ag_cwl9s6', 'BhCol2', 'harness-x', 'main', 'bh_t4', decode(repeat('c4', 32), 'hex'));
    PERFORM register_roster_add(h_col, 'BhCol2');
    UPDATE mcp_identities SET banned_at = now() WHERE owner_id = 'reg-bh-ban';

    step := 'managed_life_id is ag_ plus 12 hex, 15 characters, and the sha256 prefix of the host key text';
    SELECT p.host_key::text INTO hk FROM mcp_players p WHERE p.player_id = 'ag-bh-one';
    lid := managed_life_id(hk);
    IF lid !~ '^ag_[a-z0-9]{1,12}$' OR length(lid) <> 15 OR lid !~ '^ag_[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'schema check (%): % is not ag_ plus 12 hex', step, lid;
    END IF;
    IF lid <> 'ag_' || left(encode(sha256(convert_to(hk, 'UTF8')), 'hex'), 12) THEN
      RAISE EXCEPTION 'schema check (%): % is not the sha256 prefix of the host key', step, lid;
    END IF;

    step := 'the life id does not depend on player_id: an owner-chosen player_id text cannot steer it';
    IF lid = managed_life_id('ag-bh-one') THEN
      RAISE EXCEPTION 'schema check (%): the id is the player_id hash, not the host key hash', step;
    END IF;

    step := 'supervisor_player_life_id returns the managed id for a roster name, the same id twice';
    lid := supervisor_player_life_id('reg-bh-own', 'BhOne');
    IF lid IS NULL OR lid <> managed_life_id(hk) THEN
      RAISE EXCEPTION 'schema check (%): got % for BhOne', step, lid;
    END IF;
    IF supervisor_player_life_id('reg-bh-own', 'BhOne') IS DISTINCT FROM lid THEN
      RAISE EXCEPTION 'schema check (%): the same agent gave two ids', step;
    END IF;

    step := 'the roster lookup ignores case (the roster key is lower-cased)';
    IF supervisor_player_life_id('reg-bh-own', 'bhone') IS DISTINCT FROM lid THEN
      RAISE EXCEPTION 'schema check (%): lower-case bhone did not find BhOne', step;
    END IF;

    step := 'a name not on the roster gives NULL, and a NULL input gives NULL';
    IF supervisor_player_life_id('reg-bh-own', 'NoSuchName') IS NOT NULL THEN
      RAISE EXCEPTION 'schema check (%): a name not on the roster gave an id', step;
    END IF;
    IF supervisor_player_life_id(NULL, 'BhOne') IS NOT NULL OR supervisor_player_life_id('reg-bh-own', NULL) IS NOT NULL THEN
      RAISE EXCEPTION 'schema check (%): a NULL input gave an id', step;
    END IF;

    step := 'another owner roster row gives NULL';
    IF supervisor_player_life_id('reg-bh-other', 'BhOne') IS NOT NULL THEN
      RAISE EXCEPTION 'schema check (%): bh-other got an id for bh-own roster name BhOne', step;
    END IF;

    step := 'a roster row of another owner for the name gives NULL (the roster join is by owner)';
    PERFORM register_create_player(h_own, 'ag-bh-split', 'ag_bh_split', 'BhSplit2', 'harness-x', 'main', 'bh_t5', decode(repeat('c5', 32), 'hex'));
    PERFORM register_roster_add(h_other, 'BhSplit2');
    IF supervisor_player_life_id('reg-bh-own', 'BhSplit2') IS NOT NULL THEN
      RAISE EXCEPTION 'schema check (%): bh-own got an id through bh-other roster row', step;
    END IF;

    step := 'two owners with the same display name: each gets its own id, never the other';
    PERFORM register_create_player(h_other, 'ag-bh-twin', 'ag_bh_twin', 'BhOne', 'harness-x', 'main', 'bh_t6', decode(repeat('c6', 32), 'hex'));
    -- roster names are unique across owners, so the twin has no roster row; the owner filter on the player
    -- is what keeps it out of bh-own's answer.
    IF supervisor_player_life_id('reg-bh-own', 'BhOne') IS DISTINCT FROM lid THEN
      RAISE EXCEPTION 'schema check (%): bh-own lost BhOne when bh-other had the same name', step;
    END IF;
    IF supervisor_player_life_id('reg-bh-other', 'BhOne') IS NOT DISTINCT FROM lid THEN
      RAISE EXCEPTION 'schema check (%): bh-other got bh-own id for the same name', step;
    END IF;

    step := 'a banned owner gives NULL from the supervisor function too';
    IF supervisor_player_life_id('reg-bh-ban', 'BhBan') IS NOT NULL THEN
      RAISE EXCEPTION 'schema check (%): a banned owner got a life id', step;
    END IF;

    step := 'player_host_config returns exactly the four fields, the right values, and no host key';
    cfg := player_host_config(lid);
    SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(cfg) AS k;
    IF keys IS DISTINCT FROM ARRAY['character_sheet', 'display_name', 'harness', 'model'] THEN
      RAISE EXCEPTION 'schema check (%): keys are %', step, keys;
    END IF;
    IF cfg->>'display_name' <> 'BhOne' OR cfg->>'harness' <> 'harness-x' THEN
      RAISE EXCEPTION 'schema check (%): wrong display name or harness: %', step, cfg;
    END IF;
    IF position(hk IN cfg::text) > 0 OR position(hk IN lid) > 0 THEN
      RAISE EXCEPTION 'schema check (%): the host key appears in the config or the id', step;
    END IF;

    step := 'player_host_config gives NULL for an unknown id and for a banned owner';
    IF player_host_config('ag_000000000000') IS NOT NULL THEN
      RAISE EXCEPTION 'schema check (%): an unknown id gave a config', step;
    END IF;
    IF player_host_config(managed_life_id((SELECT host_key::text FROM mcp_players WHERE player_id = 'ag-bh-ban'))) IS NOT NULL THEN
      RAISE EXCEPTION 'schema check (%): a banned owner gave a config', step;
    END IF;

    step := 'a player whose roster row is gone gives NULL from player_host_config, and is back when re-added';
    DELETE FROM mcp_roster WHERE owner_id = 'reg-bh-own' AND player_name = 'bhone';
    IF player_host_config(lid) IS NOT NULL THEN
      RAISE EXCEPTION 'schema check (%): a player with no roster row gave a config', step;
    END IF;
    PERFORM register_roster_add(h_own, 'BhOne');
    IF player_host_config(lid) IS NULL THEN
      RAISE EXCEPTION 'schema check (%): the re-added roster row did not restore the config', step;
    END IF;

    step := 'a retired player gives NULL from both functions';
    UPDATE mcp_players SET status = 'retired' WHERE player_id = 'ag-bh-one';
    IF player_host_config(lid) IS NOT NULL OR supervisor_player_life_id('reg-bh-own', 'BhOne') IS NOT NULL THEN
      RAISE EXCEPTION 'schema check (%): a retired player gave an id or a config', step;
    END IF;
    UPDATE mcp_players SET status = 'active' WHERE player_id = 'ag-bh-one';

    step := 'a display-name rename (with its roster row) leaves the life id unchanged';
    UPDATE mcp_players SET display_name = 'BhOneRenamed' WHERE player_id = 'ag-bh-one';
    UPDATE mcp_roster SET player_name = 'bhonerenamed' WHERE owner_id = 'reg-bh-own' AND player_name = 'bhone';
    IF supervisor_player_life_id('reg-bh-own', 'BhOneRenamed') IS DISTINCT FROM lid THEN
      RAISE EXCEPTION 'schema check (%): the rename changed the life id', step;
    END IF;
    UPDATE mcp_players SET display_name = 'BhOne' WHERE player_id = 'ag-bh-one';
    UPDATE mcp_roster SET player_name = 'bhone' WHERE owner_id = 'reg-bh-own' AND player_name = 'bhonerenamed';

    step := 'two agents on one life id: both functions raise 23505 and never return an id';
    -- Two host keys whose sha256 prefixes match (found offline, a Floyd search over the uuid tail):
    -- both give ag_0a17d6416f79. Only the fixtures above are changed, and the run rolls back.
    UPDATE mcp_players SET host_key = '00000000-0000-4000-8000-96221e8f6b0c' WHERE player_id = 'ag-cnsze3';
    UPDATE mcp_players SET host_key = '00000000-0000-4000-8000-7f49fbabdc06' WHERE player_id = 'ag-cwl9s6';
    IF managed_life_id('00000000-0000-4000-8000-96221e8f6b0c') <> 'ag_0a17d6416f79'
       OR managed_life_id('00000000-0000-4000-8000-7f49fbabdc06') <> 'ag_0a17d6416f79' THEN
      RAISE EXCEPTION 'schema check (%): the fixture pair does not collide on ag_0a17d6416f79', step;
    END IF;
    BEGIN
      PERFORM supervisor_player_life_id('reg-bh-col', 'BhCol1');
      RAISE EXCEPTION 'schema check (%): the supervisor function returned on a collision', step;
    EXCEPTION WHEN SQLSTATE '23505' THEN
      NULL;
    END;
    BEGIN
      PERFORM player_host_config('ag_0a17d6416f79');
      RAISE EXCEPTION 'schema check (%): the config function returned on a collision', step;
    EXCEPTION WHEN SQLSTATE '23505' THEN
      NULL;
    END;

    step := 'the migration is recorded';
    SELECT count(*) INTO n FROM schema_migrations WHERE version = '0063';
    IF n <> 1 THEN
      RAISE EXCEPTION 'schema check (%): schema_migrations has % rows for 0063', step, n;
    END IF;

    RAISE NOTICE 'check-schema-body-host: all steps passed';
    RAISE EXCEPTION 'check-schema-body-host: rolling back the fixtures' USING ERRCODE = 'P9999';
  EXCEPTION WHEN SQLSTATE 'P9999' THEN
    NULL;
  END;
END
$check$;
