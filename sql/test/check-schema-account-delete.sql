-- Migration 0039 (C7-09a, decision 0171): behaviour of register_account_delete. Run after check-schema.sql and the
-- migrations through 0039. Fixtures are written by the superuser; the delete is called as the superuser (the
-- privilege checks use has_function_privilege). Owners reg-del-a (unbanned, the one deleted), reg-del-b (a second
-- owner that must keep every row) and reg-del-c (banned: the tombstone stays). register_audit refuses DELETE, so
-- the fixture is not cleaned up: run this file once on a fresh database, as ci.yml does.
DO $account_delete$
DECLARE
  step TEXT;
  n INT;
  found BOOLEAN;
  audit_before BIGINT;
  owner_val TEXT;
  banned_val BOOLEAN;
  hash_a BYTEA := decode(repeat('51', 32), 'hex');
  hash_b BYTEA := decode(repeat('52', 32), 'hex');
  hash_c BYTEA := decode(repeat('53', 32), 'hex');
  actor_a TEXT := left(encode(sha256(convert_to('reg-del-a', 'UTF8')), 'hex'), 16);
  r RECORD;
BEGIN
  step := 'fixture: owners a, b, c; identities a, b, c (c banned); a has a living and a dead life, a token and a key';
  INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES
    ('reg-del-a', 'a', 5), ('reg-del-b', 'b', 5), ('reg-del-c', 'c', 5);
  INSERT INTO mcp_identities (identity_hash, provider, owner_id, banned_at) VALUES
    (hash_a, 'github', 'reg-del-a', NULL),
    (hash_b, 'github', 'reg-del-b', NULL),
    (hash_c, 'discord', 'reg-del-c', now());
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
                      declared_model, model_config, tier, personality_seed, thoughts_delayed_public, died_at, death_cause)
    VALUES ('ag_del_live', 'dellive', 1, 'ag_del_live', 'test', 'sovereign', 'reg-del-a', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE, NULL, NULL),
           ('ag_del_dead', 'deldead', 1, 'ag_del_dead', 'test', 'sovereign', 'reg-del-a', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE, now(), 'test'),
           ('ag_del_b', 'delb', 1, 'ag_del_b', 'test', 'sovereign', 'reg-del-b', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE, NULL, NULL);
  INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status) VALUES
    ('ag-del-live', 'reg-del-a', 'ag_del_live', 'dellive', 'claude-code', 'active'),
    ('ag-del-dead', 'reg-del-a', 'ag_del_dead', 'deldead', 'claude-code', 'retired'),
    ('ag-del-b', 'reg-del-b', 'ag_del_b', 'delb', 'claude-code', 'active');
  INSERT INTO mcp_budget (life_id, credits, accrued_at) VALUES ('ag_del_live', 10, now()), ('ag_del_b', 10, now());
  INSERT INTO mcp_journal (life_id, at, text) VALUES
    ('ag_del_live', now(), 'live thought'), ('ag_del_dead', now(), 'dead thought'), ('ag_del_b', now(), 'b thought');
  INSERT INTO mcp_tokens (token_id, player_id, token_hash, expires_at) VALUES
    ('mtok-del-a', 'ag-del-live', decode(repeat('a1', 32), 'hex'), now() + interval '30 days'),
    ('mtok-del-b', 'ag-del-b', decode(repeat('b1', 32), 'hex'), now() + interval '30 days');
  INSERT INTO owner_api_keys (key_id, owner_id, key_hash, scopes, expires_at) VALUES
    ('gok-0000000000de1e01', 'reg-del-a', decode(repeat('de', 31) || '01', 'hex'), ARRAY['read'], now() + interval '90 days'),
    ('gok-0000000000de1e02', 'reg-del-b', decode(repeat('de', 31) || '02', 'hex'), ARRAY['read'], now() + interval '90 days');

  step := 'privilege: geldar_register may execute, PUBLIC may not, the definer runs with the pinned search_path';
  IF NOT has_function_privilege('geldar_register', 'register_account_delete(bytea)', 'EXECUTE') THEN
    RAISE EXCEPTION 'account delete: geldar_register cannot execute';
  END IF;
  IF has_function_privilege('public', 'register_account_delete(bytea)', 'EXECUTE') THEN
    RAISE EXCEPTION 'account delete: PUBLIC can execute';
  END IF;
  SELECT prosecdef, proconfig INTO r FROM pg_proc WHERE proname = 'register_account_delete';
  IF NOT r.prosecdef OR NOT ('search_path=pg_catalog, public, pg_temp' = ANY (r.proconfig)) THEN
    RAISE EXCEPTION 'account delete: not a definer with the pinned search_path';
  END IF;

  step := 'first delete of a: true, and a identity, owner, tokens, keys, player and live thoughts are gone';
  SELECT coalesce(max(id), 0) INTO audit_before FROM register_audit;
  IF NOT register_account_delete(hash_a) THEN
    RAISE EXCEPTION 'account delete: first delete returned false';
  END IF;
  SELECT EXISTS (SELECT 1 FROM mcp_identities WHERE identity_hash = hash_a) INTO found;
  IF found THEN RAISE EXCEPTION 'account delete: unbanned identity row kept'; END IF;
  SELECT count(*) INTO n FROM mcp_owners WHERE owner_id = 'reg-del-a';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: owner row kept'; END IF;
  SELECT count(*) INTO n FROM mcp_tokens WHERE player_id = 'ag-del-live';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: token of a living player kept'; END IF;
  SELECT count(*) INTO n FROM owner_api_keys WHERE owner_id = 'reg-del-a';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: owner key kept'; END IF;
  SELECT count(*) INTO n FROM mcp_players WHERE owner_id = 'reg-del-a';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: player row kept'; END IF;
  SELECT count(*) INTO n FROM mcp_journal WHERE life_id = 'ag_del_live';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: thoughts of a living life kept'; END IF;

  step := 'dead life keeps its thoughts and agent row with no owner link; a living agent loses its owner link';
  SELECT count(*) INTO n FROM mcp_journal WHERE life_id = 'ag_del_dead';
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: thought of a dead life removed'; END IF;
  SELECT owner INTO STRICT owner_val FROM agents WHERE agent_id = 'ag_del_dead';
  IF owner_val IS NOT NULL THEN RAISE EXCEPTION 'account delete: dead life keeps an owner link'; END IF;
  SELECT owner INTO STRICT owner_val FROM agents WHERE agent_id = 'ag_del_live';
  IF owner_val IS NOT NULL THEN RAISE EXCEPTION 'account delete: living agent keeps an owner link'; END IF;

  step := 'two-owner fixture: owner b keeps its owner, player, token, budget, thoughts and agent owner';
  SELECT count(*) INTO n FROM mcp_owners WHERE owner_id = 'reg-del-b';
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: other owner row removed'; END IF;
  SELECT count(*) INTO n FROM mcp_players WHERE owner_id = 'reg-del-b' AND life_id = 'ag_del_b';
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: other owner player removed'; END IF;
  SELECT count(*) INTO n FROM mcp_tokens WHERE token_id = 'mtok-del-b';
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: other owner token removed'; END IF;
  SELECT count(*) INTO n FROM owner_api_keys WHERE key_id = 'gok-0000000000de1e02';
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: other owner key removed'; END IF;
  SELECT count(*) INTO n FROM mcp_journal WHERE life_id = 'ag_del_b';
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: other owner thoughts removed'; END IF;
  SELECT owner INTO STRICT owner_val FROM agents WHERE agent_id = 'ag_del_b';
  IF owner_val IS DISTINCT FROM 'reg-del-b' THEN RAISE EXCEPTION 'account delete: other owner agent link removed'; END IF;

  step := 'one audit row, with an erasure actor that is not the owner id hash';
  SELECT count(*) INTO n FROM register_audit WHERE id > audit_before;
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: % audit rows written, expected 1', n; END IF;
  SELECT count(*) INTO n FROM register_audit WHERE id > audit_before AND actor = actor_a;
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: audit row keyed by the owner id hash'; END IF;

  step := 'second delete of a is a no-op: false, and no audit row';
  IF register_account_delete(hash_a) THEN
    RAISE EXCEPTION 'account delete: second delete returned true';
  END IF;
  SELECT count(*) INTO n FROM register_audit WHERE id > audit_before;
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: second delete wrote an audit row'; END IF;

  step := 'banned c: true; the tombstone keeps the hash and the ban with no owner; sign-in finds it banned';
  IF NOT register_account_delete(hash_c) THEN
    RAISE EXCEPTION 'account delete: banned identity delete returned false';
  END IF;
  SELECT i.owner_id, i.banned_at IS NOT NULL AS banned INTO STRICT r FROM mcp_identities i WHERE i.identity_hash = hash_c;
  IF r.owner_id IS NOT NULL OR NOT r.banned THEN RAISE EXCEPTION 'account delete: tombstone wrong'; END IF;
  SELECT count(*) INTO n FROM mcp_owners WHERE owner_id = 'reg-del-c';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: banned owner row kept'; END IF;
  -- The append-only triggers are disabled inside the function and enabled again before it returns (0039). A failure
  -- part way through (here: after the disable, before the enable) must roll the disable back, so the triggers stay
  -- enabled ('O'; 'D' is disabled). The same statements run with a forced error, inside a subtransaction.
  BEGIN
    ALTER TABLE public.mcp_journal DISABLE TRIGGER mcp_journal_append_only;
    ALTER TABLE public.thoughts DISABLE TRIGGER thoughts_append_only;
    RAISE EXCEPTION 'account delete: forced failure after the disable';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;
  SELECT count(*) INTO n FROM pg_trigger t
    WHERE t.tgname IN ('mcp_journal_append_only', 'thoughts_append_only') AND t.tgenabled = 'O';
  IF n <> 2 THEN RAISE EXCEPTION 'account delete: a forced failure left an append-only trigger disabled'; END IF;
  SELECT f.banned INTO STRICT banned_val FROM register_find_owner(hash_c) f;
  IF NOT banned_val THEN RAISE EXCEPTION 'account delete: tombstone not seen as banned'; END IF;

  step := 'unbanned a: no identity left, so a sign-in finds no owner';
  SELECT count(*) INTO n FROM register_find_owner(hash_a);
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: unbanned hash left behind'; END IF;
END
$account_delete$;
