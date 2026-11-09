-- Fails with RAISE EXCEPTION unless every table of spec Appendix D exists in
-- public and the pgvector extension is installed. CI runs it after the
-- migrations; a missing CREATE TABLE makes it fail.
DO $$
DECLARE
  expected TEXT[] := ARRAY[
    'agents', 'thoughts', 'intents', 'actions', 'receipts', 'suppressed_wakeups',
    'memories', 'relationships', 'goals', 'skills', 'skill_runs', 'skill_library',
    'books', 'ledger', 'proposals', 'votes', 'laws', 'events'
  ];
  missing TEXT[];
  ext_version TEXT;
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

  RAISE NOTICE 'schema check passed: % tables, pgvector %', array_length(expected, 1), ext_version;
END
$$;
