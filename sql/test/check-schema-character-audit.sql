-- Migration 0051 (AN-04b): behaviour of the roll and decision audit, the adoption log, the comment map,
-- the privileges and sheet_erase_life. Run after the migrations. Fixtures are written by the superuser with
-- unique ids (lives cau_life_a and cau_life_b, events cau-ev-*).
-- Mutant: a DELETE without its life_id filter (rolls, say) removes life b's row, so the life b count step fails.
-- Mutant: no ENABLE TRIGGER after a DELETE leaves rolls writable, so the refusal step after the erase fails.
DO $character_audit$
DECLARE
  step TEXT;
  refused BOOLEAN;
  n INT;
  tbl TEXT;
  who TEXT;
  h TEXT := repeat('c3', 32);
  life_tbls TEXT[] := ARRAY['rolls', 'decisions', 'character_sheet_adoptions', 'xp_evidence', 'proficiency', 'proficiency_outbox'];
  audit_tbls TEXT[] := ARRAY['character_sheet_adoptions', 'rolls', 'decisions'];
BEGIN
  step := 'fixture: lives cau_life_a and cau_life_b and their events';
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, harness, declared_model,
                      model_config, tier) VALUES
    ('cau_life_a', 'caua', 1, 'cau_life_a', 'main', 'headless', 'harness-x', 'self-reported',
     'declared:unverified', 'sovereign'),
    ('cau_life_b', 'caub', 1, 'cau_life_b', 'main', 'headless', 'harness-x', 'self-reported',
     'declared:unverified', 'sovereign');
  INSERT INTO events (source_event_id, at, world_tick, type, agent_id) VALUES
    ('cau-ev-r1', now(), 10, 'roll', 'cau_life_a'),
    ('cau-ev-r1b', now(), 10, 'roll', 'cau_life_a'),
    ('cau-ev-r2', now(), 11, 'roll', 'cau_life_a'),
    ('cau-ev-r3', now(), 10, 'roll', 'cau_life_b'),
    ('cau-ev-d1', now(), 10, 'decision', 'cau_life_a'),
    ('cau-ev-d2', now(), 10, 'decision', 'cau_life_b'),
    ('cau-ev-ad1', now(), 10, 'sheet_adopted', 'cau_life_a'),
    ('cau-ev-ad2', now(), 10, 'sheet_adopted', 'cau_life_b');

  step := 'one or two rolls, a decision, an adoption, XP evidence and proficiency for each life';
  INSERT INTO rolls (source_event_id, life_id, world_tick, decision_id, draw_index, engine_version, producer, fx,
                     score, dc, mode, dice, kept, bonus, total, success) VALUES
    ('cau-ev-r1', 'cau_life_a', 10, 'cau-dec-a', 0, 1, 'body', 'mine', 3, 12, 'flat', '{7}', 7, 0, 7, false),
    ('cau-ev-r2', 'cau_life_a', 11, 'cau-dec-a', 1, 1, 'body', 'mine', 3, 12, 'adv', '{4,15}', 15, 0, 15, true),
    ('cau-ev-r3', 'cau_life_b', 10, 'cau-dec-b', 0, 1, 'body', 'mine', 3, 12, 'flat', '{7}', 7, 0, 7, false);
  INSERT INTO decisions (source_event_id, life_id, world_tick, decision_id, engine_version, producer, fx, kind) VALUES
    ('cau-ev-d1', 'cau_life_a', 10, 'cau-dec-a', 1, 'body', 'mine', 'd20'),
    ('cau-ev-d2', 'cau_life_b', 10, 'cau-dec-b', 1, 'body', 'mine', 'd20');
  INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result) VALUES
    ('cau-ev-ad1', 'cau_life_a', h, '{}'::jsonb, 'birth', 'adopted'),
    ('cau-ev-ad2', 'cau_life_b', h, '{}'::jsonb, 'birth', 'adopted');
  INSERT INTO xp_evidence (life_id, domain, evidence_key, source_event_id, world_tick) VALUES
    ('cau_life_a', 'combat', 'cau-k1', 'cau-ev-r1', 10),
    ('cau_life_b', 'combat', 'cau-k2', 'cau-ev-r3', 10);
  INSERT INTO proficiency (life_id, domain, xp, level, updated_tick) VALUES
    ('cau_life_a', 'combat', 5, 0, 10),
    ('cau_life_b', 'combat', 5, 0, 10);
  INSERT INTO proficiency_outbox (life_id, domain, level, xp, version) VALUES
    ('cau_life_a', 'combat', 1, 5, 1),
    ('cau_life_b', 'combat', 1, 5, 1);

  step := 'before the erase each table holds life a and exactly one row of life b';
  FOREACH tbl IN ARRAY life_tbls LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE life_id = $1', tbl) INTO n USING 'cau_life_a';
    IF n < 1 THEN RAISE EXCEPTION 'step %: % has no row for life a', step, tbl; END IF;
    EXECUTE format('SELECT count(*) FROM %I WHERE life_id = $1', tbl) INTO n USING 'cau_life_b';
    IF n <> 1 THEN RAISE EXCEPTION 'step %: % has % rows for life b, expected 1', step, tbl, n; END IF;
  END LOOP;

  step := 'a roll without its event is refused';
  refused := false;
  BEGIN
    INSERT INTO rolls (source_event_id, life_id, world_tick, decision_id, draw_index, engine_version, producer, fx,
                       score, dc, mode, dice, kept, bonus, total, success)
      VALUES ('cau-ev-missing', 'cau_life_a', 10, 'cau-dec-x', 0, 1, 'body', 'mine', 3, 12, 'flat', '{7}', 7, 0, 7, false);
  EXCEPTION WHEN foreign_key_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a roll was accepted without its event', step; END IF;

  step := 'a score of 6 is refused';
  refused := false;
  BEGIN
    INSERT INTO rolls (source_event_id, life_id, world_tick, decision_id, draw_index, engine_version, producer, fx,
                       score, dc, mode, dice, kept, bonus, total, success)
      VALUES ('cau-ev-r1b', 'cau_life_a', 10, 'cau-dec-y', 0, 1, 'body', 'mine', 6, 12, 'flat', '{7}', 7, 0, 7, false);
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: score 6 was accepted', step; END IF;

  step := 'three dice are refused';
  refused := false;
  BEGIN
    INSERT INTO rolls (source_event_id, life_id, world_tick, decision_id, draw_index, engine_version, producer, fx,
                       score, dc, mode, dice, kept, bonus, total, success)
      VALUES ('cau-ev-r1b', 'cau_life_a', 10, 'cau-dec-y', 0, 1, 'body', 'mine', 3, 12, 'flat', '{1,2,3}', 3, 0, 3, false);
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: three dice were accepted', step; END IF;

  step := 'a second roll with the same life, decision and draw index conflicts';
  refused := false;
  BEGIN
    INSERT INTO rolls (source_event_id, life_id, world_tick, decision_id, draw_index, engine_version, producer, fx,
                       score, dc, mode, dice, kept, bonus, total, success)
      VALUES ('cau-ev-r1b', 'cau_life_a', 10, 'cau-dec-a', 0, 1, 'body', 'mine', 3, 12, 'flat', '{7}', 7, 0, 7, false);
  EXCEPTION WHEN unique_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a duplicate roll was accepted', step; END IF;

  step := 'a decision of kind x is refused';
  refused := false;
  BEGIN
    INSERT INTO decisions (source_event_id, life_id, world_tick, decision_id, engine_version, producer, fx, kind)
      VALUES ('cau-ev-r1b', 'cau_life_a', 10, 'cau-dec-z', 1, 'body', 'mine', 'x');
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: kind x was accepted', step; END IF;

  step := 'an adoption without its event is refused';
  refused := false;
  BEGIN
    INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
      VALUES (NULL, 'cau_life_a', h, '{}'::jsonb, 'birth', 'adopted');
  EXCEPTION WHEN not_null_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: an adoption without an event was accepted', step; END IF;

  step := 'UPDATE and DELETE of rolls and decisions raise';
  refused := false;
  BEGIN UPDATE rolls SET score = 4 WHERE source_event_id = 'cau-ev-r1';
  EXCEPTION WHEN check_violation THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: an UPDATE of rolls was accepted', step; END IF;
  refused := false;
  BEGIN DELETE FROM rolls WHERE source_event_id = 'cau-ev-r1';
  EXCEPTION WHEN check_violation THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a DELETE of rolls was accepted', step; END IF;
  refused := false;
  BEGIN UPDATE decisions SET kind = 'd20' WHERE source_event_id = 'cau-ev-d1';
  EXCEPTION WHEN check_violation THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: an UPDATE of decisions was accepted', step; END IF;
  refused := false;
  BEGIN DELETE FROM decisions WHERE source_event_id = 'cau-ev-d1';
  EXCEPTION WHEN check_violation THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a DELETE of decisions was accepted', step; END IF;

  step := 'every table of 0050 and 0051 has a comment that starts export: and contains retention:';
  FOREACH tbl IN ARRAY life_tbls LOOP
    IF NOT (obj_description(tbl::regclass, 'pg_class') LIKE 'export:%'
            AND obj_description(tbl::regclass, 'pg_class') LIKE '%retention:%') THEN
      RAISE EXCEPTION 'step %: % has no export and retention note', step, tbl;
    END IF;
  END LOOP;

  step := 'PUBLIC and the named roles have no table privilege on the new tables';
  FOREACH tbl IN ARRAY audit_tbls LOOP
    IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
               WHERE c.oid = tbl::regclass AND a.grantee = 0) THEN
      RAISE EXCEPTION 'step %: PUBLIC has a privilege on %', step, tbl;
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['geldar_mcp', 'geldar_glass', 'geldar_register', 'geldar_supervisor']) AS r,
                             unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p
               WHERE has_table_privilege(r, tbl, p)) THEN
      RAISE EXCEPTION 'step %: a named role has a privilege on %', step, tbl;
    END IF;
  END LOOP;

  step := 'sheet_erase_life is a definer function with pinned settings, executable by geldar_register only';
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                 WHERE p.oid = 'sheet_erase_life(text)'::regprocedure AND p.prosecdef
                   AND 'lock_timeout=2s' = ANY (p.proconfig)
                   AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')) THEN
    RAISE EXCEPTION 'step %: the settings of sheet_erase_life are not pinned', step;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
             WHERE p.oid = 'sheet_erase_life(text)'::regprocedure AND a.grantee = 0) THEN
    RAISE EXCEPTION 'step %: PUBLIC can execute sheet_erase_life', step;
  END IF;
  IF NOT has_function_privilege('geldar_register', 'sheet_erase_life(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'step %: geldar_register cannot execute sheet_erase_life', step;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['geldar_mcp', 'geldar_glass', 'geldar_supervisor']) AS r
             WHERE has_function_privilege(r, 'sheet_erase_life(text)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'step %: another named role can execute sheet_erase_life', step;
  END IF;

  step := 'sheet_erase_life refuses a NULL life';
  refused := false;
  BEGIN PERFORM sheet_erase_life(NULL::text);
  EXCEPTION WHEN null_value_not_allowed THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a NULL life was accepted', step; END IF;

  step := 'sheet_erase_life removes the rows of life a and nothing of life b';
  PERFORM sheet_erase_life('cau_life_a');
  FOREACH tbl IN ARRAY life_tbls LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE life_id = $1', tbl) INTO n USING 'cau_life_a';
    IF n <> 0 THEN RAISE EXCEPTION 'step %: % still has % rows for life a', step, tbl, n; END IF;
    EXECUTE format('SELECT count(*) FROM %I WHERE life_id = $1', tbl) INTO n USING 'cau_life_b';
    IF n <> 1 THEN RAISE EXCEPTION 'step %: % has % rows for life b, expected 1', step, tbl, n; END IF;
  END LOOP;

  step := 'the events of life a are kept as world history';
  SELECT count(*) INTO n FROM events WHERE source_event_id IN ('cau-ev-r1', 'cau-ev-d1', 'cau-ev-ad1');
  IF n <> 3 THEN RAISE EXCEPTION 'step %: % of 3 events remain', step, n; END IF;

  step := 'the append-only triggers are enabled again after the erase';
  SELECT count(*) INTO n FROM pg_trigger
    WHERE tgname IN ('rolls_append_only', 'decisions_append_only', 'xp_evidence_append_only') AND tgenabled = 'O';
  IF n <> 3 THEN RAISE EXCEPTION 'step %: % of 3 append-only triggers are enabled', step, n; END IF;

  step := 'a roll of life b is still refused after the erase';
  refused := false;
  BEGIN UPDATE rolls SET score = 4 WHERE source_event_id = 'cau-ev-r3';
  EXCEPTION WHEN check_violation THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a roll of life b was updated after the erase', step; END IF;

  step := 'a second erase of life a is a no-op';
  PERFORM sheet_erase_life('cau_life_a');
  SELECT count(*) INTO n FROM rolls WHERE life_id = 'cau_life_b';
  IF n <> 1 THEN RAISE EXCEPTION 'step %: life b has % rolls after the second erase', step, n; END IF;

  RAISE NOTICE 'check-schema-character-audit: all steps passed';
END
$character_audit$;
