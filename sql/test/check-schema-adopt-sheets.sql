-- Migration 0057 (S12-04b): character_sheet_adoptions.source accepts 'conversion'. Run as a superuser
-- after every migration. Nothing is kept: each probe is an INSERT that must fail, and a CHECK is
-- evaluated before the foreign keys, so the SQLSTATE tells which constraint refused the row.
-- An insert with no events row for its source_event_id fails the foreign key (23503) when the CHECK
-- accepts the source, and fails the CHECK (23514) when it does not.
DO $check$
DECLARE
  step TEXT;
BEGIN
  step := 'adopt sheets: conversion is accepted by the source CHECK';
  BEGIN
    INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
    VALUES ('schema-check-0057:conversion', 'ag_schema_check_01', repeat('a', 64), '{}'::jsonb, 'conversion', 'adopted');
    RAISE EXCEPTION 'schema check (%): an orphan row must not be stored', step;
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
    WHEN check_violation THEN
      RAISE EXCEPTION 'schema check (%): conversion must pass the source CHECK', step;
  END;

  step := 'adopt sheets: an audit row without its events row is refused';
  BEGIN
    INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
    VALUES ('schema-check-0057:orphan', 'ag_schema_check_01', repeat('a', 64), '{}'::jsonb, 'conversion', 'adopted');
    RAISE EXCEPTION 'schema check (%): an audit row without its events row must be refused', step;
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  step := 'adopt sheets: a value outside the four is rejected by the source CHECK';
  BEGIN
    INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
    VALUES ('schema-check-0057:bogus', 'ag_schema_check_01', repeat('a', 64), '{}'::jsonb, 'bogus', 'adopted');
    RAISE EXCEPTION 'schema check (%): bogus must be rejected', step;
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  step := 'adopt sheets: an existing config row still passes the source CHECK';
  BEGIN
    INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
    VALUES ('schema-check-0057:config', 'ag_schema_check_01', repeat('a', 64), '{}'::jsonb, 'config', 'adopted');
    RAISE EXCEPTION 'schema check (%): an orphan row must not be stored', step;
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
    WHEN check_violation THEN
      RAISE EXCEPTION 'schema check (%): config must still pass the source CHECK', step;
  END;
END
$check$;
