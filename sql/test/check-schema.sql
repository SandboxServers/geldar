-- Fails with RAISE EXCEPTION unless every table of spec Appendix D exists in
-- public, the pgvector extension is installed, and the changes that differ
-- from Appendix D are in place: receipts has a unique key over exactly
-- (action_id, phase) and none over action_id alone, receipts.detail and
-- actions.snapshot_revision exist, schema archive exists, and books and
-- skill_library have the composite foreign keys to skills (skill_id, edition).
-- CI runs it after the migrations; a missing CREATE TABLE or a reverted
-- change makes it fail.
DO $$
DECLARE
  expected TEXT[] := ARRAY[
    'agents', 'thoughts', 'intents', 'actions', 'receipts', 'suppressed_wakeups',
    'memories', 'relationships', 'goals', 'skills', 'skill_runs', 'skill_library',
    'books', 'ledger', 'proposals', 'votes', 'laws', 'events'
  ];
  missing TEXT[];
  ext_version TEXT;
  unique_sets TEXT[];
  fk_sets TEXT[];
  problems TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT array_agg(t.name ORDER BY t.name) INTO missing
  FROM unnest(expected) AS t(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = t.name
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'schema check: missing tables in public: %', missing;
  END IF;

  SELECT extversion INTO ext_version FROM pg_extension WHERE extname = 'vector';
  IF ext_version IS NULL THEN
    RAISE EXCEPTION 'schema check: the pgvector extension (vector) is not installed';
  END IF;

  -- Each unique index or constraint on receipts, as a sorted comma list of
  -- its column names (covers UNIQUE constraints and CREATE UNIQUE INDEX).
  unique_sets := ARRAY(
    SELECT string_agg(a.attname, ',' ORDER BY a.attname)
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
    WHERE n.nspname = 'public' AND t.relname = 'receipts' AND i.indisunique
    GROUP BY i.indexrelid
  );
  IF NOT ('action_id,phase' = ANY(unique_sets)) THEN
    problems := array_append(problems, 'receipts needs a unique key over (action_id, phase)');
  END IF;
  IF 'action_id' = ANY(unique_sets) THEN
    problems := array_append(problems, 'receipts must not have a unique key over action_id alone');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'receipts' AND column_name = 'detail'
  ) THEN
    problems := array_append(problems, 'receipts.detail is missing');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'actions' AND column_name = 'snapshot_revision'
  ) THEN
    problems := array_append(problems, 'actions.snapshot_revision is missing');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'archive') THEN
    problems := array_append(problems, 'schema archive is missing');
  END IF;

  -- Each foreign key onto skills, as "table:sorted,column,list" of the
  -- referencing columns.
  fk_sets := ARRAY(
    SELECT t.relname || ':' || string_agg(a.attname, ',' ORDER BY a.attname)
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_class ft ON ft.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE n.nspname = 'public' AND c.contype = 'f' AND ft.relname = 'skills'
    GROUP BY c.oid, t.relname
  );
  IF NOT ('books:edition,skill_id' = ANY(fk_sets)) THEN
    problems := array_append(problems, 'books needs the composite foreign key (skill_id, edition) to skills');
  END IF;
  IF NOT ('skill_library:edition,skill_id' = ANY(fk_sets)) THEN
    problems := array_append(problems, 'skill_library needs the composite foreign key (skill_id, edition) to skills');
  END IF;

  IF array_length(problems, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'schema check: %', array_to_string(problems, '; ');
  END IF;

  RAISE NOTICE 'schema check passed: % tables, pgvector %', array_length(expected, 1), ext_version;
END
$$;
