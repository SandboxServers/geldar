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

-- Migrations 0002 and 0003 (not in spec Appendix D): the sovereign MCP tables, the revocation
-- and player-ended triggers, the geldar_mcp role with its grants, and the migration ledger.
DO $mcp$
DECLARE
  mcp_expected TEXT[] := ARRAY[
    'schema_migrations', 'mcp_owners', 'mcp_players', 'mcp_tokens', 'mcp_budget', 'mcp_journal',
    'mcp_sleep_marks'
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
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mcp_players_ended') THEN
    RAISE EXCEPTION 'schema check: the mcp_players_ended trigger is missing';
  END IF;
  -- 0006: the owner cap is a trigger, so direct SQL cannot pass it.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mcp_players_owner_cap') THEN
    RAISE EXCEPTION 'schema check: the mcp_players_owner_cap trigger is missing';
  END IF;

  -- A password may have been set (ALTER ROLE ... LOGIN PASSWORD), so this checks privileges only.
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'geldar_mcp' AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
  ) THEN
    RAISE EXCEPTION 'schema check: role geldar_mcp is missing or is superuser, createdb or createrole';
  END IF;
  IF has_table_privilege('geldar_mcp', 'thoughts', 'SELECT')
     OR has_table_privilege('geldar_mcp', 'memories', 'SELECT') THEN
    RAISE EXCEPTION 'schema check: geldar_mcp can read thoughts or memories';
  END IF;
  IF has_table_privilege('geldar_mcp', 'agents', 'UPDATE')
     OR has_column_privilege('geldar_mcp', 'agents', 'last_sleep_day', 'SELECT') THEN
    RAISE EXCEPTION 'schema check: geldar_mcp can write agents or read last_sleep_day';
  END IF;
  -- 0004: the sleep mark is written in three columns only, so its key cannot be rewritten.
  IF has_table_privilege('geldar_mcp', 'mcp_sleep_marks', 'UPDATE')
     OR has_column_privilege('geldar_mcp', 'mcp_sleep_marks', 'life_id', 'UPDATE') THEN
    RAISE EXCEPTION 'schema check: geldar_mcp can UPDATE the life_id of mcp_sleep_marks';
  END IF;
  IF NOT (has_column_privilege('geldar_mcp', 'mcp_sleep_marks', 'last_sleep_day', 'UPDATE')
     AND has_column_privilege('geldar_mcp', 'mcp_sleep_marks', 'sleep_cursor', 'UPDATE')
     AND has_column_privilege('geldar_mcp', 'mcp_sleep_marks', 'updated_at', 'UPDATE')) THEN
    RAISE EXCEPTION 'schema check: geldar_mcp cannot UPDATE the three sleep mark columns';
  END IF;

  -- Every migration inserts its own row (sql/README.md). 0001 predates the ledger and is
  -- recorded by the runner and by 0002.
  SELECT array_agg(version ORDER BY version) INTO ledger FROM schema_migrations;
  IF ledger IS NULL OR NOT ledger @> ARRAY['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008'] THEN
    RAISE EXCEPTION 'schema check: schema_migrations must hold 0001 to 0008, found %', ledger;
  END IF;

  RAISE NOTICE 'schema check passed: % mcp tables, role geldar_mcp', array_length(mcp_expected, 1);
END
$mcp$;

-- Migration 0005 (wave 6 section 4 item 11): the read-only role geldar_glass. It reads exactly the
-- Glass tables and columns, writes nothing, holds no sequence and cannot read the MCP's tables.
-- Privileges only: a password may have been set by `migrate --set-role-password geldar_glass`.
DO $glass$
DECLARE
  glass_tables TEXT[] := ARRAY['thoughts', 'actions', 'receipts', 'intents', 'agents'];
  glass_table_grants TEXT[] := ARRAY['thoughts', 'actions', 'receipts', 'intents'];
  agents_columns TEXT[] := ARRAY['agent_id', 'name', 'life_seq', 'shard', 'mode', 'tier', 'born_day', 'died_at', 'death_cause'];
  events_columns TEXT[] := ARRAY['type', 'agent_id', 'world_day', 'world_tick', 'at', 'source_event_id'];
  t TEXT;
  rel RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'geldar_glass' AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
  ) THEN
    RAISE EXCEPTION 'schema check: role geldar_glass is missing or is superuser, createdb or createrole';
  END IF;

  FOREACH t IN ARRAY glass_tables LOOP
    IF t = ANY (glass_table_grants) AND NOT has_table_privilege('geldar_glass', t, 'SELECT') THEN
      RAISE EXCEPTION 'schema check: geldar_glass cannot SELECT %', t;
    END IF;
    IF has_table_privilege('geldar_glass', t, 'INSERT')
       OR has_table_privilege('geldar_glass', t, 'UPDATE')
       OR has_table_privilege('geldar_glass', t, 'DELETE')
       OR has_table_privilege('geldar_glass', t, 'TRUNCATE')
       OR has_table_privilege('geldar_glass', t, 'REFERENCES')
       OR has_table_privilege('geldar_glass', t, 'TRIGGER') THEN
      RAISE EXCEPTION 'schema check: geldar_glass can write %', t;
    END IF;
  END LOOP;

  -- Exactly the five tables: no SELECT on any other table in the public schema.
  FOR rel IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  LOOP
    IF rel.relname <> ALL (glass_tables)
       AND has_table_privilege('geldar_glass', rel.relname, 'SELECT') THEN
      RAISE EXCEPTION 'schema check: geldar_glass can read % (not a Glass table)', rel.relname;
    END IF;
  END LOOP;

  -- No sequence grant of any kind.
  FOR rel IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
  LOOP
    IF has_sequence_privilege('geldar_glass', rel.relname, 'USAGE')
       OR has_sequence_privilege('geldar_glass', rel.relname, 'SELECT')
       OR has_sequence_privilege('geldar_glass', rel.relname, 'UPDATE') THEN
      RAISE EXCEPTION 'schema check: geldar_glass has a privilege on sequence %', rel.relname;
    END IF;
  END LOOP;

  -- events: SELECT on exactly the six granted columns (raw world text in payload is not one of them),
  -- no table-level SELECT, no write of any kind.
  IF has_table_privilege('geldar_glass', 'events', 'SELECT') THEN
    RAISE EXCEPTION 'schema check: geldar_glass has table-level SELECT on events';
  END IF;
  IF has_table_privilege('geldar_glass', 'events', 'INSERT')
     OR has_table_privilege('geldar_glass', 'events', 'UPDATE')
     OR has_table_privilege('geldar_glass', 'events', 'DELETE') THEN
    RAISE EXCEPTION 'schema check: geldar_glass can write events';
  END IF;
  FOR rel IN
    SELECT a.attname FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'events' AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF rel.attname = ANY (events_columns) THEN
      IF NOT has_column_privilege('geldar_glass', 'events', rel.attname, 'SELECT') THEN
        RAISE EXCEPTION 'schema check: geldar_glass cannot SELECT events.%', rel.attname;
      END IF;
    ELSIF has_column_privilege('geldar_glass', 'events', rel.attname, 'SELECT') THEN
      RAISE EXCEPTION 'schema check: geldar_glass can read events.% (not granted)', rel.attname;
    END IF;
  END LOOP;

  -- agents: SELECT on exactly the nine Glass columns, never personality_seed; no table-level SELECT.
  IF has_table_privilege('geldar_glass', 'agents', 'SELECT') THEN
    RAISE EXCEPTION 'schema check: geldar_glass has table-level SELECT on agents';
  END IF;
  FOR rel IN
    SELECT a.attname FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'agents' AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF rel.attname = ANY (agents_columns) THEN
      IF NOT has_column_privilege('geldar_glass', 'agents', rel.attname, 'SELECT') THEN
        RAISE EXCEPTION 'schema check: geldar_glass cannot SELECT agents.%', rel.attname;
      END IF;
    ELSIF has_column_privilege('geldar_glass', 'agents', rel.attname, 'SELECT') THEN
      RAISE EXCEPTION 'schema check: geldar_glass can read agents.% (not granted)', rel.attname;
    END IF;
  END LOOP;

  IF has_schema_privilege('geldar_glass', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'schema check: geldar_glass can CREATE in schema public';
  END IF;

  RAISE NOTICE 'schema check passed: role geldar_glass reads its Glass tables and columns and writes none';
END
$glass$;

-- 0007: the audit tables are append-only. Each has an enabled BEFORE UPDATE OR DELETE row trigger on
-- the journal function (tgtype bits: row 1, before 2, insert 4, delete 8, update 16), with no INSERT
-- bit. geldar_mcp has no UPDATE, DELETE, TRUNCATE, TRIGGER or REFERENCES on mcp_journal. TRUNCATE is
-- not checked on the audit tables: it is allowed on a throwaway database.
DO $journal$
DECLARE
  audit_table text;
BEGIN
  FOREACH audit_table IN ARRAY ARRAY['receipts', 'thoughts', 'suppressed_wakeups', 'mcp_journal'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = audit_table::regclass
        AND tgname = audit_table || '_append_only'
        AND tgfoid = 'journal_append_only'::regproc
        AND (tgtype & 27) = 27
        AND (tgtype & 4) = 0
        AND tgenabled IN ('O', 'A')
    ) THEN
      RAISE EXCEPTION 'schema check: the append-only trigger on % is missing or wrong', audit_table;
    END IF;
  END LOOP;

  IF has_table_privilege('geldar_mcp', 'mcp_journal', 'UPDATE')
     OR has_table_privilege('geldar_mcp', 'mcp_journal', 'DELETE')
     OR has_table_privilege('geldar_mcp', 'mcp_journal', 'TRUNCATE')
     OR has_table_privilege('geldar_mcp', 'mcp_journal', 'TRIGGER')
     OR has_table_privilege('geldar_mcp', 'mcp_journal', 'REFERENCES') THEN
    RAISE EXCEPTION 'schema check: geldar_mcp can UPDATE, DELETE, TRUNCATE, TRIGGER or REFERENCES mcp_journal';
  END IF;

  RAISE NOTICE 'schema check passed: append-only triggers on 4 audit tables, geldar_mcp cannot change mcp_journal';
END
$journal$;

-- Migration 0008 (decision 0135): mcp_identities and the register role geldar_register. These run
-- as the role (SET LOCAL ROLE), so a missing or extra grant fails here. Every probe is inside a
-- sub-block that rolls back, so no row is left behind.
DO $register$
DECLARE
  hash BYTEA := decode(repeat('ab', 32), 'hex');
  step TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'geldar_register' AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
  ) THEN
    RAISE EXCEPTION 'schema check: role geldar_register is missing or is superuser, createdb or createrole';
  END IF;

  -- mcp_identities has no column for an email, a raw provider id or a token.
  IF (SELECT array_agg(column_name::text ORDER BY column_name) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'mcp_identities')
     IS DISTINCT FROM ARRAY['banned_at', 'created_at', 'identity_hash', 'owner_id', 'provider'] THEN
    RAISE EXCEPTION 'schema check: mcp_identities must have exactly its five columns';
  END IF;

  -- the register role cannot read thoughts or events
  step := 'cannot read thoughts';
  BEGIN
    SET LOCAL ROLE geldar_register;
    PERFORM 1 FROM thoughts LIMIT 1;
    RAISE EXCEPTION 'schema check: geldar_register can SELECT thoughts' USING ERRCODE = 'P0002';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  step := 'cannot read events';
  BEGIN
    SET LOCAL ROLE geldar_register;
    PERFORM 1 FROM events LIMIT 1;
    RAISE EXCEPTION 'schema check: geldar_register can SELECT events' USING ERRCODE = 'P0002';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF has_table_privilege('geldar_register', 'receipts', 'SELECT')
     OR has_table_privilege('geldar_register', 'mcp_journal', 'SELECT')
     OR has_table_privilege('geldar_register', 'mcp_journal', 'INSERT')
     OR has_column_privilege('geldar_register', 'agents', 'personality_seed', 'SELECT')
     OR has_column_privilege('geldar_register', 'mcp_tokens', 'token_hash', 'SELECT')
     OR has_table_privilege('geldar_register', 'mcp_tokens', 'DELETE')
     OR has_table_privilege('geldar_register', 'mcp_identities', 'DELETE') THEN
    RAISE EXCEPTION 'schema check: geldar_register has a grant it must not have';
  END IF;

  -- Player creation as the role: owner, identity, agents row, player, token and budget, then a
  -- revoke; token_hash cannot be updated, and the owner cap trigger fires on its inserts.
  step := 'create and revoke';
  BEGIN
    SET LOCAL ROLE geldar_register;
    INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES ('reg-test-owner', 'handle', 1);
    INSERT INTO mcp_identities (identity_hash, provider, owner_id) VALUES (hash, 'github', 'reg-test-owner');
    INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
                        declared_model, model_config, tier, personality_seed)
      VALUES ('reg_test_01', 'regtest', 1, 'reg_test_01', 'test', 'sovereign', 'reg-test-owner',
              'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed');
    INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status)
      VALUES ('ag-reg-test-01', 'reg-test-owner', 'reg_test_01', 'regtest', 'claude-code', 'active');
    INSERT INTO mcp_budget (life_id, credits, accrued_at) VALUES ('reg_test_01', 10, now());
    INSERT INTO mcp_tokens (token_id, player_id, token_hash, expires_at)
      VALUES ('reg-tok-1', 'ag-reg-test-01', decode(repeat('cd', 32), 'hex'), now() + interval '1 day');
    UPDATE mcp_tokens SET revoked_at = now() WHERE player_id = 'ag-reg-test-01' AND revoked_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'schema check: geldar_register could not revoke a token';
    END IF;

    -- cannot rewrite the token hash
    BEGIN
      UPDATE mcp_tokens SET token_hash = decode(repeat('ee', 32), 'hex') WHERE token_id = 'reg-tok-1';
      RAISE EXCEPTION 'schema check: geldar_register can UPDATE mcp_tokens.token_hash' USING ERRCODE = 'P0002';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- retire: only the status column of mcp_players is writable
    step := 'retire';
    BEGIN
      UPDATE mcp_players SET owner_id = 'reg-test-owner' WHERE player_id = 'ag-reg-test-01';
      RAISE EXCEPTION 'schema check: geldar_register can UPDATE mcp_players.owner_id' USING ERRCODE = 'P0002';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      UPDATE mcp_players SET life_id = 'reg_test_01' WHERE player_id = 'ag-reg-test-01';
      RAISE EXCEPTION 'schema check: geldar_register can UPDATE mcp_players.life_id' USING ERRCODE = 'P0002';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      UPDATE mcp_players SET player_id = 'ag-reg-test-99' WHERE player_id = 'ag-reg-test-01';
      RAISE EXCEPTION 'schema check: geldar_register can UPDATE mcp_players.player_id' USING ERRCODE = 'P0002';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    UPDATE mcp_players SET status = 'retired' WHERE player_id = 'ag-reg-test-01';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'schema check: geldar_register could not retire a player';
    END IF;

    -- the owner cap trigger (cap 1) refuses a second active player for this owner
    step := 'owner cap';
    INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
                        declared_model, model_config, tier, personality_seed)
      VALUES ('reg_test_02', 'regtest2', 1, 'reg_test_02', 'test', 'sovereign', 'reg-test-owner',
              'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed');
    BEGIN
      INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status)
        VALUES ('ag-reg-test-02', 'reg-test-owner', 'reg_test_02', 'regtest2', 'claude-code', 'active');
      INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status)
        VALUES ('ag-reg-test-03', 'reg-test-owner', 'reg_test_02', 'regtest3', 'claude-code', 'active');
      RAISE EXCEPTION 'schema check: the owner cap did not fire for geldar_register' USING ERRCODE = 'P0002';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;

  RAISE NOTICE 'schema check passed: role geldar_register and mcp_identities';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'schema check (register, %): %', step, SQLERRM;
END
$register$;