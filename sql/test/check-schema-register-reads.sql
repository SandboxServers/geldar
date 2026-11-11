-- Migration 0012 (decision 0135, pass-3 F19, F21, F22): the register role reads no table, the three read
-- functions answer for the named identity only, and the input gates of the sign-up functions refuse.
-- Run after sql/test/check-schema.sql, on the same migrated database. Every probe rolls back.
DO $register_reads$
DECLARE
  step TEXT;
  bad RECORD;
BEGIN
  step := 'start';
  -- 0012 (F19): the register role reads no table; the identity hash is not readable by it
  step := 'gates of 0012: no direct reads';
  IF has_table_privilege('geldar_register', 'mcp_identities', 'SELECT')
     OR has_table_privilege('geldar_register', 'mcp_owners', 'SELECT')
     OR has_table_privilege('geldar_register', 'mcp_players', 'SELECT')
     OR has_any_column_privilege('geldar_register', 'mcp_identities', 'SELECT')
     OR has_any_column_privilege('geldar_register', 'mcp_owners', 'SELECT')
     OR has_any_column_privilege('geldar_register', 'mcp_players', 'SELECT')
     OR has_any_column_privilege('geldar_register', 'agents', 'SELECT')
     OR has_any_column_privilege('geldar_register', 'mcp_tokens', 'SELECT') THEN
    RAISE EXCEPTION 'schema check: geldar_register must have no SELECT on identities, owners, players, agents or tokens';
  END IF;
  BEGIN
    SET LOCAL ROLE geldar_register;
    PERFORM identity_hash FROM mcp_identities LIMIT 1;
    RAISE EXCEPTION 'schema check: geldar_register can read identity hashes' USING ERRCODE = 'P0002';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- 0012: the three read functions answer only for the named identity; the input gates refuse
  step := 'gates of 0012: read functions and input gates';
  BEGIN
    SET LOCAL ROLE geldar_register;
    PERFORM register_create_owner(decode(repeat('d1', 32), 'hex'), 'github', 'reg-read-a', 'a');
    PERFORM register_create_owner(decode(repeat('d2', 32), 'hex'), 'github', 'reg-read-b', 'b');
    PERFORM register_create_player(decode(repeat('d1', 32), 'hex'), 'ag-reg-read-01', 'ag_reg_read_01', 'reada',
                                   'claude-code', 'test', 'reg-tok-r1', decode(repeat('d3', 32), 'hex'));
    IF (SELECT owner_id FROM register_find_owner(decode(repeat('d1', 32), 'hex'))) IS DISTINCT FROM 'reg-read-a'
       OR EXISTS (SELECT 1 FROM register_find_owner(decode(repeat('d9', 32), 'hex')))
       OR (SELECT banned FROM register_find_owner(decode(repeat('d2', 32), 'hex'))) IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'schema check: register_find_owner must answer for the named identity only';
    END IF;
    -- F25: a banned identity is answered as banned; the unbanned one still is not
    RESET ROLE;
    UPDATE mcp_identities SET banned_at = now() WHERE identity_hash = decode(repeat('d2', 32), 'hex');
    SET LOCAL ROLE geldar_register;
    IF (SELECT banned FROM register_find_owner(decode(repeat('d2', 32), 'hex'))) IS DISTINCT FROM true
       OR (SELECT banned FROM register_find_owner(decode(repeat('d1', 32), 'hex'))) IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'schema check: register_find_owner must answer banned for a banned identity only';
    END IF;
    -- F27: the bounds themselves are accepted (display 100, name 64)
    PERFORM register_create_owner(decode(repeat('d8', 32), 'hex'), 'github', 'reg-bound-disp', repeat('x', 100));
    PERFORM register_create_player(decode(repeat('d1', 32), 'hex'), 'ag-reg-read-05', 'ag_reg_read_05', repeat('n', 64),
                                   'claude-code', 'test', 'reg-tok-r5', decode(repeat('d9', 32), 'hex'));
    IF (SELECT count(*) FROM register_list_players(decode(repeat('d1', 32), 'hex'))) <> 2 THEN
      RAISE EXCEPTION 'schema check: a 64-character name must be accepted';
    END IF;
    PERFORM register_create_owner(decode(repeat('da', 32), 'hex'), 'github', 'reg-' || repeat('a', 36), 'x');
    IF (SELECT count(*) FROM register_list_players(decode(repeat('d1', 32), 'hex'))) <> 2
       OR NOT EXISTS (SELECT 1 FROM register_list_players(decode(repeat('d1', 32), 'hex')) WHERE player_id = 'ag-reg-read-01')
       OR EXISTS (SELECT 1 FROM register_list_players(decode(repeat('d2', 32), 'hex'))) THEN
      RAISE EXCEPTION 'schema check: register_list_players must list the named identity''s own players only';
    END IF;
    IF register_count_new_owners(now()) < 2 OR register_count_new_owners(now() + interval '1 day') <> 0 THEN
      RAISE EXCEPTION 'schema check: register_count_new_owners must count identities since the time';
    END IF;
    -- owner id shape and length, display length, name length, shard shape: each is 22023
    FOR bad IN SELECT unnest(ARRAY['Bad Id', '-x', 'colo', 'reg-', 'reg-Upper', 'reg-' || repeat('a', 37)]) AS v LOOP
      BEGIN
        PERFORM register_create_owner(decode(repeat('d4', 32), 'hex'), 'github', bad.v, 'x');
        RAISE EXCEPTION 'schema check: register_create_owner took the owner id %', bad.v USING ERRCODE = 'P0002';
      EXCEPTION WHEN invalid_parameter_value THEN NULL;
      END;
    END LOOP;
    BEGIN
      PERFORM register_create_owner(decode(repeat('d4', 32), 'hex'), 'github', 'reg-long-display', repeat('x', 101));
      RAISE EXCEPTION 'schema check: register_create_owner took a 101-character display' USING ERRCODE = 'P0002';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
    BEGIN
      PERFORM register_create_player(decode(repeat('d1', 32), 'hex'), 'ag-reg-read-02', 'ag_reg_read_02', 'x',
                                     'claude-code', 'Bad Shard', 'reg-tok-r2', decode(repeat('d5', 32), 'hex'));
      RAISE EXCEPTION 'schema check: register_create_player took a bad shard' USING ERRCODE = 'P0002';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
    BEGIN
      PERFORM register_create_player(decode(repeat('d1', 32), 'hex'), 'ag-reg-read-03', 'ag_reg_read_03', '',
                                     'claude-code', 'test', 'reg-tok-r3', decode(repeat('d6', 32), 'hex'));
      RAISE EXCEPTION 'schema check: register_create_player took an empty name' USING ERRCODE = 'P0002';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
    BEGIN
      PERFORM register_create_player(decode(repeat('d1', 32), 'hex'), 'ag-reg-read-04', 'ag_reg_read_04', repeat('n', 65),
                                     'claude-code', 'test', 'reg-tok-r4', decode(repeat('d7', 32), 'hex'));
      RAISE EXCEPTION 'schema check: register_create_player took a 65-character name' USING ERRCODE = 'P0002';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
    -- F28: the database holds the daily new-owner cap: the 10th owner of the day is allowed, the 11th refused
    step := 'gates of 0013: daily owner cap';
    IF register_count_new_owners(now() - interval '24 hours') >= 10 THEN
      RAISE EXCEPTION 'schema check: the cap probe needs fewer than 10 owners to start';
    END IF;
    WHILE register_count_new_owners(now() - interval '24 hours') < 10 LOOP
      PERFORM register_create_owner(decode(lpad(to_hex(100 + register_count_new_owners(now() - interval '24 hours')), 2, '0') || repeat('ee', 31), 'hex'),
                                    'github', 'reg-cap-' || register_count_new_owners(now() - interval '24 hours'), 'cap');
    END LOOP;
    BEGIN
      PERFORM register_create_owner(decode(repeat('ef', 32), 'hex'), 'github', 'reg-cap-over', 'cap');
      RAISE EXCEPTION 'schema check: register_create_owner took an 11th owner in a day' USING ERRCODE = 'P0002';
    EXCEPTION WHEN program_limit_exceeded THEN NULL;
    END;
    IF register_count_new_owners(now() - interval '24 hours') <> 10 THEN
      RAISE EXCEPTION 'schema check: a refused owner must leave no row';
    END IF;
    RESET ROLE;
    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'PR001';
  EXCEPTION WHEN SQLSTATE 'PR001' THEN NULL;
  END;
  RAISE NOTICE 'schema check passed: register role reads through functions and the sign-up gates refuse';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'schema check (register reads, %): %', step, SQLERRM;
END
$register_reads$;
