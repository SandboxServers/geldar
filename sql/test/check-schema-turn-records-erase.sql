-- Migration 0053 (S9-00a, decision 0323): register_account_delete erases the turn_records rows of every life of the
-- owner, dead or alive, and leaves another owner's rows alone. Run after check-schema.sql and the migrations through
-- 0053. Fixtures are written by the superuser; the delete is called as the superuser. Owner trerase-a has a living life
-- and a dead life, owner trerase-b has one living life. register_audit refuses DELETE, so the audit row the call writes
-- stays: run this file once on a fresh database, as ci.yml does.

DO $tr_erase$
DECLARE
  hash_a BYTEA := sha256(convert_to('trerase-a', 'UTF8'));
  hash_b BYTEA := sha256(convert_to('trerase-b', 'UTF8'));
  n INT;
BEGIN
  INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES
    ('trerase-a', 'a', 5), ('trerase-b', 'b', 5);
  INSERT INTO mcp_identities (identity_hash, provider, owner_id, banned_at) VALUES
    (hash_a, 'github', 'trerase-a', NULL),
    (hash_b, 'github', 'trerase-b', NULL);
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
                      declared_model, model_config, tier, personality_seed, thoughts_delayed_public, public_camera,
                      died_at, death_cause)
    VALUES ('ag_trerasea_01', 'trerasea1', 1, 'ag_trerasea_01', 'test', 'sovereign', 'trerase-a', 'claude-code',
            'self-reported', 'declared:unverified', 'sovereign', 'seed', TRUE, TRUE, NULL, NULL),
           ('ag_trerasea_02', 'trerasea2', 2, 'ag_trerasea_02', 'test', 'sovereign', 'trerase-a', 'claude-code',
            'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE, FALSE, now(), 'test'),
           ('ag_treraseb_01', 'treraseb1', 1, 'ag_treraseb_01', 'test', 'sovereign', 'trerase-b', 'claude-code',
            'self-reported', 'declared:unverified', 'sovereign', 'seed', TRUE, TRUE, NULL, NULL);
  INSERT INTO turn_records (turn_id, life_id, harness, model, template_version, wake_reason, world_day, world_tick, model_input, raw_output, tokens_in, tokens_out, usage_source, latency_ms, context_tokens, context_window) VALUES
    ('tn_' || lpad('1', 26, '0'), 'ag_trerasea_01', 'test', 'm', repeat('a', 64), 'wake', 0, 0, 'in', 'out', 0, 0, 'estimated', 0, 0, 1),
    ('tn_' || lpad('2', 26, '0'), 'ag_trerasea_02', 'test', 'm', repeat('a', 64), 'wake', 0, 0, 'in', 'out', 0, 0, 'estimated', 0, 0, 1),
    ('tn_' || lpad('3', 26, '0'), 'ag_treraseb_01', 'test', 'm', repeat('a', 64), 'wake', 0, 0, 'in', 'out', 0, 0, 'estimated', 0, 0, 1);

  PERFORM register_account_delete(hash_a);

  SELECT count(*) INTO n FROM turn_records WHERE life_id IN ('ag_trerasea_01', 'ag_trerasea_02');
  IF n <> 0 THEN
    RAISE EXCEPTION 'turn_records erase: % row(s) of owner trerase-a survive the account delete', n;
  END IF;

  SELECT count(*) INTO n FROM turn_records WHERE life_id = 'ag_treraseb_01';
  IF n <> 1 THEN
    RAISE EXCEPTION 'turn_records erase: owner trerase-b lost its row (found %)', n;
  END IF;
END
$tr_erase$;
