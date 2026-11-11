-- Migrations 0014 to 0017 (decisions 0075, 0135, 0138; Kino review fix A): behaviour of the Kino definer functions.
-- Run after sql/test/check-schema.sql, on the same migrated database. Every probe rolls back.
--   kino_viewer, kino_agent_scope (0017): geldar_glass reads who may watch whom through them, and holds no
--     grant on mcp_identities or agents.owner.
--   glass_owner_agents (0016): a banned or unknown identity owns nothing.
--   register_set_thoughts_delayed_public (0016): owner only, 10 second limit, banned refused.
--   kino_audit_record, kino_audit_purge (0015): the CHECKs, the 30-day guard and the purge boundary.
DO $kino_functions$
DECLARE
  step TEXT;
  n BIGINT;
  cutoff TIMESTAMPTZ;
  r RECORD;
  bad TEXT;
  a_hash CONSTANT BYTEA := decode(repeat('d1', 32), 'hex');
  b_hash CONSTANT BYTEA := decode(repeat('d2', 32), 'hex');
  c_hash CONSTANT BYTEA := decode(repeat('d3', 32), 'hex');
  admin_hash CONSTANT BYTEA := decode(repeat('d4', 32), 'hex');
  pane CONSTANT TEXT := 'pn_' || repeat('0', 26);
BEGIN
  step := 'start';
  BEGIN
    -- owners A (owns ag_kf_a), B (owns nothing), C (banned, owns ag_kf_c), and a Kino admin hash
    INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES ('reg-kf-a', 'a', 3), ('reg-kf-b', 'b', 3), ('reg-kf-c', 'c', 3);
    INSERT INTO mcp_identities (identity_hash, provider, owner_id, banned_at) VALUES
      (a_hash, 'microsoft', 'reg-kf-a', NULL),
      (b_hash, 'microsoft', 'reg-kf-b', NULL),
      (c_hash, 'microsoft', 'reg-kf-c', now());
    INSERT INTO kino_admins (identity_hash) VALUES (admin_hash);
    INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
                        declared_model, model_config, tier, personality_seed, public_camera)
      VALUES ('ag_kf_a', 'kfa', 1, 'ag_kf_a', 'test', 'sovereign', 'reg-kf-a', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', TRUE),
             ('ag_kf_c', 'kfc', 1, 'ag_kf_c', 'test', 'sovereign', 'reg-kf-c', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE);
    INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status) VALUES
      ('ag-kf-a-01', 'reg-kf-a', 'ag_kf_a', 'kfa', 'claude-code', 'active'),
      ('ag-kf-c-01', 'reg-kf-c', 'ag_kf_c', 'kfc', 'claude-code', 'active');

    -- 0017: Glass has no direct read of the identity or owner columns, and reads them through the functions
    step := '0017: no direct grants';
    IF has_any_column_privilege('geldar_glass', 'mcp_identities', 'SELECT')
       OR has_column_privilege('geldar_glass', 'agents', 'owner', 'SELECT')
       OR has_table_privilege('geldar_glass', 'kino_audit', 'SELECT')
       OR has_table_privilege('geldar_glass', 'kino_audit', 'INSERT') THEN
      RAISE EXCEPTION 'schema check: geldar_glass must hold no grant on mcp_identities, agents.owner or kino_audit';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.proname IN ('kino_viewer', 'kino_agent_scope', 'kino_agent_list', 'glass_owner_agents', 'kino_audit_record', 'kino_audit_purge')
                  AND (a.grantee = 0 OR a.grantee <> p.proowner AND a.grantee <> 'geldar_glass'::regrole)
                  AND a.privilege_type = 'EXECUTE')
       OR (SELECT count(*) FROM pg_proc p WHERE p.proname IN ('kino_viewer', 'kino_agent_scope', 'kino_agent_list', 'glass_owner_agents', 'kino_audit_record', 'kino_audit_purge') AND p.prosecdef) <> 6 THEN
      RAISE EXCEPTION 'schema check: the Kino functions must be definer functions executable by geldar_glass only';
    END IF;
    SET LOCAL ROLE geldar_glass;
    BEGIN
      PERFORM owner_id FROM mcp_identities LIMIT 1;
      RAISE EXCEPTION 'schema check: geldar_glass can read mcp_identities directly' USING ERRCODE = 'P0002';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM owner FROM agents LIMIT 1;
      RAISE EXCEPTION 'schema check: geldar_glass can read agents.owner directly' USING ERRCODE = 'P0002';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    step := '0017: kino_viewer';
    SELECT * INTO r FROM kino_viewer(a_hash);
    IF r.owner_id IS DISTINCT FROM 'reg-kf-a' OR r.banned OR r.admin THEN RAISE EXCEPTION 'schema check: kino_viewer owner A: %', r; END IF;
    SELECT * INTO r FROM kino_viewer(c_hash);
    IF r.owner_id IS DISTINCT FROM 'reg-kf-c' OR NOT r.banned OR r.admin THEN RAISE EXCEPTION 'schema check: kino_viewer banned owner: %', r; END IF;
    SELECT * INTO r FROM kino_viewer(admin_hash);
    IF r.owner_id IS NOT NULL OR r.banned OR NOT r.admin THEN RAISE EXCEPTION 'schema check: kino_viewer admin: %', r; END IF;
    SELECT * INTO r FROM kino_viewer(decode(repeat('ff', 32), 'hex'));
    IF r.owner_id IS NOT NULL OR r.banned OR r.admin THEN RAISE EXCEPTION 'schema check: kino_viewer unknown identity: %', r; END IF;

    step := '0017: kino_agent_scope';
    SELECT * INTO r FROM kino_agent_scope('ag_kf_a');
    IF r.owner IS DISTINCT FROM 'reg-kf-a' OR r.public_camera IS NOT TRUE THEN RAISE EXCEPTION 'schema check: kino_agent_scope ag_kf_a: %', r; END IF;
    IF EXISTS (SELECT 1 FROM kino_agent_scope('ag_kf_missing')) THEN RAISE EXCEPTION 'schema check: kino_agent_scope answered for an unknown agent'; END IF;
    FOREACH bad IN ARRAY ARRAY[NULL, '', '  ']::TEXT[] LOOP
      BEGIN
        PERFORM * FROM kino_agent_scope(bad);
        RAISE EXCEPTION 'schema check: kino_agent_scope accepted %', coalesce(bad, 'NULL') USING ERRCODE = 'P0002';
      EXCEPTION WHEN null_value_not_allowed THEN NULL;
      END;
    END LOOP;
    step := '0018: kino_agent_list';
    IF (SELECT count(*) FROM kino_agent_list() WHERE agent_id IN ('ag_kf_a', 'ag_kf_c')) <> 2 THEN
      RAISE EXCEPTION 'schema check: kino_agent_list must list every agent';
    END IF;

    step := '0016: glass_owner_agents';
    IF (SELECT array_agg(x) FROM glass_owner_agents(a_hash) x) IS DISTINCT FROM ARRAY['ag_kf_a'] THEN
      RAISE EXCEPTION 'schema check: glass_owner_agents must list the agents of the owner';
    END IF;
    IF EXISTS (SELECT 1 FROM glass_owner_agents(b_hash)) THEN RAISE EXCEPTION 'schema check: glass_owner_agents listed agents for a non-owner'; END IF;
    IF EXISTS (SELECT 1 FROM glass_owner_agents(c_hash)) THEN RAISE EXCEPTION 'schema check: glass_owner_agents listed agents of a banned owner'; END IF;
    IF EXISTS (SELECT 1 FROM glass_owner_agents(decode(repeat('ff', 32), 'hex'))) THEN RAISE EXCEPTION 'schema check: glass_owner_agents listed agents for an unknown identity'; END IF;

    -- 0015: the audit write is validated by the table CHECKs; Glass cannot write the table directly
    step := '0015: kino_audit_record';
    PERFORM kino_audit_record('pane_opened', repeat('a', 64), 'ag_kf_a', pane, 'follow', now(), NULL);
    BEGIN
      INSERT INTO kino_audit (event, login_hash, agent_id, pane_id, mode, at) VALUES ('pane_opened', repeat('a', 64), 'ag_kf_a', pane, 'follow', now());
      RAISE EXCEPTION 'schema check: geldar_glass can INSERT into kino_audit directly' USING ERRCODE = 'P0002';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM kino_audit_record('pane_nonsense', repeat('a', 64), 'ag_kf_a', pane, 'follow', now(), NULL);
      RAISE EXCEPTION 'schema check: kino_audit_record took an unknown event' USING ERRCODE = 'P0002';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
      PERFORM kino_audit_record('pane_opened', 'not-a-hash', 'ag_kf_a', pane, 'follow', now(), NULL);
      RAISE EXCEPTION 'schema check: kino_audit_record took a bad login hash' USING ERRCODE = 'P0002';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
      PERFORM kino_audit_record('pane_opened', repeat('a', 64), 'ag_kf_a', pane, 'follow', now(), now());
      RAISE EXCEPTION 'schema check: kino_audit_record took stopped_at on a non-close event' USING ERRCODE = 'P0002';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
      PERFORM kino_audit_record('pane_opened', repeat('a', 64), 'ag_kf_a', pane, 'spin', now(), NULL);
      RAISE EXCEPTION 'schema check: kino_audit_record took an unknown mode' USING ERRCODE = 'P0002';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- 0015: the purge guard and boundary. A row exactly at the cutoff stays; one microsecond before goes.
    step := '0015: kino_audit_purge';
    BEGIN
      PERFORM kino_audit_purge(now() - interval '29 days');
      RAISE EXCEPTION 'schema check: kino_audit_purge took a cutoff newer than 30 days' USING ERRCODE = 'P0002';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
    BEGIN
      PERFORM kino_audit_purge(NULL);
      RAISE EXCEPTION 'schema check: kino_audit_purge took a NULL cutoff' USING ERRCODE = 'P0002';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
    RESET ROLE;
    cutoff := now() - interval '90 days';
    INSERT INTO kino_audit (event, login_hash, agent_id, pane_id, mode, at) VALUES
      ('pane_opened', repeat('b', 64), 'ag_kf_a', 'pn_' || repeat('0', 25) || '1', 'follow', cutoff),
      ('pane_opened', repeat('b', 64), 'ag_kf_a', 'pn_' || repeat('0', 25) || '2', 'follow', cutoff - interval '1 microsecond');
    SET LOCAL ROLE geldar_glass;
    n := kino_audit_purge(cutoff);
    RESET ROLE;
    IF n <> 1 THEN RAISE EXCEPTION 'schema check: the purge must delete exactly the row before the cutoff, deleted %', n; END IF;
    IF NOT EXISTS (SELECT 1 FROM kino_audit WHERE pane_id = 'pn_' || repeat('0', 25) || '1')
       OR EXISTS (SELECT 1 FROM kino_audit WHERE pane_id = 'pn_' || repeat('0', 25) || '2')
       OR NOT EXISTS (SELECT 1 FROM kino_audit WHERE pane_id = pane) THEN
      RAISE EXCEPTION 'schema check: the purge boundary is wrong (at the cutoff stays, before it goes, recent rows stay)';
    END IF;

    -- 0016: the thought opt-in: owner only, 10 second limit, banned refused
    step := '0016: register_set_thoughts_delayed_public';
    SET LOCAL ROLE geldar_register;
    IF register_set_thoughts_delayed_public(b_hash, 'ag-kf-a-01', TRUE) THEN RAISE EXCEPTION 'schema check: a non-owner switched thoughts_delayed_public'; END IF;
    IF register_set_thoughts_delayed_public(a_hash, 'ag-kf-missing', TRUE) THEN RAISE EXCEPTION 'schema check: an unknown player was switched'; END IF;
    IF NOT register_set_thoughts_delayed_public(a_hash, 'ag-kf-a-01', TRUE) THEN RAISE EXCEPTION 'schema check: the owner could not switch thoughts_delayed_public'; END IF;
    BEGIN
      PERFORM register_set_thoughts_delayed_public(a_hash, 'ag-kf-a-01', FALSE);
      RAISE EXCEPTION 'schema check: a second change at once was accepted' USING ERRCODE = 'P0002';
    EXCEPTION WHEN program_limit_exceeded THEN NULL;
    END;
    RESET ROLE;
    IF NOT (SELECT thoughts_delayed_public FROM agents WHERE agent_id = 'ag_kf_a') THEN
      RAISE EXCEPTION 'schema check: a refused change altered thoughts_delayed_public';
    END IF;
    -- at 9.9 seconds the limit still holds; at exactly 10 seconds it is open
    UPDATE agents SET thoughts_flag_changed_at = now() - interval '9.9 seconds' WHERE agent_id = 'ag_kf_a';
    SET LOCAL ROLE geldar_register;
    BEGIN
      PERFORM register_set_thoughts_delayed_public(a_hash, 'ag-kf-a-01', FALSE);
      RAISE EXCEPTION 'schema check: a change at 9.9 seconds was accepted' USING ERRCODE = 'P0002';
    EXCEPTION WHEN program_limit_exceeded THEN NULL;
    END;
    RESET ROLE;
    UPDATE agents SET thoughts_flag_changed_at = now() - interval '10 seconds' WHERE agent_id = 'ag_kf_a';
    SET LOCAL ROLE geldar_register;
    IF NOT register_set_thoughts_delayed_public(a_hash, 'ag-kf-a-01', FALSE) THEN RAISE EXCEPTION 'schema check: a change at 10 seconds was refused'; END IF;
    BEGIN
      PERFORM register_set_thoughts_delayed_public(c_hash, 'ag-kf-c-01', TRUE);
      RAISE EXCEPTION 'schema check: a banned identity switched thoughts_delayed_public' USING ERRCODE = 'P0002';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
    IF (SELECT thoughts_delayed_public FROM agents WHERE agent_id = 'ag_kf_c') THEN
      RAISE EXCEPTION 'schema check: a banned identity changed thoughts_delayed_public';
    END IF;
    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'PR001';
  EXCEPTION WHEN SQLSTATE 'PR001' THEN NULL;
  END;
  RAISE NOTICE 'schema check passed: Kino definer functions answer for the named identity and refuse the rest';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'schema check (kino functions, %): %', step, SQLERRM;
END
$kino_functions$;
