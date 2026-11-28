-- Migration 0057 (S12-04b): character_sheet_adoptions.source accepts 'conversion'. Run as a superuser
-- after every migration. The whole check runs in one sub-block that ends by raising a sentinel, so
-- every row it seeds is rolled back and nothing is kept.
-- Two facts are checked. A conversion or config row with its events row is stored. An audit row
-- whose source_event_id has no events row is refused by the foreign key (23503) while its source
-- passes the CHECK. A CHECK is evaluated before the foreign keys, so a bogus source is refused by
-- the CHECK (23514) whether or not its events row exists.
DO $check$
DECLARE
  step TEXT;
  stored INTEGER;
BEGIN
  BEGIN
    INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, harness, declared_model,
                        model_config, tier) VALUES
      ('ag_schema_check_01', 'schemachk1', 1, 'ag_schema_check_01', 'main', 'headless', 'harness-x',
       'self-reported', 'declared:unverified', 'sovereign'),
      ('ag_schema_check_02', 'schemachk2', 1, 'ag_schema_check_02', 'main', 'headless', 'harness-x',
       'self-reported', 'declared:unverified', 'sovereign');
    INSERT INTO events (source_event_id, at, world_tick, type, agent_id) VALUES
      ('schema-check-0057:conversion', now(), 1, 'sheet_adopted', 'ag_schema_check_01'),
      ('schema-check-0057:config', now(), 1, 'sheet_adopted', 'ag_schema_check_02');

    step := 'adopt sheets: a conversion row with its events row is stored';
    INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
    VALUES ('schema-check-0057:conversion', 'ag_schema_check_01', repeat('a', 64), '{}'::jsonb, 'conversion', 'adopted');
    SELECT count(*) INTO stored FROM character_sheet_adoptions
     WHERE source_event_id = 'schema-check-0057:conversion' AND source = 'conversion';
    IF stored <> 1 THEN
      RAISE EXCEPTION 'schema check (%): expected 1 stored conversion row, found %', step, stored;
    END IF;

    step := 'adopt sheets: a config row with its events row is stored (the CHECK still takes config)';
    INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
    VALUES ('schema-check-0057:config', 'ag_schema_check_02', repeat('a', 64), '{}'::jsonb, 'config', 'adopted');
    SELECT count(*) INTO stored FROM character_sheet_adoptions
     WHERE source_event_id = 'schema-check-0057:config' AND source = 'config';
    IF stored <> 1 THEN
      RAISE EXCEPTION 'schema check (%): expected 1 stored config row, found %', step, stored;
    END IF;

    step := 'adopt sheets: a conversion row with no events row is refused by the foreign key only';
    BEGIN
      INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
      VALUES ('schema-check-0057:no-event', 'ag_schema_check_01', repeat('a', 64), '{}'::jsonb, 'conversion', 'adopted');
      RAISE EXCEPTION 'schema check (%): a row without its events row must be refused', step;
    EXCEPTION
      WHEN foreign_key_violation THEN NULL;
      WHEN check_violation THEN
        RAISE EXCEPTION 'schema check (%): conversion must pass the source CHECK', step;
    END;

    step := 'adopt sheets: a source outside the four is refused by the CHECK';
    BEGIN
      INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
      VALUES ('schema-check-0057:bogus', 'ag_schema_check_01', repeat('a', 64), '{}'::jsonb, 'bogus', 'adopted');
      RAISE EXCEPTION 'schema check (%): bogus must be rejected', step;
    EXCEPTION
      WHEN check_violation THEN NULL;
    END;

    RAISE EXCEPTION 'schema-check-0057 rollback';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'schema-check-0057 rollback' THEN RAISE; END IF;
  END;
END
$check$;
