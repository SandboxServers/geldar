-- Migration 0065 (C7-09b): the export bounds, by TEXT size. Run after check-schema-owner-export.sql, on the same
-- database. Owners: ownerq-wc (control characters: chr(1) is six bytes in the JSON text; every list at its cap or past
-- it, and both bulky tables full) and ownerq-wq (4000 double quotes per journal row: two bytes each in the JSON text).
-- The hashes are 'c7' and 'c8' (no other check file uses them). The fixtures are not cleaned up.

DO $owner_export_bounds$
DECLARE
  h_wc BYTEA := decode(repeat('c7', 32), 'hex');
  h_wq BYTEA := decode(repeat('c8', 32), 'hex');
  h_pl BYTEA := decode(repeat('c6', 32), 'hex');
  h_bd BYTEA := decode(repeat('c5', 32), 'hex');
  ctl TEXT := repeat(chr(1), 4000);
  quo TEXT := repeat('"', 4000);
  wc JSONB;
  wq JSONB;
  pl JSONB;
  wd JSONB;
  kept BIGINT;
  n INT;
BEGIN
  INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES
    ('ownerq-wc', repeat(chr(1), 300), 5), ('ownerq-wq', 'Owner wq display', 5);
  INSERT INTO mcp_identities (identity_hash, provider, owner_id, banned_at) VALUES
    (h_wc, 'github', 'ownerq-wc', NULL), (h_wq, 'github', 'ownerq-wq', NULL);
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness, declared_model,
                      model_config, tier, personality_seed, died_at, death_cause)
    SELECT 'ag_wc_' || g, repeat(chr(1), 300), g, 'ag_wc_' || g, repeat(chr(1), 300), 'sovereign', 'ownerq-wc',
           'claude-code', repeat(chr(1), 300), 'declared:unverified', 'sovereign', 'seed', NULL, NULL
    FROM generate_series(1, 60) AS g;
  INSERT INTO thoughts (thought_id, life_id, at, parsed)
    SELECT 'th-wc-' || g, 'ag_wc_1', now() - g * interval '1 second', jsonb_build_object('x', ctl)
    FROM generate_series(1, 300) AS g;
  INSERT INTO mcp_journal (life_id, at, text)
    SELECT 'ag_wc_1', now() - g * interval '1 second', ctl FROM generate_series(1, 300) AS g;
  INSERT INTO mcp_roster (player_name, owner_id, max_agents)
    SELECT repeat(chr(1), 200) || g, 'ownerq-wc', 1 FROM generate_series(1, 101) AS g;
  INSERT INTO body_ops (owner_id, player_name, op)
    SELECT 'ownerq-wc', repeat(chr(1), 64), 'start' FROM generate_series(1, 501) AS g;
  INSERT INTO register_consents (identity_hash, terms_version)
    SELECT h_wc, 'v' || g FROM generate_series(1, 101) AS g;

  wc := register_owner_export(h_wc);
  IF wc IS NULL OR octet_length(wc::text) >= 8000000 THEN
    RAISE EXCEPTION 'owner export bounds: worst case is % bytes (limit 8000000)', octet_length(wc::text);
  END IF;
  RAISE NOTICE 'owner export bounds: worst-case document % bytes', octet_length(wc::text);

  -- every list flag: lives 60 (cap 50), roster 101 (cap 100), body ops 501 (cap 500), consents 101 (cap 100);
  -- players and tokens are not over their caps here
  IF NOT (wc->'truncated'->>'lives')::boolean OR NOT (wc->'truncated'->>'roster')::boolean
     OR NOT (wc->'truncated'->>'body_ops')::boolean OR NOT (wc->'truncated'->>'consents')::boolean
     OR (wc->'truncated'->>'players')::boolean OR (wc->'truncated'->>'tokens')::boolean THEN
    RAISE EXCEPTION 'owner export bounds: list truncated flags wrong';
  END IF;
  IF jsonb_array_length(wc->'lives') <> 50 OR jsonb_array_length(wc->'roster') <> 100
     OR jsonb_array_length(wc->'body_ops') <> 500 OR jsonb_array_length(wc->'consents') <> 100 THEN
    RAISE EXCEPTION 'owner export bounds: list caps not applied (lives %, roster %, body ops %, consents %)',
      jsonb_array_length(wc->'lives'), jsonb_array_length(wc->'roster'),
      jsonb_array_length(wc->'body_ops'), jsonb_array_length(wc->'consents');
  END IF;

  -- the per-life counts cover only the exported lives: 60 lives, 50 exported, 50 count entries, lives flagged
  IF jsonb_array_length(wc->'records'->'counts') <> 50 OR NOT (wc->'truncated'->>'lives')::boolean THEN
    RAISE EXCEPTION 'owner export bounds: counts % entries, lives flag wrong (want 50 and true)',
      jsonb_array_length(wc->'records'->'counts');
  END IF;

  -- the 200-character cut: a 300-character owner display and life name come out at 200 characters
  IF char_length(wc->'owner'->>'display_name') <> 200 OR char_length(wc->'lives'->0->>'name') <> 200
     OR char_length(wc->'roster'->0->>'player_name') <> 200 THEN
    RAISE EXCEPTION 'owner export bounds: free text not cut at 200 characters';
  END IF;

  -- the bulky tables: both truncated, and the kept text per table is at most 3000000 bytes (the text of each row)
  IF NOT (wc->'records'->'thoughts'->>'truncated')::boolean OR NOT (wc->'records'->'mcp_journal'->>'truncated')::boolean THEN
    RAISE EXCEPTION 'owner export bounds: bulky table not flagged truncated';
  END IF;
  SELECT COALESCE(sum(octet_length(e::text)), 0) INTO kept FROM jsonb_array_elements(wc->'records'->'thoughts'->'rows') e;
  IF kept > 3000000 THEN
    RAISE EXCEPTION 'owner export bounds: thoughts text % over 3000000', kept;
  END IF;
  SELECT COALESCE(sum(octet_length(e::text)), 0) INTO kept FROM jsonb_array_elements(wc->'records'->'mcp_journal'->'rows') e;
  IF kept > 3000000 THEN
    RAISE EXCEPTION 'owner export bounds: journal text % over 3000000', kept;
  END IF;

  -- the player and token lists: 151 players (cap 150) and 151 tokens (cap 150) for one owner, with 151 lives
  -- the table allows player_cap 0..50 and the cap trigger refuses a 51st player, so the fixture bypasses the
  -- triggers for its own inserts (session_replication_role = replica, superuser only); the list cap of 150 is a backstop
  INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES ('ownerq-pl', 'Owner pl', 50);
  INSERT INTO mcp_identities (identity_hash, provider, owner_id, banned_at) VALUES (h_pl, 'github', 'ownerq-pl', NULL);
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness, declared_model,
                      model_config, tier, personality_seed, died_at, death_cause)
    SELECT 'ag_pl_' || g, 'pl' || g, g, 'ag_pl_' || g, 'test', 'sovereign', 'ownerq-pl', 'claude-code',
           'self-reported', 'declared:unverified', 'sovereign', 'seed', NULL, NULL
    FROM generate_series(1, 151) AS g;
  SET session_replication_role = replica;
  INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status)
    SELECT 'ag-pl-' || g, 'ownerq-pl', 'ag_pl_' || g, 'Pl ' || g, 'claude-code', 'active'
    FROM generate_series(1, 151) AS g;
  SET session_replication_role = DEFAULT;
  INSERT INTO mcp_tokens (token_id, player_id, token_hash, label, expires_at)
    SELECT 'mtok-pl-' || g, 'ag-pl-1', decode(lpad(to_hex(g), 64, '0'), 'hex'), 'tok ' || g, now() + interval '30 days'
    FROM generate_series(1, 151) AS g;
  pl := register_owner_export(h_pl);
  IF jsonb_array_length(pl->'players') <> 150 OR jsonb_array_length(pl->'tokens') <> 150
     OR NOT (pl->'truncated'->>'players')::boolean OR NOT (pl->'truncated'->>'tokens')::boolean THEN
    RAISE EXCEPTION 'owner export bounds: players % and tokens % (want 150 each, both flagged)',
      jsonb_array_length(pl->'players'), jsonb_array_length(pl->'tokens');
  END IF;

  -- the quote fixture: 500 journal rows of 4000 double quotes (8000 bytes of JSON text each): cut, under 3000000 kept
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness, declared_model,
                      model_config, tier, personality_seed, died_at, death_cause)
    VALUES ('ag_wq_1', 'wq1', 1, 'ag_wq_1', 'test', 'sovereign', 'ownerq-wq', 'claude-code', 'self-reported',
            'declared:unverified', 'sovereign', 'seed', NULL, NULL);
  INSERT INTO mcp_journal (life_id, at, text)
    SELECT 'ag_wq_1', now() - g * interval '1 second', quo FROM generate_series(1, 500) AS g;
  wq := register_owner_export(h_wq);
  SELECT COALESCE(sum(octet_length(e::text)), 0) INTO kept FROM jsonb_array_elements(wq->'records'->'mcp_journal'->'rows') e;
  IF NOT (wq->'records'->'mcp_journal'->>'truncated')::boolean OR kept > 3000000 OR octet_length(wq::text) >= 8000000 THEN
    RAISE EXCEPTION 'owner export bounds: quote journal not cut to the text budget (kept %)', kept;
  END IF;

  -- the budget boundary: 3600 journal rows, each exactly 853 bytes (the JSON text plus one; 853 divides 3000001 and
  -- not 3000000), so the budget keeps floor(3000000 / 853) = 3516 rows; a budget of 3000001 would keep 3517
  INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES ('ownerq-bd', 'Owner bd', 5);
  INSERT INTO mcp_identities (identity_hash, provider, owner_id, banned_at) VALUES (h_bd, 'github', 'ownerq-bd', NULL);
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness, declared_model,
                      model_config, tier, personality_seed, died_at, death_cause)
    VALUES ('ag_bd_1', 'bd1', 1, 'ag_bd_1', 'test', 'sovereign', 'ownerq-bd', 'claude-code', 'self-reported',
            'declared:unverified', 'sovereign', 'seed', NULL, NULL);
  INSERT INTO mcp_journal (life_id, at, text)
    SELECT 'ag_bd_1', now() - g * interval '1 second', '' FROM generate_series(1, 3600) AS g;
  -- mcp_journal is append-only (a trigger refuses UPDATE): the fixture's own sizing UPDATE bypasses the trigger
  -- with session_replication_role = replica (superuser only, as for the players above)
  SET session_replication_role = replica;
  UPDATE mcp_journal j SET text = repeat('x', 853 - 1 - octet_length(
      jsonb_build_object('id', j.id, 'life_id', j.life_id, 'at', j.at, 'text', j.text)::text))
    WHERE j.life_id = 'ag_bd_1';
  SET session_replication_role = DEFAULT;
  wd := register_owner_export(h_bd);
  IF NOT (wd->'records'->'mcp_journal'->>'truncated')::boolean
     OR jsonb_array_length(wd->'records'->'mcp_journal'->'rows') <> 3516 THEN
    RAISE EXCEPTION 'owner export bounds: journal budget boundary (want 3516 rows of 853 bytes, got %)',
      jsonb_array_length(wd->'records'->'mcp_journal'->'rows');
  END IF;

  RAISE NOTICE 'check-schema-owner-export-bounds: all checks passed';
END
$owner_export_bounds$;
