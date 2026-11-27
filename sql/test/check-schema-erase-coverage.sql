-- S9-00 (decision 0323): every life-keyed public table is erased by sheet_erase_life or register_account_delete, or is on the exemption list below. Run after the migrations and the other check files.
-- Known limits: only the key columns life_id and agent_id are seen (other keys, such as proposals.proposer,
-- are invisible by design: decision 0040 keeps shared world objects); the match is a regex over the function
-- text, so a DELETE inside dynamic SQL, a string literal or a never-reached branch still counts.

-- The one matcher. True when body holds a live `DELETE FROM [public.]<tbl> WHERE <not false>`:
-- SQL comments are removed first, and a literal `WHERE false` does not count.
CREATE FUNCTION pg_temp.erase_covers(body TEXT, tbl TEXT) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $f$
  SELECT regexp_replace(body, '--[^\n]*', '', 'g')
         ~* ('DELETE\s+FROM\s+(public\.)?' || tbl || '\s+WHERE\s+(?!false\M)')
$f$;

-- The one gate. Returns the life-keyed tables that neither erase function deletes and that are not exempt.
-- exempt: agents is retired in place by register_account_delete (the row stays as world history);
-- kino_audit is keyed by the viewed life but register_account_delete erases it by the viewer's
-- login_hash, so the viewed life's own rows are not erased with that life (open owner question).
CREATE FUNCTION pg_temp.erase_gap() RETURNS TEXT[] LANGUAGE sql AS $f$
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
  SELECT array_agg(k.table_name ORDER BY k.table_name)
  FROM keyed k, bodies b
  WHERE k.table_name NOT IN (SELECT table_name FROM exempt)
    AND NOT pg_temp.erase_covers(b.body, k.table_name)
$f$;

DO $erase_cov$
DECLARE
  missing TEXT[];
  fn_count INT;
BEGIN
  SELECT count(*) INTO fn_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('sheet_erase_life', 'register_account_delete');
  IF fn_count < 2 THEN
    RAISE EXCEPTION 'erase coverage: an erase function is missing';
  END IF;

  missing := pg_temp.erase_gap();
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'erase coverage: no erase path for %', missing;
  END IF;

  -- probe: a new life-keyed table must be reported by the same gate
  CREATE TABLE public.erase_gate_probe (life_id TEXT);
  missing := pg_temp.erase_gap();
  DROP TABLE public.erase_gate_probe;
  IF missing IS NULL OR NOT ('erase_gate_probe' = ANY (missing)) THEN
    RAISE EXCEPTION 'erase coverage: the probe was not reported';
  END IF;

  -- matcher probes: prefix, longer name, comment, WHERE false
  IF NOT pg_temp.erase_covers('DELETE FROM public.rolls WHERE x', 'rolls')
     OR NOT pg_temp.erase_covers('DELETE FROM rolls WHERE x', 'rolls')
     OR pg_temp.erase_covers('DELETE FROM public.rolls_archive WHERE x', 'rolls')
     OR pg_temp.erase_covers(E'-- DELETE FROM public.rolls WHERE x\nSELECT 1', 'rolls')
     OR pg_temp.erase_covers('DELETE FROM public.rolls WHERE false', 'rolls')
     OR pg_temp.erase_covers('DELETE FROM public.rolls WHERE FALSE;', 'rolls')
     OR NOT pg_temp.erase_covers('DELETE FROM public.rolls WHERE falsehood = 1', 'rolls') THEN
    RAISE EXCEPTION 'erase coverage: the matcher is wrong';
  END IF;
END
$erase_cov$;

-- behaviour (OD-12, decision 0323): both erase paths remove a dead life's rows. Re-runnable: the fixtures
-- are removed first.
DO $erase_dead$
BEGIN
  DELETE FROM proficiency WHERE life_id IN ('ag_erasecov_01', 'ag_erasecov_02');
  DELETE FROM turn_records WHERE life_id IN ('ag_erasecov_01', 'ag_erasecov_02');
  DELETE FROM agents WHERE agent_id IN ('ag_erasecov_01', 'ag_erasecov_02');
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, harness, declared_model,
                      model_config, tier, died_at) VALUES
    ('ag_erasecov_01', 'erasecov', 1, 'ag_erasecov_01', 'main', 'headless', 'harness-x', 'self-reported',
     'declared:unverified', 'sovereign', now());
  INSERT INTO proficiency (life_id, domain, xp, level) VALUES ('ag_erasecov_01', 'mining', 5, 0);
  PERFORM sheet_erase_life('ag_erasecov_01');
  IF EXISTS (SELECT 1 FROM proficiency WHERE life_id = 'ag_erasecov_01') THEN
    RAISE EXCEPTION 'erase coverage: sheet_erase_life left a proficiency row of a dead life';
  END IF;
  DELETE FROM agents WHERE agent_id = 'ag_erasecov_01';
END
$erase_dead$;
