-- Migration 0051 (AN-04b): behaviour of the roll, decision and xp evidence guard (sheet_append_only), the adoption
-- log, the keys, the comment map, the privileges and sheet_erase_life. Run after the migrations. Fixtures are
-- written by the superuser with unique ids (lives cau_life_a and cau_life_b, events cau-ev-*).
-- Mutant: a DELETE without its life_id filter (rolls, say) removes life b's row, so the life b count step fails.
-- Mutant: no set_config in sheet_erase_life leaves rolls refusing the erase DELETE, so the erase step fails.
-- Mutant: a guard that lets any DELETE through while the setting is set fails the life b DELETE step.
-- Mutant: a comment check without IS NULL passes a NULL comment, so the comment step fails on a NULL.
DO $character_audit$
DECLARE
  step TEXT;
  refused BOOLEAN;
  n INT;
  tbl TEXT;
  who TEXT;
  p TEXT;
  cmt TEXT;
  h TEXT := repeat('c3', 32);
  life_tbls TEXT[] := ARRAY['rolls', 'decisions', 'character_sheet_adoptions', 'xp_evidence', 'proficiency', 'proficiency_outbox'];
  named_roles TEXT[] := ARRAY['geldar_mcp', 'geldar_glass', 'geldar_register', 'geldar_supervisor'];
  table_privs TEXT[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
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
    EXECUTE format('SELECT count(*) FROM public.%I WHERE life_id = $1', tbl) INTO n USING 'cau_life_a';
    IF n < 1 THEN RAISE EXCEPTION 'step %: % has no row for life a', step, tbl; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE life_id = $1', tbl) INTO n USING 'cau_life_b';
    IF n <> 1 THEN RAISE EXCEPTION 'step %: % has % rows for life b, expected 1', step, tbl, n; END IF;
  END LOOP;

  step := 'the events and harness model columns of events and agents still exist';
  SELECT count(*) INTO n FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (('events', 'harness'), ('agents', 'harness'),
                                        ('agents', 'declared_model'), ('agents', 'model_config'));
  IF n <> 4 THEN RAISE EXCEPTION 'step %: % of 4 harness and model columns exist', step, n; END IF;

  step := 'a roll without its event is refused';
  refused := false;
  BEGIN
    INSERT INTO rolls (source_event_id, life_id, world_tick, decision_id, draw_index, engine_version, producer, fx,
                       score, dc, mode, dice, kept, bonus, total, success)
      VALUES ('cau-ev-missing', 'cau_life_a', 10, 'cau-dec-x', 0, 1, 'body', 'mine', 3, 12, 'flat', '{7}', 7, 0, 7, false);
  EXCEPTION WHEN foreign_key_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a roll was accepted without its event', step; END IF;

  step := 'a roll, a decision and an adoption without their events are refused';
  refused := false;
  BEGIN
    INSERT INTO decisions (source_event_id, life_id, world_tick, decision_id, engine_version, producer, fx, kind)
      VALUES ('cau-ev-missing', 'cau_life_a', 10, 'cau-dec-m', 1, 'body', 'mine', 'd20');
  EXCEPTION WHEN foreign_key_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a decision was accepted without its event', step; END IF;
  refused := false;
  BEGIN
    INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
      VALUES ('cau-ev-missing', 'cau_life_a', h, '{}'::jsonb, 'birth', 'adopted');
  EXCEPTION WHEN foreign_key_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: an adoption was accepted without its event', step; END IF;

  step := 'a row of each of the three tables with an unknown life is refused';
  refused := false;
  BEGIN
    INSERT INTO rolls (source_event_id, life_id, world_tick, decision_id, draw_index, engine_version, producer, fx,
                       score, dc, mode, dice, kept, bonus, total, success)
      VALUES ('cau-ev-r1b', 'cau_no_such_life', 10, 'cau-dec-y', 0, 1, 'body', 'mine', 3, 12, 'flat', '{7}', 7, 0, 7, false);
  EXCEPTION WHEN foreign_key_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a roll of an unknown life was accepted', step; END IF;
  refused := false;
  BEGIN
    INSERT INTO decisions (source_event_id, life_id, world_tick, decision_id, engine_version, producer, fx, kind)
      VALUES ('cau-ev-r1b', 'cau_no_such_life', 10, 'cau-dec-y', 1, 'body', 'mine', 'd20');
  EXCEPTION WHEN foreign_key_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a decision of an unknown life was accepted', step; END IF;
  refused := false;
  BEGIN
    INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
      VALUES ('cau-ev-r1b', 'cau_no_such_life', h, '{}'::jsonb, 'birth', 'adopted');
  EXCEPTION WHEN foreign_key_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: an adoption of an unknown life was accepted', step; END IF;

  step := 'a second roll with the same life, decision and draw index conflicts';
  refused := false;
  BEGIN
    INSERT INTO rolls (source_event_id, life_id, world_tick, decision_id, draw_index, engine_version, producer, fx,
                       score, dc, mode, dice, kept, bonus, total, success)
      VALUES ('cau-ev-r1b', 'cau_life_a', 10, 'cau-dec-a', 0, 1, 'body', 'mine', 3, 12, 'flat', '{7}', 7, 0, 7, false);
  EXCEPTION WHEN unique_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a duplicate roll was accepted', step; END IF;

  step := 'a second decision with the same life and decision id conflicts';
  refused := false;
  BEGIN
    INSERT INTO decisions (source_event_id, life_id, world_tick, decision_id, engine_version, producer, fx, kind)
      VALUES ('cau-ev-r1b', 'cau_life_a', 10, 'cau-dec-a', 1, 'body', 'mine', 'd20');
  EXCEPTION WHEN unique_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a duplicate decision was accepted', step; END IF;

  step := 'a second adoption of the same event conflicts';
  refused := false;
  BEGIN
    INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
      VALUES ('cau-ev-ad1', 'cau_life_a', h, '{}'::jsonb, 'birth', 'adopted');
  EXCEPTION WHEN unique_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a second adoption of one event was accepted', step; END IF;

  step := 'a decision of kind x is refused';
  refused := false;
  BEGIN
    INSERT INTO decisions (source_event_id, life_id, world_tick, decision_id, engine_version, producer, fx, kind)
      VALUES ('cau-ev-r1b', 'cau_life_a', 10, 'cau-dec-z', 1, 'body', 'mine', 'x');
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: kind x was accepted', step; END IF;

  step := 'a roll with proficiency 4, draw index -1, mode x, producer x, score 0 or no dice is refused';
  refused := false;
  BEGIN
    INSERT INTO rolls (source_event_id, life_id, world_tick, decision_id, draw_index, engine_version, producer, fx,
                       score, dc, mode, dice, kept, bonus, total, success, proficiency)
      VALUES ('cau-ev-r1b', 'cau_life_a', 10, 'cau-dec-y', 0, 1, 'body', 'mine', 3, 12, 'flat', '{7}', 7, 0, 7, false, 4);
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: proficiency 4 was accepted', step; END IF;
  refused := false;
  BEGIN
    INSERT INTO rolls (source_event_id, life_id, world_tick, decision_id, draw_index, engine_version, producer, fx,
                       score, dc, mode, dice, kept, bonus, total, success)
      VALUES ('cau-ev-r1b', 'cau_life_a', 10, 'cau-dec-y', -1, 1, 'body', 'mine', 3, 12, 'flat', '{7}', 7, 0, 7, false);
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: draw index -1 was accepted', step; END IF;
  refused := false;
  BEGIN
    INSERT INTO rolls (source_event_id, life_id, world_tick, decision_id, draw_index, engine_version, producer, fx,
                       score, dc, mode, dice, kept, bonus, total, success)
      VALUES ('cau-ev-r1b', 'cau_life_a', 10, 'cau-dec-y', 0, 1, 'body', 'mine', 3, 12, 'x', '{7}', 7, 0, 7, false);
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: mode x was accepted', step; END IF;
  refused := false;
  BEGIN
    INSERT INTO rolls (source_event_id, life_id, world_tick, decision_id, draw_index, engine_version, producer, fx,
                       score, dc, mode, dice, kept, bonus, total, success)
      VALUES ('cau-ev-r1b', 'cau_life_a', 10, 'cau-dec-y', 0, 1, 'x', 'mine', 3, 12, 'flat', '{7}', 7, 0, 7, false);
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: producer x was accepted', step; END IF;
  refused := false;
  BEGIN
    INSERT INTO rolls (source_event_id, life_id, world_tick, decision_id, draw_index, engine_version, producer, fx,
                       score, dc, mode, dice, kept, bonus, total, success)
      VALUES ('cau-ev-r1b', 'cau_life_a', 10, 'cau-dec-y', 0, 1, 'body', 'mine', 0, 12, 'flat', '{7}', 7, 0, 7, false);
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: score 0 was accepted', step; END IF;
  refused := false;
  BEGIN
    INSERT INTO rolls (source_event_id, life_id, world_tick, decision_id, draw_index, engine_version, producer, fx,
                       score, dc, mode, dice, kept, bonus, total, success)
      VALUES ('cau-ev-r1b', 'cau_life_a', 10, 'cau-dec-y', 0, 1, 'body', 'mine', 3, 12, 'flat', '{}', 7, 0, 7, false);
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: an empty dice array was accepted', step; END IF;

  step := 'an adoption with a bad sheet hash, source or result is refused';
  refused := false;
  BEGIN
    INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
      VALUES ('cau-ev-r1b', 'cau_life_a', 'xyz', '{}'::jsonb, 'birth', 'adopted');
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a bad sheet hash was accepted', step; END IF;
  refused := false;
  BEGIN
    INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
      VALUES ('cau-ev-r1b', 'cau_life_a', h, '{}'::jsonb, 'x', 'adopted');
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: source x was accepted', step; END IF;
  refused := false;
  BEGIN
    INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
      VALUES ('cau-ev-r1b', 'cau_life_a', h, '{}'::jsonb, 'birth', 'x');
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: result x was accepted', step; END IF;

  step := 'an adoption without an event is refused';
  refused := false;
  BEGIN
    INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
      VALUES (NULL, 'cau_life_a', h, '{}'::jsonb, 'birth', 'adopted');
  EXCEPTION WHEN not_null_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: an adoption without an event was accepted', step; END IF;

  step := 'UPDATE and DELETE of rolls, decisions and xp_evidence raise with the guard unset';
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
  refused := false;
  BEGIN UPDATE xp_evidence SET world_tick = 11 WHERE evidence_key = 'cau-k1';
  EXCEPTION WHEN check_violation THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: an UPDATE of xp_evidence was accepted', step; END IF;
  refused := false;
  BEGIN DELETE FROM xp_evidence WHERE evidence_key = 'cau-k1';
  EXCEPTION WHEN check_violation THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a DELETE of xp_evidence was accepted', step; END IF;

  step := 'the guard triggers exist, one per table for UPDATE or DELETE and one for TRUNCATE, all enabled';
  SELECT count(*) INTO n FROM pg_trigger t
    WHERE t.tgname IN ('rolls_append_only', 'rolls_append_only_truncate', 'decisions_append_only',
                       'decisions_append_only_truncate', 'xp_evidence_append_only', 'xp_evidence_append_only_truncate')
      AND t.tgenabled = 'O';
  IF n <> 6 THEN RAISE EXCEPTION 'step %: % of 6 guard triggers are enabled', step, n; END IF;

  step := 'TRUNCATE of rolls raises with the guard unset';
  refused := false;
  BEGIN TRUNCATE rolls;
  EXCEPTION WHEN check_violation THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: TRUNCATE of rolls was accepted', step; END IF;

  step := 'every life-keyed table has a comment that starts export: and contains retention:';
  FOREACH tbl IN ARRAY life_tbls LOOP
    cmt := obj_description(format('public.%I', tbl)::regclass, 'pg_class');
    IF cmt IS NULL OR cmt NOT LIKE 'export:%' OR cmt NOT LIKE '%retention:%' THEN
      RAISE EXCEPTION 'step %: % has no export and retention note', step, tbl;
    END IF;
  END LOOP;
  cmt := obj_description('public.proficiency_outbox'::regclass, 'pg_class');
  IF cmt IS NULL OR cmt NOT LIKE '%sheet_erase_life%' THEN
    RAISE EXCEPTION 'step %: the proficiency_outbox comment does not name sheet_erase_life', step;
  END IF;
  cmt := obj_description('sheet_erase_life(text)'::regprocedure, 'pg_proc');
  IF cmt IS NULL OR cmt NOT LIKE '%alive%' OR cmt NOT LIKE '%0171%' THEN
    RAISE EXCEPTION 'step %: the comment of sheet_erase_life states no contract', step;
  END IF;

  step := 'PUBLIC and the named roles have no privilege on the six life-keyed tables';
  FOREACH tbl IN ARRAY life_tbls LOOP
    IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
               WHERE c.oid = format('public.%I', tbl)::regclass AND a.grantee = 0) THEN
      RAISE EXCEPTION 'step %: PUBLIC has a privilege on %', step, tbl;
    END IF;
    FOREACH who IN ARRAY named_roles LOOP
      IF has_any_column_privilege(who, format('public.%I', tbl), 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'step %: % has a column privilege on %', step, who, tbl;
      END IF;
      FOREACH p IN ARRAY table_privs LOOP
        IF has_table_privilege(who, format('public.%I', tbl), p) THEN
          RAISE EXCEPTION 'step %: % has % on %', step, who, p, tbl;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  step := 'sheet_erase_life and sheet_append_only pin search_path, and sheet_erase_life pins lock_timeout';
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                 WHERE p.oid = 'sheet_erase_life(text)'::regprocedure AND p.prosecdef
                   AND 'lock_timeout=2s' = ANY (p.proconfig)
                   AND 'search_path=pg_catalog, public, pg_temp' = ANY (p.proconfig)) THEN
    RAISE EXCEPTION 'step %: the settings of sheet_erase_life are not pinned', step;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                 WHERE p.oid = 'sheet_append_only()'::regprocedure
                   AND 'search_path=pg_catalog, public, pg_temp' = ANY (p.proconfig)) THEN
    RAISE EXCEPTION 'step %: the search_path of sheet_append_only is not pinned', step;
  END IF;

  step := 'sheet_erase_life is executable by geldar_register only';
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

  step := 'geldar_register erases life a through the function and nothing of life b';
  SET LOCAL ROLE geldar_register;
  PERFORM sheet_erase_life('cau_life_a');
  RESET ROLE;
  FOREACH tbl IN ARRAY life_tbls LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE life_id = $1', tbl) INTO n USING 'cau_life_a';
    IF n <> 0 THEN RAISE EXCEPTION 'step %: % still has % rows for life a', step, tbl, n; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE life_id = $1', tbl) INTO n USING 'cau_life_b';
    IF n <> 1 THEN RAISE EXCEPTION 'step %: % has % rows for life b, expected 1', step, tbl, n; END IF;
  END LOOP;

  step := 'the events of life a are kept as world history';
  SELECT count(*) INTO n FROM events WHERE source_event_id IN ('cau-ev-r1', 'cau-ev-d1', 'cau-ev-ad1');
  IF n <> 3 THEN RAISE EXCEPTION 'step %: % of 3 events remain', step, n; END IF;

  step := 'the guard setting is reset after the erase';
  IF coalesce(current_setting('geldar.erase_life', true), '') <> '' THEN
    RAISE EXCEPTION 'step %: the guard setting is still set', step;
  END IF;

  step := 'the guard still refuses a DELETE of life b while the setting names life a';
  PERFORM set_config('geldar.erase_life', 'cau_life_a', true);
  refused := false;
  BEGIN DELETE FROM rolls WHERE source_event_id = 'cau-ev-r3';
  EXCEPTION WHEN check_violation THEN refused := true; END;
  PERFORM set_config('geldar.erase_life', '', true);
  IF NOT refused THEN RAISE EXCEPTION 'step %: a DELETE of life b passed the guard for life a', step; END IF;

  step := 'a roll of life b is still refused after the erase';
  refused := false;
  BEGIN UPDATE rolls SET score = 4 WHERE source_event_id = 'cau-ev-r3';
  EXCEPTION WHEN check_violation THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a roll of life b was updated after the erase', step; END IF;
  refused := false;
  BEGIN TRUNCATE rolls;
  EXCEPTION WHEN check_violation THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: TRUNCATE of rolls was accepted after the erase', step; END IF;

  step := 'a second erase of life a is a no-op';
  PERFORM sheet_erase_life('cau_life_a');
  SELECT count(*) INTO n FROM rolls WHERE life_id = 'cau_life_b';
  IF n <> 1 THEN RAISE EXCEPTION 'step %: life b has % rolls after the second erase', step, n; END IF;

  RAISE NOTICE 'check-schema-character-audit: all steps passed';
END
$character_audit$;
