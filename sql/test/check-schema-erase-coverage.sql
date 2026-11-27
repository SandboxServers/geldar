-- S9-00 (decision 0323): every life-keyed public table is erased by sheet_erase_life or register_account_delete, or is on the exemption list below. Run after the migrations and the other check files.
DO $erase_cov$
DECLARE
  missing TEXT[];
  probe TEXT[];
  fn_count INT;
  pat TEXT;
BEGIN
  -- exemption list: agents is retired in place by register_account_delete (the row stays as world
  -- history); kino_audit is erased by the viewer's login_hash, not by the viewed life (open owner question).
  SELECT count(*) INTO fn_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('sheet_erase_life', 'register_account_delete');
  IF fn_count < 2 THEN
    RAISE EXCEPTION 'erase coverage: an erase function is missing';
  END IF;

  WITH keyed AS (
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name IN ('life_id', 'agent_id')
      AND c.table_name NOT LIKE 'check\_%' ESCAPE '\'
  ), bodies AS (
    SELECT string_agg(pg_get_functiondef(p.oid), E'\n') AS body
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('sheet_erase_life', 'register_account_delete')
  ), exempt(table_name) AS (
    VALUES ('agents'), ('kino_audit')
  )
  SELECT array_agg(k.table_name ORDER BY k.table_name) INTO missing
  FROM keyed k, bodies b
  WHERE k.table_name NOT IN (SELECT table_name FROM exempt)
    AND b.body !~* ('DELETE\s+FROM\s+(public\.)?' || k.table_name || '\M');
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'erase coverage: no erase path for %', missing;
  END IF;

  -- probe: a new life-keyed table must be reported
  CREATE TABLE public.erase_gate_probe (life_id TEXT);
  WITH keyed AS (
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name IN ('life_id', 'agent_id')
      AND c.table_name NOT LIKE 'check\_%' ESCAPE '\'
  ), bodies AS (
    SELECT string_agg(pg_get_functiondef(p.oid), E'\n') AS body
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('sheet_erase_life', 'register_account_delete')
  ), exempt(table_name) AS (
    VALUES ('agents'), ('kino_audit')
  )
  SELECT array_agg(k.table_name ORDER BY k.table_name) INTO probe
  FROM keyed k, bodies b
  WHERE k.table_name NOT IN (SELECT table_name FROM exempt)
    AND b.body !~* ('DELETE\s+FROM\s+(public\.)?' || k.table_name || '\M');
  DROP TABLE public.erase_gate_probe;
  IF probe IS NULL OR NOT ('erase_gate_probe' = ANY (probe)) THEN
    RAISE EXCEPTION 'erase coverage: the probe was not reported';
  END IF;

  -- prefix probe: the pattern accepts the public. prefix and rejects a longer table name
  pat := 'DELETE\s+FROM\s+(public\.)?' || 'rolls' || '\M';
  IF NOT ('DELETE FROM public.rolls WHERE' ~* pat) OR NOT ('DELETE FROM rolls WHERE' ~* pat)
     OR ('DELETE FROM public.rolls_archive WHERE' ~* pat) THEN
    RAISE EXCEPTION 'erase coverage: the table-name pattern is wrong';
  END IF;
END
$erase_cov$;

-- behaviour (OD-12, decision 0323): the erase removes the sheet rows of a dead life.
DO $erase_dead$
BEGIN
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, harness, declared_model,
                      model_config, tier, died_at) VALUES
    ('ag_erasecov_01', 'erasecov', 1, 'ag_erasecov_01', 'main', 'headless', 'harness-x', 'self-reported',
     'declared:unverified', 'sovereign', now());
  INSERT INTO proficiency (life_id, domain, xp, level) VALUES ('ag_erasecov_01', 'mining', 5, 0);
  PERFORM sheet_erase_life('ag_erasecov_01');
  IF EXISTS (SELECT 1 FROM proficiency WHERE life_id = 'ag_erasecov_01') THEN
    RAISE EXCEPTION 'erase coverage: sheet_erase_life left a proficiency row of a dead life';
  END IF;
END
$erase_dead$;
