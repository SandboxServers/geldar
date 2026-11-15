-- Migration 0062 (C7-09b): register_owner_export behaviour. Run after check-schema.sql and the migrations through 0062,
-- on a fresh database (the fixtures are not cleaned up). Fixtures are written by the superuser; the export is called
-- as the superuser (the privilege checks use the ACL and the role name). Owners ownerq-a (the one exported), ownerq-b
-- (a second owner that must not appear anywhere in a's export), ownerq-cap (the cap test). An identity banned with no
-- owner link (orphan) must return NULL.

DO $owner_export$
DECLARE
  step TEXT;
  hash_a BYTEA := decode(repeat('b1', 32), 'hex');
  hash_b BYTEA := decode(repeat('b2', 32), 'hex');
  hash_cap BYTEA := decode(repeat('b3', 32), 'hex');
  hash_unknown BYTEA := decode(repeat('b4', 32), 'hex');
  hash_orphan BYTEA := decode(repeat('b5', 32), 'hex');
  hash_near BYTEA := decode(repeat('b1', 31) || 'b2', 'hex');
  actor_a TEXT := left(encode(sha256(convert_to('ownerq-a', 'UTF8')), 'hex'), 16);
  j JSONB;
  jb JSONB;
  jcap JSONB;
  txt TEXT;
  txt_b TEXT;
  audit_before BIGINT;
  audit_after BIGINT;
  n INT;
BEGIN
  step := 'fixture: owners, identities (orphan is banned with no owner), agents, players, tokens, budget, thoughts, journal';
  INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES
    ('ownerq-a', 'Owner A display', 5), ('ownerq-b', 'Owner B display', 5), ('ownerq-cap', 'Owner cap display', 5);
  INSERT INTO mcp_identities (identity_hash, provider, owner_id, banned_at) VALUES
    (hash_a, 'github', 'ownerq-a', NULL),
    (hash_b, 'github', 'ownerq-b', NULL),
    (hash_cap, 'discord', 'ownerq-cap', NULL),
    (hash_orphan, 'discord', NULL, now());
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness, declared_model,
                      model_config, tier, personality_seed, died_at, death_cause)
    VALUES ('ag_pa_live', 'palive', 1, 'ag_pa_live', 'test', 'sovereign', 'ownerq-a', 'claude-code', 'self-reported',
            'declared:unverified', 'sovereign', 'seed', NULL, NULL),
           ('ag_pa_dead', 'padead', 2, 'ag_pa_dead', 'test', 'sovereign', 'ownerq-a', 'claude-code', 'self-reported',
            'declared:unverified', 'sovereign', 'seed', now(), 'test'),
           ('ag_pb_live', 'pblive', 1, 'ag_pb_live', 'test', 'sovereign', 'ownerq-b', 'claude-code', 'self-reported',
            'declared:unverified', 'sovereign', 'seed', NULL, NULL),
           ('ag_pcap', 'pcap', 1, 'ag_pcap', 'test', 'sovereign', 'ownerq-cap', 'claude-code', 'self-reported',
            'declared:unverified', 'sovereign', 'seed', NULL, NULL);
  INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status) VALUES
    ('ag-pa-live', 'ownerq-a', 'ag_pa_live', 'Pa live', 'claude-code', 'active'),
    ('ag-pa-dead', 'ownerq-a', 'ag_pa_dead', 'Pa dead', 'claude-code', 'retired'),
    ('ag-pb-live', 'ownerq-b', 'ag_pb_live', 'Pb live', 'claude-code', 'active'),
    ('ag-pcap', 'ownerq-cap', 'ag_pcap', 'Pcap', 'claude-code', 'active');
  INSERT INTO mcp_tokens (token_id, player_id, token_hash, label, expires_at) VALUES
    ('mtok-pa-1', 'ag-pa-live', decode(repeat('c1', 32), 'hex'), 'a token', now() + interval '30 days'),
    ('mtok-pa-2', 'ag-pa-dead', decode(repeat('c3', 32), 'hex'), 'a dead token', now() + interval '30 days'),
    ('mtok-pb-1', 'ag-pb-live', decode(repeat('c2', 32), 'hex'), 'b token', now() + interval '30 days');
  INSERT INTO mcp_budget (life_id, credits, accrued_at) VALUES
    ('ag_pa_live', 10, now()), ('ag_pb_live', 10, now());
  INSERT INTO thoughts (thought_id, life_id, at) VALUES
    ('th-pa-1', 'ag_pa_live', now()), ('th-pa-2', 'ag_pa_dead', now()), ('th-pb-1', 'ag_pb_live', now());
  INSERT INTO mcp_journal (life_id, at, text) VALUES
    ('ag_pa_live', now(), 'a journal line'), ('ag_pb_live', now(), 'b journal line');

  step := 'function: exists, SECURITY DEFINER, search_path pinned';
  SELECT count(*) INTO n FROM pg_proc p
    WHERE p.proname = 'register_owner_export' AND p.prosecdef
      AND array_to_string(p.proconfig, ',') LIKE '%search_path=pg_catalog, public, pg_temp%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'owner export: % (%)', step, n;
  END IF;

  step := 'grants: no EXECUTE for PUBLIC (explicit ACL, no PUBLIC entry), EXECUTE for geldar_register';
  SELECT count(*) INTO n FROM pg_proc p
    WHERE p.proname = 'register_owner_export' AND p.proacl IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
      AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a JOIN pg_roles r ON r.oid = a.grantee
                  WHERE r.rolname = 'geldar_register' AND a.privilege_type = 'EXECUTE');
  IF n <> 1 THEN
    RAISE EXCEPTION 'owner export: %', step;
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
     OR txt NOT LIKE '%a journal line%' OR txt NOT LIKE '%ag_pa_dead%' OR txt NOT LIKE '%Owner A display%' THEN
    RAISE EXCEPTION 'owner export: % (own rows missing)', step;
  END IF;

  step := 'owner a: no rows of owner b anywhere in the export';
  IF txt LIKE '%th-pb-1%' OR txt LIKE '%ag_pb_live%' OR txt LIKE '%ag-pb-live%' OR txt LIKE '%mtok-pb-1%'
     OR txt LIKE '%b journal line%' OR txt LIKE '%Pb live%' OR txt LIKE '%Owner B display%' THEN
    RAISE EXCEPTION 'owner export: %', step;
  END IF;

  step := 'owner a: shape (players 2, tokens 2, lives 2, owner has no owner_id, identity has no hash, counts per life)';
  IF jsonb_array_length(j->'players') <> 2 OR jsonb_array_length(j->'tokens') <> 2
     OR jsonb_array_length(j->'lives') <> 2 OR jsonb_array_length(j->'records'->'counts') <> 2 THEN
    RAISE EXCEPTION 'owner export: % (counts of players, tokens, lives, records)', step;
  END IF;
  IF (j->'owner') ? 'owner_id' OR (j->'identity') ? 'identity_hash' OR NOT (j->'owner') ? 'display_name'
     OR (j->'owner'->>'player_cap') <> '5' OR (j->'identity'->>'provider') <> 'github' THEN
    RAISE EXCEPTION 'owner export: % (owner or identity keys)', step;
  END IF;
  IF (SELECT (e->>'mcp_budget')::int FROM jsonb_array_elements(j->'records'->'counts') e
      WHERE e->>'life_id' = 'ag_pa_live') <> 1 THEN
    RAISE EXCEPTION 'owner export: % (per-life count)', step;
  END IF;
  IF NOT (j ?& ARRAY['format', 'exported_at', 'owner', 'identity', 'players', 'tokens', 'lives', 'records',
                     'not_included']) THEN
    RAISE EXCEPTION 'owner export: % (top-level key missing)', step;
  END IF;
  IF jsonb_array_length(j->'not_included') < 1 THEN
    RAISE EXCEPTION 'owner export: % (not_included empty)', step;
  END IF;
  IF (j->'records'->'thoughts'->>'truncated')::boolean OR (j->'records'->'mcp_journal'->>'truncated')::boolean
     OR jsonb_array_length(j->'records'->'thoughts'->'rows') <> 2 THEN
    RAISE EXCEPTION 'owner export: % (thoughts flag or rows)', step;
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
             AND (actor || ' ' || target || ' ' || detail) LIKE '%ownerq%'
             OR (action = 'owner.export' AND (actor || ' ' || target || ' ' || detail) LIKE '%Owner A%')) THEN
    RAISE EXCEPTION 'owner export: % (owner id or name in audit)', step;
  END IF;

  step := 'cap: 20001 thoughts for one life of owner cap; thoughts truncated at 20000, journal not truncated';
  INSERT INTO thoughts (thought_id, life_id, at)
    SELECT 'th-cap-' || g, 'ag_pcap', now() FROM generate_series(1, 20001) AS g;
  jcap := register_owner_export(hash_cap);
  IF NOT (jcap->'records'->'thoughts'->>'truncated')::boolean
     OR jsonb_array_length(jcap->'records'->'thoughts'->'rows') <> 20000
     OR (jcap->'records'->'mcp_journal'->>'truncated')::boolean THEN
    RAISE EXCEPTION 'owner export: % (truncated flag or cap)', step;
  END IF;
  IF (j->'records'->'thoughts'->>'truncated')::boolean THEN
    RAISE EXCEPTION 'owner export: % (owner a flagged truncated)', step;
  END IF;

  RAISE NOTICE 'check-schema-owner-export: all checks passed';
END
$owner_export$;
