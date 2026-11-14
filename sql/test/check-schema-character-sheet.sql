-- Migration 0050 (AN-04a): behaviour of the adopted sheet, proficiency, XP evidence and the outbox.
-- Run after the migrations. Fixtures are written by the superuser with unique ids (lives cs_life_a, cs_life_b).
DO $character_sheet$
DECLARE
  step TEXT;
  refused BOOLEAN;
  n INT;
  h TEXT := repeat('a1', 32);
  h2 TEXT := repeat('b2', 32);
  valid JSONB := '{"version": 1,
    "attributes": {"curiosity": 3, "common_sense": 3, "cleverness": 3, "aggression": 3},
    "alignment": {"law": 3, "good": 3},
    "op_modes": {"explorer": 3, "farmer": 3, "miner": 3, "builder": 3, "crafter": 3, "warrior": 3, "nitwit": 3}}'::jsonb;
  alt JSONB;
  bads JSONB[];
BEGIN
  step := 'fixture: lives cs_life_a and cs_life_b with no adopted sheet';
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, harness, declared_model,
                      model_config, tier) VALUES
    ('cs_life_a', 'csa', 1, 'cs_life_a', 'main', 'headless', 'harness-x', 'self-reported',
     'declared:unverified', 'sovereign'),
    ('cs_life_b', 'csb', 1, 'cs_life_b', 'main', 'headless', 'harness-x', 'self-reported',
     'declared:unverified', 'sovereign');

  step := 'a valid sheet and hash adopt';
  UPDATE agents SET character_sheet = valid, sheet_hash = h, sheet_adopted_at = now()
    WHERE agent_id = 'cs_life_a' AND character_sheet IS NULL;
  IF (SELECT character_sheet FROM agents WHERE agent_id = 'cs_life_a') IS DISTINCT FROM valid THEN
    RAISE EXCEPTION 'step %: the valid sheet was not adopted', step;
  END IF;

  step := 'an UPDATE that sets the same sheet, hash and time is allowed';
  UPDATE agents SET character_sheet = valid, sheet_hash = h,
    sheet_adopted_at = (SELECT sheet_adopted_at FROM agents WHERE agent_id = 'cs_life_a')
    WHERE agent_id = 'cs_life_a';

  step := 'a second adoption with a different sheet raises';
  alt := jsonb_set(valid, '{attributes,curiosity}', '4');
  refused := false;
  BEGIN
    UPDATE agents SET character_sheet = alt WHERE agent_id = 'cs_life_a';
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a different sheet replaced the baseline', step; END IF;

  step := 'a second adoption with a different hash raises';
  refused := false;
  BEGIN
    UPDATE agents SET sheet_hash = h2 WHERE agent_id = 'cs_life_a';
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a different hash replaced the baseline', step; END IF;

  step := 'a sheet with no hash is refused (the shape constraint)';
  refused := false;
  BEGIN
    UPDATE agents SET character_sheet = valid, sheet_hash = NULL, sheet_adopted_at = now()
      WHERE agent_id = 'cs_life_b';
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a sheet without a hash was adopted', step; END IF;

  step := 'malformed sheets are refused: score 6, 3.5, "3", a missing group, an extra key, a proficiency key, version 2';
  bads := ARRAY[
    jsonb_set(valid, '{attributes,curiosity}', '6'),
    jsonb_set(valid, '{attributes,curiosity}', '3.5'),
    jsonb_set(valid, '{attributes,curiosity}', '"3"'),
    valid - 'op_modes',
    jsonb_set(valid, '{alignment,chaos}', '3'),
    valid || '{"proficiency": {"mining": 3}}',
    jsonb_set(valid, '{version}', '2')];
  FOR i IN 1..array_length(bads, 1) LOOP
    refused := false;
    BEGIN
      UPDATE agents SET character_sheet = bads[i], sheet_hash = h, sheet_adopted_at = now()
        WHERE agent_id = 'cs_life_b';
    EXCEPTION WHEN check_violation THEN refused := true;
    END;
    IF NOT refused THEN RAISE EXCEPTION 'step %: malformed sheet number % was adopted', step, i; END IF;
  END LOOP;

  step := 'a NULL baseline is adopted later, once';
  UPDATE agents SET character_sheet = valid, sheet_hash = h, sheet_adopted_at = now()
    WHERE agent_id = 'cs_life_b' AND character_sheet IS NULL;
  IF (SELECT character_sheet FROM agents WHERE agent_id = 'cs_life_b') IS DISTINCT FROM valid THEN
    RAISE EXCEPTION 'step %: the later adoption did not set the baseline', step;
  END IF;
  refused := false;
  BEGIN
    UPDATE agents SET sheet_adopted_at = now() + interval '1 second' WHERE agent_id = 'cs_life_b';
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: the adopted time changed after adoption', step; END IF;

  step := 'proficiency: a first row, xp cannot decrease, level cannot decrease, a rise is allowed';
  INSERT INTO proficiency (life_id, domain, xp, level) VALUES ('cs_life_a', 'mining', 5, 0);
  refused := false;
  BEGIN
    UPDATE proficiency SET xp = 4 WHERE life_id = 'cs_life_a' AND domain = 'mining';
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: proficiency.xp decreased', step; END IF;
  UPDATE proficiency SET xp = 6, level = 1 WHERE life_id = 'cs_life_a' AND domain = 'mining';
  refused := false;
  BEGIN
    UPDATE proficiency SET level = 0 WHERE life_id = 'cs_life_a' AND domain = 'mining';
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: proficiency.level decreased', step; END IF;

  step := 'xp evidence: a duplicate (life, domain, key) conflicts';
  INSERT INTO xp_evidence (life_id, domain, evidence_key, source_event_id, world_tick)
    VALUES ('cs_life_a', 'mining', 'ev-1', 'src-1', 10);
  refused := false;
  BEGIN
    INSERT INTO xp_evidence (life_id, domain, evidence_key, source_event_id, world_tick)
      VALUES ('cs_life_a', 'mining', 'ev-1', 'src-2', 11);
  EXCEPTION WHEN unique_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a duplicate evidence key was stored', step; END IF;

  step := 'xp evidence: UPDATE and DELETE raise';
  refused := false;
  BEGIN
    UPDATE xp_evidence SET world_tick = 12 WHERE evidence_key = 'ev-1';
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: xp_evidence was updated', step; END IF;
  refused := false;
  BEGIN
    DELETE FROM xp_evidence WHERE evidence_key = 'ev-1';
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: xp_evidence was deleted', step; END IF;

  step := 'outbox: a second row for the same (life, domain, level) conflicts';
  INSERT INTO proficiency_outbox (life_id, domain, level, xp, version)
    VALUES ('cs_life_a', 'mining', 1, 6, 1);
  refused := false;
  BEGIN
    INSERT INTO proficiency_outbox (life_id, domain, level, xp, version)
      VALUES ('cs_life_a', 'mining', 1, 7, 2);
  EXCEPTION WHEN unique_violation THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'step %: a duplicate outbox level was stored', step; END IF;

  step := 'the five named roles and PUBLIC have no privilege on the new tables';
  SELECT count(*) INTO n
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relname IN ('proficiency', 'xp_evidence', 'proficiency_outbox')
      AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles
            WHERE rolname IN ('geldar_mcp', 'geldar_glass', 'geldar_register', 'geldar_supervisor')));
  IF n <> 0 THEN RAISE EXCEPTION 'step %: % grant(s) to PUBLIC or a named role on a new table', step, n; END IF;

  step := 'the five named roles and PUBLIC have no privilege on the new agents columns';
  SELECT count(*) INTO n
    FROM unnest(ARRAY['geldar_mcp', 'geldar_glass', 'geldar_register', 'geldar_supervisor']) AS r,
         unnest(ARRAY['character_sheet', 'sheet_hash', 'sheet_adopted_at']) AS col
    WHERE has_column_privilege(r, 'agents', col, 'SELECT')
       OR has_column_privilege(r, 'agents', col, 'UPDATE');
  IF n <> 0 THEN RAISE EXCEPTION 'step %: % named role privilege(s) on the sheet columns', step, n; END IF;
  SELECT count(*) INTO n
    FROM pg_attribute at CROSS JOIN LATERAL aclexplode(at.attacl) a
    WHERE at.attrelid = 'agents'::regclass
      AND at.attname IN ('character_sheet', 'sheet_hash', 'sheet_adopted_at')
      AND a.grantee = 0;
  IF n <> 0 THEN RAISE EXCEPTION 'step %: % PUBLIC grant(s) on the sheet columns', step, n; END IF;

  step := 'the migration ledger row 0050 exists';
  SELECT count(*) INTO n FROM schema_migrations WHERE version = '0050';
  IF n <> 1 THEN RAISE EXCEPTION 'step %: schema_migrations has % rows for 0050', step, n; END IF;
END
$character_sheet$;
