-- Migration 0061 (ROSTER-AUTO): structure, refusals and behaviour of register_roster_add. Run after the
-- migrations, as a superuser. RAISE EXCEPTION fails the run (ON_ERROR_STOP).

DO $check$
DECLARE
  r RECORD;
  step TEXT;
  refused BOOLEAN;
  n INT;
  nm TEXT;
  owner_txt TEXT;
  h_own BYTEA := decode(repeat('d1', 32), 'hex');
  h_other BYTEA := decode(repeat('d2', 32), 'hex');
  h_ban BYTEA := decode(repeat('d3', 32), 'hex');
BEGIN
  step := 'function exists, is SECURITY DEFINER, pins search_path';
  SELECT p.prosecdef, p.proconfig INTO r
    FROM pg_proc p
    WHERE p.oid = 'register_roster_add(bytea, text)'::regprocedure;
  IF NOT FOUND OR NOT r.prosecdef OR r.proconfig IS NULL OR NOT ('search_path=pg_catalog, public, pg_temp' = ANY (r.proconfig)) THEN
    RAISE EXCEPTION 'schema check (%): must be SECURITY DEFINER with the pinned search_path', step;
  END IF;

  step := 'no PUBLIC execute; geldar_register has execute';
  IF has_function_privilege('public', 'register_roster_add(bytea, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'schema check (%): PUBLIC can execute register_roster_add', step;
  END IF;
  IF NOT has_function_privilege('geldar_register', 'register_roster_add(bytea, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'schema check (%): geldar_register cannot execute register_roster_add', step;
  END IF;

  step := 'a display name outside 3 to 16 letters, digits or underscore is refused before any lookup';
  BEGIN
    PERFORM register_roster_add(decode('00', 'hex'), 'ab');
    RAISE EXCEPTION 'schema check (%): a 2-character name was accepted', step;
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
  BEGIN
    PERFORM register_roster_add(decode('00', 'hex'), 'abcdefghijklmnopq');
    RAISE EXCEPTION 'schema check (%): a 17-character name was accepted', step;
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
  BEGIN
    PERFORM register_roster_add(decode('00', 'hex'), 'my agent');
    RAISE EXCEPTION 'schema check (%): a name with a space was accepted', step;
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
  BEGIN
    PERFORM register_roster_add(decode('00', 'hex'), 'ab-cd');
    RAISE EXCEPTION 'schema check (%): a name with a hyphen was accepted', step;
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
  BEGIN
    PERFORM register_roster_add(decode('00', 'hex'), '');
    RAISE EXCEPTION 'schema check (%): an empty name was accepted', step;
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  step := 'an unknown identity is refused (42501)';
  BEGIN
    PERFORM register_roster_add(decode('00', 'hex'), 'Ranger');
    RAISE EXCEPTION 'schema check (%): an unknown identity was accepted', step;
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;

  step := 'fixture: owners ra-own, ra-other (cap 3) and ra-ban (banned identity), one identity each';
  INSERT INTO mcp_owners (owner_id, display, player_cap, is_admin) VALUES
    ('ra-own', 'ra own', 3, false), ('ra-other', 'ra other', 3, false), ('ra-ban', 'ra ban', 3, false);
  INSERT INTO mcp_identities (identity_hash, provider, owner_id, banned_at) VALUES
    (h_own, 'microsoft', 'ra-own', NULL), (h_other, 'microsoft', 'ra-other', NULL),
    (h_ban, 'microsoft', 'ra-ban', now());

  step := 'a name of 3 and a name of 16 characters are written for their owner';
  PERFORM register_roster_add(h_own, 'abc');
  PERFORM register_roster_add(h_own, 'abcdefghijklmnop');

  step := 'the same owner and name in another case is idempotent: no error, one roster row, one audit row per call';
  PERFORM register_roster_add(h_own, 'ABC');
  SELECT count(*) INTO n FROM mcp_roster WHERE owner_id = 'ra-own' AND player_name IN ('abc', 'abcdefghijklmnop');
  IF n <> 2 THEN
    RAISE EXCEPTION 'schema check (%): expected 2 roster rows for ra-own, found %', step, n;
  END IF;
  SELECT count(*) INTO n FROM register_audit WHERE actor = 'ra-own' AND action = 'roster.add';
  IF n <> 3 THEN
    RAISE EXCEPTION 'schema check (%): expected 3 roster.add audit rows for ra-own, found %', step, n;
  END IF;

  step := 'a name held by another owner is refused 23505, the row keeps its owner and nothing is audited for the other owner';
  refused := false;
  BEGIN
    PERFORM register_roster_add(h_other, 'abc');
  EXCEPTION WHEN SQLSTATE '23505' THEN
    refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check (%): another owner took a held name', step;
  END IF;
  SELECT m.owner_id INTO owner_txt FROM mcp_roster m WHERE m.player_name = 'abc';
  IF owner_txt IS DISTINCT FROM 'ra-own' THEN
    RAISE EXCEPTION 'schema check (%): the held name changed owner to %', step, owner_txt;
  END IF;
  SELECT count(*) INTO n FROM register_audit WHERE actor = 'ra-other';
  IF n <> 0 THEN
    RAISE EXCEPTION 'schema check (%): a refused call wrote an audit row', step;
  END IF;

  step := 'a banned identity is refused 42501 and writes no roster row';
  refused := false;
  BEGIN
    PERFORM register_roster_add(h_ban, 'rabanned');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check (%): a banned identity was accepted', step;
  END IF;
  SELECT count(*) INTO n FROM mcp_roster WHERE player_name = 'rabanned';
  IF n <> 0 THEN
    RAISE EXCEPTION 'schema check (%): a banned identity left a roster row', step;
  END IF;

  step := 'names of 2, 17, with a space, a hyphen, a non-ASCII letter, or empty are refused 22023 for a valid owner';
  FOREACH nm IN ARRAY ARRAY['ab', 'abcdefghijklmnopq', 'a b c', 'ab-cd', 'abc' || chr(233), ''] LOOP
    refused := false;
    BEGIN
      PERFORM register_roster_add(h_own, nm);
    EXCEPTION WHEN SQLSTATE '22023' THEN
      refused := true;
    END;
    IF NOT refused THEN
      RAISE EXCEPTION 'schema check (%): the name % was accepted', step, nm;
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM mcp_roster WHERE owner_id = 'ra-own';
  IF n <> 2 THEN
    RAISE EXCEPTION 'schema check (%): a refused name left a roster row (found % for ra-own)', step, n;
  END IF;

  step := 'the third agent is accepted and the fourth is refused by the cap trigger 0006; its roster name is not written';
  PERFORM register_create_player(h_own, 'ag-ra-p1', 'ag_ra_p1', 'ra_one', 'harness-x', 'main', 'ra_t1',
    decode(repeat('e1', 32), 'hex'));
  PERFORM register_roster_add(h_own, 'ra_one');
  PERFORM register_create_player(h_own, 'ag-ra-p2', 'ag_ra_p2', 'ra_two', 'harness-x', 'main', 'ra_t2',
    decode(repeat('e2', 32), 'hex'));
  PERFORM register_roster_add(h_own, 'ra_two');
  PERFORM register_create_player(h_own, 'ag-ra-p3', 'ag_ra_p3', 'ra_three', 'harness-x', 'main', 'ra_t3',
    decode(repeat('e3', 32), 'hex'));
  PERFORM register_roster_add(h_own, 'ra_three');
  SELECT count(*) INTO n FROM mcp_players WHERE owner_id = 'ra-own';
  IF n <> 3 THEN
    RAISE EXCEPTION 'schema check (%): expected 3 players for ra-own, found %', step, n;
  END IF;
  -- A roster call before the fourth create: the cap must still hold after it (no trigger bypass).
  PERFORM register_roster_add(h_own, 'ra_pre');
  refused := false;
  BEGIN
    PERFORM register_create_player(h_own, 'ag-ra-p4', 'ag_ra_p4', 'ra_four', 'harness-x', 'main', 'ra_t4',
      decode(repeat('e4', 32), 'hex'));
    PERFORM register_roster_add(h_own, 'ra_four');
  EXCEPTION WHEN OTHERS THEN
    refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check (%): a fourth player passed the owner cap of 3', step;
  END IF;
  SELECT count(*) INTO n FROM mcp_players WHERE owner_id = 'ra-own';
  IF n <> 3 THEN
    RAISE EXCEPTION 'schema check (%): the refused fourth player left a row (found % players)', step, n;
  END IF;
  SELECT count(*) INTO n FROM mcp_roster WHERE player_name = 'ra_four';
  IF n <> 0 THEN
    RAISE EXCEPTION 'schema check (%): the refused fourth player left a roster row', step;
  END IF;
  SELECT count(*) INTO n FROM agents WHERE owner = 'ra-own' AND name = 'ra_four';
  IF n <> 0 THEN
    RAISE EXCEPTION 'schema check (%): the refused fourth player left an agent row', step;
  END IF;

  step := 'a create whose roster name is held by another owner rolls back the agent and the player together';
  refused := false;
  BEGIN
    PERFORM register_create_player(h_other, 'ag-ra-o1', 'ag_ra_o1', 'abc', 'harness-x', 'main', 'ra_to1',
      decode(repeat('e5', 32), 'hex'));
    PERFORM register_roster_add(h_other, 'abc');
  EXCEPTION WHEN SQLSTATE '23505' THEN
    refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check (%): the held name was not refused with 23505', step;
  END IF;
  SELECT count(*) INTO n FROM mcp_players WHERE owner_id = 'ra-other';
  IF n <> 0 THEN
    RAISE EXCEPTION 'schema check (%): the refused create left a player row', step;
  END IF;
  SELECT count(*) INTO n FROM agents WHERE owner = 'ra-other' AND name = 'abc';
  IF n <> 0 THEN
    RAISE EXCEPTION 'schema check (%): the refused create left an agent row', step;
  END IF;

  RAISE NOTICE 'check-schema-roster-auto: all steps passed';
END
$check$;
