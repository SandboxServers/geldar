-- Migration 0020 (decision 0138): behaviour of glass_journal_page and glass_journal_after.
-- Run after sql/test/check-schema.sql, on the same migrated database. Every probe rolls back.
-- Agents: ag_gj_live (living sovereign, no opt-in), ag_gj_opt (living sovereign, opted in), ag_gj_dead (dead sovereign),
-- ag_gj_house (house agent). Each has one journal row 1 hour old and one 1 second old.
DO $glass_journal$
DECLARE
  step TEXT;
  cut TIMESTAMPTZ := now() - interval '1 minute';
  ids TEXT[];
BEGIN
  step := 'start';
  BEGIN
    INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES ('reg-gj', 'gj', 5);
    INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
                        declared_model, model_config, tier, personality_seed, thoughts_delayed_public, died_at, death_cause)
      VALUES ('ag_gj_live', 'gjlive', 1, 'ag_gj_live', 'test', 'sovereign', 'reg-gj', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE, NULL, NULL),
             ('ag_gj_opt', 'gjopt', 1, 'ag_gj_opt', 'test', 'sovereign', 'reg-gj', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', TRUE, NULL, NULL),
             ('ag_gj_dead', 'gjdead', 1, 'ag_gj_dead', 'test', 'sovereign', 'reg-gj', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE, now(), 'test'),
             ('ag_gj_house', 'gjhouse', 1, 'ag_gj_house', 'test', 'house', 'reg-gj', 'claude-code', 'self-reported', 'declared:unverified', 'house', 'seed', FALSE, NULL, NULL);
    INSERT INTO mcp_journal (life_id, at, text)
      SELECT a, t, a || ' ' || age
        FROM unnest(ARRAY['ag_gj_live', 'ag_gj_opt', 'ag_gj_dead', 'ag_gj_house']) a,
             (VALUES (now() - interval '1 hour', 'old'), (now() - interval '1 second', 'new')) v(t, age);

    step := 'grants';
    IF has_table_privilege('geldar_glass', 'mcp_journal', 'SELECT') OR has_any_column_privilege('geldar_glass', 'mcp_journal', 'SELECT') THEN
      RAISE EXCEPTION 'schema check: geldar_glass must hold no grant on mcp_journal';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.proname IN ('glass_journal_page', 'glass_journal_after')
                  AND (a.grantee = 0 OR a.grantee <> p.proowner AND a.grantee <> 'geldar_glass'::regrole)
                  AND a.privilege_type = 'EXECUTE')
       OR (SELECT count(*) FROM pg_proc p WHERE p.proname IN ('glass_journal_page', 'glass_journal_after') AND p.prosecdef) <> 2 THEN
      RAISE EXCEPTION 'schema check: the journal functions must be definer functions executable by geldar_glass only';
    END IF;
    SET LOCAL ROLE geldar_glass;
    BEGIN
      PERFORM 1 FROM mcp_journal LIMIT 1;
      RAISE EXCEPTION 'schema check: geldar_glass can read mcp_journal directly' USING ERRCODE = 'P0002';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- anonymous with the 60 second cut-off: house always (old only), living sovereign without opt-in never
    step := 'page: anonymous, delay';
    SELECT array_agg(journal_text ORDER BY journal_text) INTO ids
      FROM glass_journal_page(cut, ARRAY[]::TEXT[], FALSE, NULL, NULL, NULL, NULL, NULL, 100);
    IF ids IS DISTINCT FROM ARRAY['ag_gj_dead new', 'ag_gj_dead old', 'ag_gj_house old', 'ag_gj_opt old'] THEN
      RAISE EXCEPTION 'schema check: anonymous page with delay returned %', ids;
    END IF;
    -- no cut-off: the opted-in new row shows, the living one still does not
    step := 'page: anonymous, no delay';
    SELECT array_agg(journal_text ORDER BY journal_text) INTO ids
      FROM glass_journal_page(NULL, NULL, FALSE, NULL, NULL, NULL, NULL, NULL, 100);
    IF ids IS DISTINCT FROM ARRAY['ag_gj_dead new', 'ag_gj_dead old', 'ag_gj_house new', 'ag_gj_house old', 'ag_gj_opt new', 'ag_gj_opt old'] THEN
      RAISE EXCEPTION 'schema check: anonymous page without delay returned %', ids;
    END IF;
    -- the owner sees every row of the owned agents, live
    step := 'page: owner';
    SELECT array_agg(journal_text ORDER BY journal_text) INTO ids
      FROM glass_journal_page(cut, ARRAY['ag_gj_live'], FALSE, NULL, NULL, NULL, NULL, NULL, 100);
    IF NOT ids @> ARRAY['ag_gj_live new', 'ag_gj_live old'] OR ids @> ARRAY['ag_gj_opt new'] THEN
      RAISE EXCEPTION 'schema check: owner page returned %', ids;
    END IF;
    -- the operator flag shows the living one
    step := 'page: operator flag';
    IF NOT EXISTS (SELECT 1 FROM glass_journal_page(NULL, NULL, TRUE, 'ag_gj_live', NULL, NULL, NULL, NULL, 10)) THEN
      RAISE EXCEPTION 'schema check: show_living_sovereign must show the living sovereign journal';
    END IF;
    -- paging: newest first, a cursor goes strictly before, the limit holds
    step := 'page: cursor';
    SELECT array_agg(journal_text ORDER BY at DESC) INTO ids
      FROM glass_journal_page(NULL, NULL, FALSE, 'ag_gj_opt', NULL, NULL, NULL, NULL, 1);
    IF ids IS DISTINCT FROM ARRAY['ag_gj_opt new'] THEN RAISE EXCEPTION 'schema check: page limit/order returned %', ids; END IF;
    SELECT array_agg(g.journal_text) INTO ids
      FROM glass_journal_page(NULL, NULL, FALSE, 'ag_gj_opt', NULL, NULL,
             (SELECT p.at FROM glass_journal_page(NULL, NULL, FALSE, 'ag_gj_opt', NULL, NULL, NULL, NULL, 1) p),
             (SELECT p.thought_id FROM glass_journal_page(NULL, NULL, FALSE, 'ag_gj_opt', NULL, NULL, NULL, NULL, 1) p), 10) g;
    IF ids IS DISTINCT FROM ARRAY['ag_gj_opt old'] THEN RAISE EXCEPTION 'schema check: page cursor returned %', ids; END IF;

    -- the stream: the delay holds for every row, dead and owned included; the living one never shows
    step := 'after: delay';
    SELECT array_agg(journal_text ORDER BY journal_text) INTO ids
      FROM glass_journal_after(now() - interval '2 hours', '', cut, FALSE, 100);
    IF ids IS DISTINCT FROM ARRAY['ag_gj_dead old', 'ag_gj_house old', 'ag_gj_opt old'] THEN
      RAISE EXCEPTION 'schema check: stream after with delay returned %', ids;
    END IF;
    step := 'after: order';
    SELECT array_agg(journal_text ORDER BY at) INTO ids
      FROM glass_journal_after(now() - interval '2 hours', '', NULL, FALSE, 100) WHERE journal_text LIKE 'ag_gj_opt%';
    IF ids IS DISTINCT FROM ARRAY['ag_gj_opt old', 'ag_gj_opt new'] THEN RAISE EXCEPTION 'schema check: stream order returned %', ids; END IF;
    IF EXISTS (SELECT 1 FROM glass_journal_after(now() - interval '2 hours', '', NULL, FALSE, 100) WHERE journal_text LIKE 'ag_gj_live%') THEN
      RAISE EXCEPTION 'schema check: the stream showed a living sovereign journal without opt-in';
    END IF;
    RESET ROLE;
    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'PR001';
  EXCEPTION WHEN SQLSTATE 'PR001' THEN NULL;
  END;
  RAISE NOTICE 'schema check passed: the journal functions apply the decision 0138 rules';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'schema check (glass journal, %): %', step, SQLERRM;
END
$glass_journal$;
