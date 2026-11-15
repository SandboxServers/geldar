-- Migration 0062 (C7-09b): register_owner_export behaviour. Run after check-schema.sql and the migrations through 0062,
-- on a fresh database (the fixtures are not cleaned up). Fixtures are written by the superuser; the export is called
-- as the superuser (the privilege checks use the ACL and the role name). Owners: ownerq-a (the one exported; its lives
-- are ag_pa_live, ag_pa_dead, ag_pa_agonly (agents.owner only) and ag_pa_plonly (players only)); ownerq-b (a second
-- owner, whose rows and cross rows that name a's lives may appear in a's export only as counts); ownerq-cap (20001
-- thoughts and journal rows: the row cap); ownerq-exact (exactly 20000 of each: not truncated); ownerq-big (20001
-- thoughts with 6000 characters of parsed each: the byte budget). An identity banned with no owner link (orphan) must
-- return NULL.

DO $owner_export$
DECLARE
  step TEXT;
  hash_a BYTEA := decode(repeat('b1', 32), 'hex');
  hash_b BYTEA := decode(repeat('b2', 32), 'hex');
  hash_cap BYTEA := decode(repeat('b3', 32), 'hex');
  hash_unknown BYTEA := decode(repeat('b4', 32), 'hex');
  hash_orphan BYTEA := decode(repeat('b5', 32), 'hex');
  hash_near BYTEA := decode(repeat('b1', 31) || 'b2', 'hex');
  hash_exact BYTEA := decode(repeat('b6', 32), 'hex');
  hash_big BYTEA := decode(repeat('b7', 32), 'hex');
  actor_a TEXT := left(encode(sha256(convert_to('ownerq-a', 'UTF8')), 'hex'), 16);
  thought_keys TEXT[] := ARRAY['thought_id', 'life_id', 'at', 'world_day', 'world_tick', 'wake_reason', 'parsed',
    'prompt_template_version', 'schema_version', 'mind_version', 'body_version', 'model_config', 'thinker_id', 'effort',
    'tokens_in_estimated', 'tokens_out_estimated', 'latency_ms', 'credits_reserved', 'credits_settled'];
  journal_keys TEXT[] := ARRAY['id', 'life_id', 'at', 'text'];
  live_expected JSONB := '{"life_id": "ag_pa_live", "events": 3, "memories": 1, "goals": 1, "intents": 1, "actions": 1,
    "skill_runs": 1, "skill_library": 1, "relationships": 2, "ledger": 1, "votes": 1, "receipts": 1,
    "suppressed_wakeups": 1, "mcp_sleep_marks": 1, "mcp_budget": 1, "mcp_life_deaths": 0, "mcp_death_events": 0,
    "rolls": 1, "decisions": 1, "xp_evidence": 1, "character_sheet_adoptions": 1, "proficiency": 1,
    "proficiency_outbox": 1}';
  dead_expected JSONB := '{"life_id": "ag_pa_dead", "events": 1, "memories": 0, "goals": 0, "intents": 0, "actions": 0,
    "skill_runs": 0, "skill_library": 0, "relationships": 0, "ledger": 0, "votes": 0, "receipts": 0,
    "suppressed_wakeups": 0, "mcp_sleep_marks": 0, "mcp_budget": 0, "mcp_life_deaths": 1, "mcp_death_events": 1,
    "rolls": 0, "decisions": 0, "xp_evidence": 0, "character_sheet_adoptions": 0, "proficiency": 0,
    "proficiency_outbox": 0}';
  j JSONB;
  jb JSONB;
  jcap JSONB;
  jexact JSONB;
  jbig JSONB;
  cnt JSONB;
  txt TEXT;
  txt_b TEXT;
  jfirst BIGINT;
  audit_before BIGINT;
  audit_after BIGINT;
  n INT;
BEGIN
  step := 'fixture: owners, identities, agents, players, tokens, roster, body ops, consents, records';
  INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES
    ('ownerq-a', 'Owner A display', 5), ('ownerq-b', 'Owner B display', 5), ('ownerq-cap', 'Owner cap display', 5),
    ('ownerq-exact', 'Owner exact display', 5), ('ownerq-big', 'Owner big display', 5);
  INSERT INTO mcp_identities (identity_hash, provider, owner_id, banned_at) VALUES
    (hash_a, 'github', 'ownerq-a', NULL),
    (hash_b, 'github', 'ownerq-b', NULL),
    (hash_cap, 'discord', 'ownerq-cap', NULL),
    (hash_exact, 'discord', 'ownerq-exact', NULL),
    (hash_big, 'github', 'ownerq-big', NULL),
    (hash_orphan, 'discord', NULL, now());
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness, declared_model,
                      model_config, tier, personality_seed, died_at, death_cause)
    VALUES ('ag_pa_live', 'palive', 1, 'ag_pa_live', 'test', 'sovereign', 'ownerq-a', 'claude-code', 'self-reported',
            'declared:unverified', 'sovereign', 'seed', NULL, NULL),
           ('ag_pa_dead', 'padead', 2, 'ag_pa_dead', 'test', 'sovereign', 'ownerq-a', 'claude-code', 'self-reported',
            'declared:unverified', 'sovereign', 'seed', now(), 'test'),
           ('ag_pa_agonly', 'paagonly', 3, 'ag_pa_agonly', 'test', 'sovereign', 'ownerq-a', 'claude-code',
            'self-reported', 'declared:unverified', 'sovereign', 'seed', NULL, NULL),
           ('ag_pa_plonly', 'paplonly', 4, 'ag_pa_plonly', 'test', 'sovereign', NULL, 'claude-code', 'self-reported',
            'declared:unverified', 'sovereign', 'seed', NULL, NULL),
           ('ag_pb_live', 'pblive', 1, 'ag_pb_live', 'test', 'sovereign', 'ownerq-b', 'claude-code', 'self-reported',
            'declared:unverified', 'sovereign', 'seed', NULL, NULL),
           ('ag_pcap', 'pcap', 1, 'ag_pcap', 'test', 'sovereign', 'ownerq-cap', 'claude-code', 'self-reported',
            'declared:unverified', 'sovereign', 'seed', NULL, NULL),
           ('ag_pexact', 'pexact', 5, 'ag_pexact', 'test', 'sovereign', 'ownerq-exact', 'claude-code',
            'self-reported', 'declared:unverified', 'sovereign', 'seed', NULL, NULL),
           ('ag_pbig', 'pbig', 6, 'ag_pbig', 'test', 'sovereign', 'ownerq-big', 'claude-code', 'self-reported',
            'declared:unverified', 'sovereign', 'seed', NULL, NULL);
  INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status) VALUES
    ('ag-pa-live', 'ownerq-a', 'ag_pa_live', 'Pa live', 'claude-code', 'active'),
    ('ag-pa-dead', 'ownerq-a', 'ag_pa_dead', 'Pa dead', 'claude-code', 'retired'),
    ('ag-pa-plonly', 'ownerq-a', 'ag_pa_plonly', 'Pa plonly', 'claude-code', 'active'),
    ('ag-pb-live', 'ownerq-b', 'ag_pb_live', 'Pb live', 'claude-code', 'active'),
    ('ag-pcap', 'ownerq-cap', 'ag_pcap', 'Pcap', 'claude-code', 'active');
  INSERT INTO mcp_tokens (token_id, player_id, token_hash, label, expires_at) VALUES
    ('mtok-pa-1', 'ag-pa-live', decode(repeat('c1', 32), 'hex'), 'a token', now() + interval '30 days'),
    ('mtok-pa-2', 'ag-pa-dead', decode(repeat('c3', 32), 'hex'), 'a dead token', now() + interval '30 days'),
    ('mtok-pb-1', 'ag-pb-live', decode(repeat('c2', 32), 'hex'), 'b token', now() + interval '30 days');
  INSERT INTO mcp_roster (player_name, owner_id, max_agents) VALUES ('pa-reserved', 'ownerq-a', 2),
    ('pb-reserved', 'ownerq-b', 1);
  INSERT INTO body_ops (owner_id, player_name, op) VALUES ('ownerq-a', 'pa-live', 'start'),
    ('ownerq-b', 'pb-live', 'start');
  INSERT INTO register_consents (identity_hash, terms_version) VALUES (hash_a, 'v1'), (hash_b, 'v1');
  -- the excluded thoughts columns carry a marker: it must not appear in the export
  INSERT INTO thoughts (thought_id, life_id, at, parsed, model_input, snapshot, provider_usage, raw_output) VALUES
    ('th-pa-1', 'ag_pa_live', now(), '{"say":"hello"}', jsonb_build_object('m', repeat('zqmark', 300)),
     jsonb_build_object('s', repeat('zqmark', 300)), jsonb_build_object('u', repeat('zqmark', 300)),
     repeat('zqmark', 300)),
    ('th-pa-2', 'ag_pa_dead', now(), NULL, NULL, NULL, NULL, NULL),
    ('th-pb-1', 'ag_pb_live', now(), NULL, NULL, NULL, NULL, NULL);
  INSERT INTO mcp_journal (life_id, at, text) VALUES
    ('ag_pa_live', now(), 'a journal line'), ('ag_pb_live', now(), 'b journal line');
  -- per-life records: every counted table gets one row for a's life and one for b's life (a cross row for a life
  -- that a names as the other side is counted once, below)
  INSERT INTO events (source_event_id, at, world_day, world_tick, type, agent_id, thinker_id, payload) VALUES
    ('ev-pa-1', now(), 1, 1, 'test', 'ag_pa_live', 'ag_pa_live', '{}'),
    ('ev-pa-2', now(), 1, 2, 'test', 'ag_pa_live', 'ag_pb_live', '{}'),
    ('ev-pa-3', now(), 1, 3, 'test', 'ag_pb_live', 'ag_pa_live', '{}'),
    ('ev-pa-4', now(), 1, 4, 'test', 'ag_pb_live', 'ag_pa_dead', '{}'),
    -- the parent events of the decisions, rolls and sheet adoptions below (both ids are b's life: no count for a)
    ('src-dec-pa', now(), 1, 1, 'test', 'ag_pb_live', 'ag_pb_live', '{}'),
    ('src-dec-pb', now(), 1, 1, 'test', 'ag_pb_live', 'ag_pb_live', '{}'),
    ('src-roll-pa', now(), 1, 1, 'test', 'ag_pb_live', 'ag_pb_live', '{}'),
    ('src-roll-pb', now(), 1, 1, 'test', 'ag_pb_live', 'ag_pb_live', '{}'),
    ('src-sh-pa', now(), 1, 1, 'test', 'ag_pb_live', 'ag_pb_live', '{}'),
    ('src-sh-pb', now(), 1, 1, 'test', 'ag_pb_live', 'ag_pb_live', '{}');
  INSERT INTO relationships (agent_id, other_id, impression, trust, last_seen_day) VALUES
    ('ag_pa_live', 'ag_pb_live', 'x', 1, 1), ('ag_pb_live', 'ag_pa_live', 'x', 1, 1);
  INSERT INTO memories (agent_id) VALUES ('ag_pa_live'), ('ag_pb_live');
  INSERT INTO goals (agent_id, rank, goal, why) VALUES ('ag_pa_live', 1, 'g', 'w'), ('ag_pb_live', 1, 'g', 'w');
  INSERT INTO intents (intent_id, life_id) VALUES ('int-pa-1', 'ag_pa_live'), ('int-pb-1', 'ag_pb_live');
  INSERT INTO actions (action_id, life_id) VALUES ('act-pa-1', 'ag_pa_live'), ('act-pb-1', 'ag_pb_live');
  INSERT INTO receipts (receipt_id, action_id, life_id) VALUES ('rc-pa-1', 'act-pa-1', 'ag_pa_live'),
    ('rc-pb-1', 'act-pb-1', 'ag_pb_live');
  INSERT INTO skill_runs (life_id) VALUES ('ag_pa_live'), ('ag_pb_live');
  INSERT INTO skills (skill_id, edition) VALUES ('sk-pa', 1), ('sk-pb', 1);
  INSERT INTO skill_library (agent_id, skill_id, edition) VALUES ('ag_pa_live', 'sk-pa', 1), ('ag_pb_live', 'sk-pb', 1);
  INSERT INTO ledger (agent_id, item, count, thoughts_credited, world_day, shrine_pos) VALUES
    ('ag_pa_live', 'item', 1, 1, 1, 'pos'), ('ag_pb_live', 'item', 1, 1, 1, 'pos');
  INSERT INTO votes (proposal_id, agent_id, vote, world_day) VALUES
    ('prop-1', 'ag_pa_live', 'yes', 1), ('prop-2', 'ag_pb_live', 'no', 1);
  INSERT INTO suppressed_wakeups (life_id) VALUES ('ag_pa_live'), ('ag_pb_live');
  INSERT INTO mcp_sleep_marks (life_id, last_sleep_day) VALUES ('ag_pa_live', 1), ('ag_pb_live', 1);
  INSERT INTO mcp_budget (life_id, credits, accrued_at) VALUES
    ('ag_pa_live', 10, now()), ('ag_pb_live', 10, now());
  INSERT INTO mcp_life_deaths (life_id, death_count) VALUES ('ag_pa_dead', 1), ('ag_pb_live', 1);
  INSERT INTO mcp_death_events (event_id, life_id) VALUES ('mde-pa-1', 'ag_pa_dead'), ('mde-pb-1', 'ag_pb_live');
  INSERT INTO decisions (source_event_id, life_id, world_tick, decision_id, engine_version, producer, fx, kind) VALUES
    ('src-dec-pa', 'ag_pa_live', 1, 'dec-pa-1', 1, 'test', 'fx', 'd20'),
    ('src-dec-pb', 'ag_pb_live', 1, 'dec-pb-1', 1, 'test', 'fx', 'd20');
  INSERT INTO rolls (source_event_id, life_id, world_tick, decision_id, draw_index, engine_version, producer, fx,
                     score, dc, mode, dice, kept, bonus, total, success) VALUES
    ('src-roll-pa', 'ag_pa_live', 1, 'dec-pa-1', 1, 1, 'body', 'fx', 3, 12, 'flat', '{3,4}', 4, 0, 4, false),
    ('src-roll-pb', 'ag_pb_live', 1, 'dec-pb-1', 1, 1, 'body', 'fx', 3, 12, 'flat', '{3,4}', 4, 0, 4, false);
  INSERT INTO xp_evidence (life_id, domain, evidence_key, source_event_id, world_tick) VALUES
    ('ag_pa_live', 'mining', 'ek-pa-1', 'src-xp-pa', 1), ('ag_pb_live', 'mining', 'ek-pb-1', 'src-xp-pb', 1);
  INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result) VALUES
    ('src-sh-pa', 'ag_pa_live', repeat('a', 64), '{}', 'config', 'adopted'),
    ('src-sh-pb', 'ag_pb_live', repeat('b', 64), '{}', 'config', 'adopted');
  INSERT INTO proficiency (life_id, domain) VALUES ('ag_pa_live', 'mining'), ('ag_pb_live', 'mining');
  INSERT INTO proficiency_outbox (life_id, domain, level, xp, version) VALUES
    ('ag_pa_live', 'mining', 1, 1, 1), ('ag_pb_live', 'mining', 1, 1, 1);

  step := 'function: exists, SECURITY DEFINER, search_path pinned';
  SELECT count(*) INTO n FROM pg_proc p
    WHERE p.proname = 'register_owner_export' AND p.prosecdef
      AND array_to_string(p.proconfig, ',') LIKE '%search_path=pg_catalog, public, pg_temp%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'owner export: % (%)', step, n;
  END IF;

  step := 'grants: no EXECUTE for PUBLIC or the other roles, EXECUTE for geldar_register';
  SELECT count(*) INTO n FROM pg_proc p
    WHERE p.proname = 'register_owner_export' AND p.proacl IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
      AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a JOIN pg_roles r ON r.oid = a.grantee
                  WHERE r.rolname = 'geldar_register' AND a.privilege_type = 'EXECUTE');
  IF n <> 1 THEN
    RAISE EXCEPTION 'owner export: %', step;
  END IF;
  IF has_function_privilege('geldar_mcp', 'register_owner_export(bytea)', 'EXECUTE')
     OR has_function_privilege('geldar_supervisor', 'register_owner_export(bytea)', 'EXECUTE')
     OR has_function_privilege('geldar_helper', 'register_owner_export(bytea)', 'EXECUTE')
     OR has_function_privilege('geldar_glass', 'register_owner_export(bytea)', 'EXECUTE')
     OR NOT has_function_privilege('geldar_register', 'register_owner_export(bytea)', 'EXECUTE') THEN
    RAISE EXCEPTION 'owner export: % (roles other than geldar_register can execute)', step;
  END IF;

  step := 'owner a: format, identity hash and owner id absent, token hashes absent, own rows present';
  j := register_owner_export(hash_a);
  IF j IS NULL OR j->>'format' <> 'geldar-owner-export/1' THEN
    RAISE EXCEPTION 'owner export: % (format)', step;
  END IF;
  txt := j::text;
  IF position('ownerq-' IN txt) > 0 OR position(encode(hash_a, 'hex') IN txt) > 0
     OR position('token_hash' IN txt) > 0 OR position(encode(decode(repeat('c1', 32), 'hex'), 'hex') IN txt) > 0
     OR position(encode(decode(repeat('c3', 32), 'hex'), 'hex') IN txt) > 0 THEN
    RAISE EXCEPTION 'owner export: % (leaked owner id, identity hash or token hash)', step;
  END IF;
  IF txt NOT LIKE '%th-pa-1%' OR txt NOT LIKE '%th-pa-2%' OR txt NOT LIKE '%mtok-pa-1%'
     OR txt NOT LIKE '%a journal line%' OR txt NOT LIKE '%ag_pa_dead%' OR txt NOT LIKE '%Owner A display%'
     OR txt NOT LIKE '%pa-reserved%' OR txt NOT LIKE '%pa-live%' OR txt NOT LIKE '%"v1"%' THEN
    RAISE EXCEPTION 'owner export: % (own rows missing)', step;
  END IF;

  step := 'owner a: excluded thoughts columns (model_input, snapshot, provider_usage, raw_output) not exported';
  IF position('zqmark' IN txt) > 0 THEN
    RAISE EXCEPTION 'owner export: %', step;
  END IF;

  step := 'owner a: exact key set of a thoughts row and a journal row';
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(j->'records'->'thoughts'->'rows'->0) k)
     <> (SELECT array_agg(k ORDER BY k) FROM unnest(thought_keys) k) THEN
    RAISE EXCEPTION 'owner export: % (thoughts keys)', step;
  END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(j->'records'->'mcp_journal'->'rows'->0) k)
     <> (SELECT array_agg(k ORDER BY k) FROM unnest(journal_keys) k) THEN
    RAISE EXCEPTION 'owner export: % (journal keys)', step;
  END IF;

  step := 'owner a: no rows of owner b anywhere in the export';
  IF txt LIKE '%th-pb-1%' OR txt LIKE '%ag_pb_live%' OR txt LIKE '%ag-pb-live%' OR txt LIKE '%mtok-pb-1%'
     OR txt LIKE '%b journal line%' OR txt LIKE '%Pb live%' OR txt LIKE '%Owner B display%'
     OR txt LIKE '%pb-reserved%' OR txt LIKE '%pb-live%' THEN
    RAISE EXCEPTION 'owner export: %', step;
  END IF;

  step := 'owner a: shape (players 3, tokens 2, lives 4 incl. agents-only and players-only, roster, body ops, consents)';
  IF jsonb_array_length(j->'players') <> 3 OR jsonb_array_length(j->'tokens') <> 2
     OR jsonb_array_length(j->'lives') <> 4 OR jsonb_array_length(j->'records'->'counts') <> 4
     OR jsonb_array_length(j->'roster') <> 1 OR jsonb_array_length(j->'body_ops') <> 1
     OR jsonb_array_length(j->'consents') <> 1 THEN
    RAISE EXCEPTION 'owner export: % (counts of players, tokens, lives, records, roster, body ops, consents)', step;
  END IF;
  IF (j->'owner') ? 'owner_id' OR (j->'identity') ? 'identity_hash' OR NOT (j->'owner') ? 'display_name'
     OR (j->'owner'->>'player_cap') <> '5' OR (j->'identity'->>'provider') <> 'github' THEN
    RAISE EXCEPTION 'owner export: % (owner or identity keys)', step;
  END IF;
  IF NOT (j ?& ARRAY['format', 'exported_at', 'owner', 'identity', 'players', 'tokens', 'roster', 'body_ops',
                     'consents', 'lives', 'records', 'not_included']) THEN
    RAISE EXCEPTION 'owner export: % (top-level key missing)', step;
  END IF;
  IF jsonb_array_length(j->'not_included') < 1 THEN
    RAISE EXCEPTION 'owner export: % (not_included empty)', step;
  END IF;
  IF (j->'records'->'thoughts'->>'truncated')::boolean OR (j->'records'->'mcp_journal'->>'truncated')::boolean
     OR jsonb_array_length(j->'records'->'thoughts'->'rows') <> 2 THEN
    RAISE EXCEPTION 'owner export: % (thoughts flag or rows)', step;
  END IF;

  step := 'owner a: per-life counts equal the expected object for ag_pa_live and ag_pa_dead (cross rows once each)';
  cnt := j->'records'->'counts';
  IF (SELECT e FROM jsonb_array_elements(cnt) e WHERE e->>'life_id' = 'ag_pa_live') IS DISTINCT FROM live_expected
     OR (SELECT e FROM jsonb_array_elements(cnt) e WHERE e->>'life_id' = 'ag_pa_dead') IS DISTINCT FROM dead_expected
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cnt) e WHERE e->>'life_id' = 'ag_pa_agonly')
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cnt) e WHERE e->>'life_id' = 'ag_pa_plonly') THEN
    RAISE EXCEPTION 'owner export: % (per-life counts)', step;
  END IF;

  step := 'owner b: only b rows; no a rows anywhere';
  jb := register_owner_export(hash_b);
  txt_b := jb::text;
  IF txt_b LIKE '%th-pa-%' OR txt_b LIKE '%ag_pa_%' OR txt_b LIKE '%ag-pa-%' OR txt_b LIKE '%mtok-pa-%'
     OR txt_b LIKE '%a journal line%' OR txt_b LIKE '%Pa live%' OR txt_b LIKE '%Owner A display%'
     OR jsonb_array_length(jb->'lives') <> 1 OR jsonb_array_length(jb->'tokens') <> 1 THEN
    RAISE EXCEPTION 'owner export: %', step;
  END IF;

  step := 'unknown hash, one-byte-off hash, and banned orphan with no owner return NULL';
  IF register_owner_export(hash_unknown) IS NOT NULL OR register_owner_export(hash_near) IS NOT NULL
     OR register_owner_export(hash_orphan) IS NOT NULL THEN
    RAISE EXCEPTION 'owner export: %', step;
  END IF;

  step := 'audit: one row per successful call, hashed actor, no name or id in target or detail; none for NULL';
  SELECT count(*) INTO audit_before FROM register_audit;
  PERFORM register_owner_export(hash_unknown);
  SELECT count(*) INTO audit_after FROM register_audit;
  IF audit_after <> audit_before THEN
    RAISE EXCEPTION 'owner export: % (unknown hash wrote an audit row)', step;
  END IF;
  SELECT count(*) INTO audit_before FROM register_audit WHERE action = 'owner.export';
  PERFORM register_owner_export(hash_a);
  SELECT count(*) INTO audit_after FROM register_audit WHERE action = 'owner.export';
  IF audit_after - audit_before <> 1 THEN
    RAISE EXCEPTION 'owner export: % (expected one audit row, got %)', step, audit_after - audit_before;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM register_audit WHERE action = 'owner.export' AND actor = actor_a
                 AND target = 'owner-export' AND detail = '' AND outcome = 'exported') THEN
    RAISE EXCEPTION 'owner export: % (hashed actor row missing)', step;
  END IF;
  IF EXISTS (SELECT 1 FROM register_audit WHERE action = 'owner.export'
             AND ((actor || ' ' || target || ' ' || detail) LIKE '%ownerq%'
                  OR (actor || ' ' || target || ' ' || detail) LIKE '%Owner A%')) THEN
    RAISE EXCEPTION 'owner export: % (owner id or name in audit)', step;
  END IF;

  step := 'row cap: 20001 thoughts and 20001 journal rows for owner cap: both truncated at 20000, the earliest kept';
  INSERT INTO thoughts (thought_id, life_id, at)
    SELECT 'th-cap-' || g, 'ag_pcap', now() - g * interval '1 second' FROM generate_series(1, 20001) AS g;
  INSERT INTO mcp_journal (life_id, at, text)
    SELECT 'ag_pcap', now() - g * interval '1 second', 'j' FROM generate_series(1, 20001) AS g;
  SELECT min(x.id) INTO jfirst FROM mcp_journal x WHERE x.life_id = 'ag_pcap';
  jcap := register_owner_export(hash_cap);
  IF jcap IS NULL OR NOT (jcap->'records'->'thoughts'->>'truncated')::boolean
     OR NOT (jcap->'records'->'mcp_journal'->>'truncated')::boolean
     OR jsonb_array_length(jcap->'records'->'thoughts'->'rows') <> 20000
     OR jsonb_array_length(jcap->'records'->'mcp_journal'->'rows') <> 20000 THEN
    RAISE EXCEPTION 'owner export: % (truncated flags or row cap)', step;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(jcap->'records'->'thoughts'->'rows') r
             WHERE r->>'thought_id' = 'th-cap-1')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(jcap->'records'->'mcp_journal'->'rows') r
                WHERE (r->>'id')::bigint = jfirst) THEN
    RAISE EXCEPTION 'owner export: % (the latest rows were kept: not the earliest in time order)', step;
  END IF;

  step := 'row cap boundary: exactly 20000 thoughts and 20000 journal rows for owner exact is not truncated';
  INSERT INTO thoughts (thought_id, life_id, at)
    SELECT 'th-exact-' || g, 'ag_pexact', now() - g * interval '1 second' FROM generate_series(1, 20000) AS g;
  INSERT INTO mcp_journal (life_id, at, text)
    SELECT 'ag_pexact', now(), 'e' FROM generate_series(1, 20000) AS g;
  jexact := register_owner_export(hash_exact);
  IF jexact IS NULL OR (jexact->'records'->'thoughts'->>'truncated')::boolean
     OR (jexact->'records'->'mcp_journal'->>'truncated')::boolean
     OR jsonb_array_length(jexact->'records'->'thoughts'->'rows') <> 20000
     OR jsonb_array_length(jexact->'records'->'mcp_journal'->'rows') <> 20000 THEN
    RAISE EXCEPTION 'owner export: % (exact cap flagged truncated or lost rows)', step;
  END IF;

  step := 'byte budget: 20001 thoughts of 6000 characters of parsed: truncated, fewer than 20000 rows, output near 100 MB';
  INSERT INTO thoughts (thought_id, life_id, at, parsed)
    SELECT 'th-big-' || g, 'ag_pbig', now() - g * interval '1 second', jsonb_build_object('x', repeat('x', 6000))
    FROM generate_series(1, 20001) AS g;
  jbig := register_owner_export(hash_big);
  IF jbig IS NULL OR NOT (jbig->'records'->'thoughts'->>'truncated')::boolean
     OR jsonb_array_length(jbig->'records'->'thoughts'->'rows') >= 20000
     OR jsonb_array_length(jbig->'records'->'thoughts'->'rows') < 1
     OR octet_length(jbig::text) > 110000000 THEN
    RAISE EXCEPTION 'owner export: % (byte budget not applied)', step;
  END IF;

  RAISE NOTICE 'check-schema-owner-export: all checks passed';
END
$owner_export$;
