-- Fails with RAISE EXCEPTION unless every table of spec Appendix D exists in
-- public, the pgvector extension is installed, and the changes that differ
-- from Appendix D are in place. The receipts and actions.state rules are
-- checked by behaviour: probe rows are inserted and always rolled back, so the
-- check leaves no rows behind. Catalog checks cover the rest: receipts.detail
-- and actions.snapshot_revision exist, schema archive exists, and books and
-- skill_library have the composite foreign keys to skills (skill_id, edition).
-- CI runs it after the migrations; a missing CREATE TABLE or a reverted
-- change makes it fail.
--
-- Runs each statement list, then rolls it back. Returns 'accepted' when every
-- statement succeeds, 'rejected' when one fails.
CREATE FUNCTION pg_temp.receipt_probe(statements TEXT[]) RETURNS TEXT
LANGUAGE plpgsql AS $probe$
DECLARE
  statement TEXT;
BEGIN
  BEGIN
    FOREACH statement IN ARRAY statements LOOP
      EXECUTE statement;
    END LOOP;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'probe rollback';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN RETURN 'accepted';
    WHEN OTHERS THEN RETURN 'rejected';
  END;
END
$probe$;
DO $$
DECLARE
  expected TEXT[] := ARRAY[
    'agents', 'thoughts', 'intents', 'actions', 'receipts', 'suppressed_wakeups',
    'memories', 'relationships', 'goals', 'skills', 'skill_runs', 'skill_library',
    'books', 'ledger', 'proposals', 'votes', 'laws', 'events'
  ];
  missing TEXT[];
  ext_version TEXT;
  probe TEXT;
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

  -- Behavioural receipts checks. The actions probe is a control: a valid row
  -- must be accepted, or the other probes prove nothing.
  probe := pg_temp.receipt_probe(ARRAY[
    'INSERT INTO actions (action_id, state) VALUES (''probe-action'', ''accepted'')'
  ]);
  IF probe <> 'accepted' THEN
    problems := array_append(problems, 'actions.state must accept accepted (control probe: ' || probe || ')');
  END IF;

  probe := pg_temp.receipt_probe(ARRAY[
    'INSERT INTO actions (action_id, state) VALUES (''probe-action'', ''bogus'')'
  ]);
  IF probe <> 'rejected' THEN
    problems := array_append(problems, 'actions.state needs a CHECK limited to the contract action states (probe: ' || probe || ')');
  END IF;

  -- One final receipt per action: prepared then committed is the normal path.
  probe := pg_temp.receipt_probe(ARRAY[
    'INSERT INTO receipts (receipt_id, action_id, phase) VALUES (''probe-1'', ''probe-action'', ''prepared'')',
    'INSERT INTO receipts (receipt_id, action_id, phase) VALUES (''probe-2'', ''probe-action'', ''committed'')'
  ]);
  IF probe <> 'accepted' THEN
    problems := array_append(problems, 'receipts must accept a prepared then a committed row for one action (probe: ' || probe || ')');
  END IF;

  probe := pg_temp.receipt_probe(ARRAY[
    'INSERT INTO receipts (receipt_id, action_id, phase) VALUES (''probe-1'', ''probe-action'', ''committed'')',
    'INSERT INTO receipts (receipt_id, action_id, phase) VALUES (''probe-2'', ''probe-action'', ''aborted'')'
  ]);
  IF probe <> 'rejected' THEN
    problems := array_append(problems, 'receipts must reject a committed and an aborted row for one action (probe: ' || probe || ')');
  END IF;

  probe := pg_temp.receipt_probe(ARRAY[
    'INSERT INTO receipts (receipt_id, action_id, phase) VALUES (''probe-1'', ''probe-action'', ''committed'')',
    'INSERT INTO receipts (receipt_id, action_id, phase) VALUES (''probe-2'', ''probe-action'', ''committed'')'
  ]);
  IF probe <> 'rejected' THEN
    problems := array_append(problems, 'receipts must reject two committed rows for one action (probe: ' || probe || ')');
  END IF;

  probe := pg_temp.receipt_probe(ARRAY[
    'INSERT INTO receipts (receipt_id, action_id, phase) VALUES (''probe-1'', ''probe-action'', ''prepared'')',
    'INSERT INTO receipts (receipt_id, action_id, phase) VALUES (''probe-2'', ''probe-action'', ''prepared'')'
  ]);
  IF probe <> 'rejected' THEN
    problems := array_append(problems, 'receipts must reject two prepared rows for one action (probe: ' || probe || ')');
  END IF;

  probe := pg_temp.receipt_probe(ARRAY[
    'INSERT INTO receipts (receipt_id, action_id, phase) VALUES (''probe-1'', ''probe-action'', ''bogus'')'
  ]);
  IF probe <> 'rejected' THEN
    problems := array_append(problems, 'receipts.phase needs a CHECK limited to prepared, committed and aborted (probe: ' || probe || ')');
  END IF;

  probe := pg_temp.receipt_probe(ARRAY[
    'INSERT INTO receipts (receipt_id, action_id, phase) VALUES (''probe-1'', NULL, ''committed'')'
  ]);
  IF probe <> 'rejected' THEN
    problems := array_append(problems, 'receipts.action_id must be NOT NULL (probe: ' || probe || ')');
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

-- Migration 0002 (not in spec Appendix D): the sovereign MCP tables, the revocation
-- trigger, the geldar_mcp role with its grants, and the migration ledger.
DO $mcp$
DECLARE
  mcp_expected TEXT[] := ARRAY[
    'schema_migrations', 'mcp_owners', 'mcp_players', 'mcp_tokens', 'mcp_budget', 'mcp_journal'
  ];
  missing TEXT[];
  ledger TEXT[];
BEGIN
  SELECT array_agg(t.name ORDER BY t.name) INTO missing
  FROM unnest(mcp_expected) AS t(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = t.name
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'schema check: missing mcp tables in public: %', missing;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mcp_tokens_revoked') THEN
    RAISE EXCEPTION 'schema check: the mcp_tokens_revoked trigger is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geldar_mcp' AND NOT rolcanlogin) THEN
    RAISE EXCEPTION 'schema check: role geldar_mcp is missing or can log in';
  END IF;
  IF has_table_privilege('geldar_mcp', 'thoughts', 'SELECT')
     OR has_table_privilege('geldar_mcp', 'memories', 'SELECT') THEN
    RAISE EXCEPTION 'schema check: geldar_mcp can read thoughts or memories';
  END IF;

  SELECT array_agg(version ORDER BY version) INTO ledger FROM schema_migrations
  WHERE version IN ('0001', '0002');
  IF ledger IS DISTINCT FROM ARRAY['0001', '0002'] THEN
    RAISE EXCEPTION 'schema check: schema_migrations must hold 0001 and 0002, found %', ledger;
  END IF;

  RAISE NOTICE 'schema check passed: % mcp tables, role geldar_mcp', array_length(mcp_expected, 1);
END
$mcp$;
