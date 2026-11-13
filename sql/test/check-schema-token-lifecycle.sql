-- Migration 0032 (C7-02a): the token lifecycle functions and their grants.
-- Run after sql/test/check-schema.sql, on the same migrated database. Every probe rolls back.
-- UNRUN in the coder's environment (psql not installed locally); CI runs it.
DO $token_lifecycle$
DECLARE
  step TEXT;
  refused BOOLEAN;
BEGIN
  step := 'grant: register role may run the four token functions';
  IF NOT has_function_privilege('geldar_register', 'register_renew_token(bytea, text, text, bytea, timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('geldar_register', 'register_revoke_tokens(bytea, text)', 'EXECUTE')
     OR NOT has_function_privilege('geldar_register', 'register_token_info(bytea, text)', 'EXECUTE')
     OR NOT has_function_privilege('geldar_register', 'register_mint_token(bytea, text, text, bytea)', 'EXECUTE') THEN
    RAISE EXCEPTION 'schema check (%): geldar_register must execute the token lifecycle functions', step;
  END IF;

  step := 'grant: register role cannot write expires_at or read the token table directly';
  IF has_column_privilege('geldar_register', 'mcp_tokens', 'expires_at', 'UPDATE')
     OR has_table_privilege('geldar_register', 'mcp_tokens', 'UPDATE')
     OR has_column_privilege('geldar_register', 'mcp_tokens', 'last_used_at', 'SELECT') THEN
    RAISE EXCEPTION 'schema check (%): geldar_register must not update expires_at or read last_used_at directly', step;
  END IF;

  step := 'renew: an unknown identity is refused (42501), nothing is minted';
  refused := false;
  BEGIN
    PERFORM register_renew_token(decode(repeat('00', 32), 'hex'), 'ag-no-such-player', 'tok-no-such', decode(repeat('d4', 32), 'hex'), now() + interval '10 minutes');
  EXCEPTION WHEN insufficient_privilege THEN refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check (%): renew accepted an unknown identity', step;
  END IF;

  step := 'revoke: an unknown identity is refused (42501)';
  refused := false;
  BEGIN
    PERFORM register_revoke_tokens(decode(repeat('00', 32), 'hex'), 'ag-no-such-player');
  EXCEPTION WHEN insufficient_privilege THEN refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check (%): revoke accepted an unknown identity', step;
  END IF;

  step := 'info: an unknown identity is refused (42501)';
  refused := false;
  BEGIN
    PERFORM * FROM register_token_info(decode(repeat('00', 32), 'hex'), 'ag-no-such-player');
  EXCEPTION WHEN insufficient_privilege THEN refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check (%): token info read an unknown identity', step;
  END IF;
END
$token_lifecycle$;

-- Wave C7-1 fix A (F3): the DB-level owner, ban, retire and expiry rules, and the atomic renew audit.
-- One transaction, rolled back at the end. The fixtures are written by the migrating superuser; every
-- register call runs under SET LOCAL ROLE geldar_register. Owner A: ag-tl-a-01 (live), ag-tl-a-02
-- (retired), ag-tl-a-03 (no token). Owner B: ag-tl-b-01 (live). Owner C: banned identity, ag-tl-c-01 (live).
BEGIN;

-- Runs one register call as the caller's role and passes only if it is refused with 42501.
CREATE FUNCTION tl_expect_42501(stmt TEXT) RETURNS VOID
LANGUAGE plpgsql AS $tl_expect$
BEGIN
  EXECUTE stmt;
  RAISE EXCEPTION 'token lifecycle probe: the call was accepted: %', stmt;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN;
END
$tl_expect$;

DO $token_lifecycle_fix_a$
DECLARE
  step TEXT;
  n BIGINT;
  ok BOOLEAN := false;
  snap_before TEXT;
  snap_after TEXT;
  a_hash CONSTANT BYTEA := decode(repeat('e1', 32), 'hex');
  b_hash CONSTANT BYTEA := decode(repeat('e2', 32), 'hex');
  c_hash CONSTANT BYTEA := decode(repeat('e3', 32), 'hex');
  h1 CONSTANT BYTEA := decode(repeat('f1', 32), 'hex');
  h2 CONSTANT BYTEA := decode(repeat('f2', 32), 'hex');
  h3 CONSTANT BYTEA := decode(repeat('f3', 32), 'hex');
  h4 CONSTANT BYTEA := decode(repeat('f4', 32), 'hex');
  h5 CONSTANT BYTEA := decode(repeat('f5', 32), 'hex');
  h6 CONSTANT BYTEA := decode(repeat('f6', 32), 'hex');
BEGIN
  step := 'fixture: owners, identities, agents, players, live tokens';
  INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES ('reg-tl-a', 'a', 5), ('reg-tl-b', 'b', 5), ('reg-tl-c', 'c', 5);
  INSERT INTO mcp_identities (identity_hash, provider, owner_id, banned_at) VALUES
    (a_hash, 'microsoft', 'reg-tl-a', NULL),
    (b_hash, 'microsoft', 'reg-tl-b', NULL),
    (c_hash, 'microsoft', 'reg-tl-c', now());
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
                      declared_model, model_config, tier, personality_seed, public_camera)
    VALUES ('ag_tl_a1', 'tla1', 1, 'ag_tl_a1', 'test', 'sovereign', 'reg-tl-a', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE),
           ('ag_tl_a2', 'tla2', 1, 'ag_tl_a2', 'test', 'sovereign', 'reg-tl-a', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE),
           ('ag_tl_a3', 'tla3', 1, 'ag_tl_a3', 'test', 'sovereign', 'reg-tl-a', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE),
           ('ag_tl_b1', 'tlb1', 1, 'ag_tl_b1', 'test', 'sovereign', 'reg-tl-b', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE),
           ('ag_tl_c1', 'tlc1', 1, 'ag_tl_c1', 'test', 'sovereign', 'reg-tl-c', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE);
  INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status) VALUES
    ('ag-tl-a-01', 'reg-tl-a', 'ag_tl_a1', 'tla1', 'claude-code', 'active'),
    ('ag-tl-a-02', 'reg-tl-a', 'ag_tl_a2', 'tla2', 'claude-code', 'retired'),
    ('ag-tl-a-03', 'reg-tl-a', 'ag_tl_a3', 'tla3', 'claude-code', 'active'),
    ('ag-tl-b-01', 'reg-tl-b', 'ag_tl_b1', 'tlb1', 'claude-code', 'active'),
    ('ag-tl-c-01', 'reg-tl-c', 'ag_tl_c1', 'tlc1', 'claude-code', 'active');
  INSERT INTO mcp_tokens (token_id, player_id, token_hash, expires_at) VALUES
    ('tok-tl-a-ret', 'ag-tl-a-02', h3, now() + interval '90 days'),
    ('tok-tl-b-01', 'ag-tl-b-01', h4, now() + interval '90 days'),
    ('tok-tl-c-01', 'ag-tl-c-01', h5, now() + interval '90 days');

  -- 0025 mint: 90 days from now, as the register role
  step := 'mint: a mint expires at now() + 90 days';
  SET LOCAL ROLE geldar_register;
  PERFORM register_mint_token(a_hash, 'ag-tl-a-01', 'tok-tl-a-01', h1);
  RESET ROLE;
  SELECT expires_at = now() + interval '90 days' INTO ok FROM mcp_tokens WHERE token_id = 'tok-tl-a-01';
  IF NOT coalesce(ok, false) THEN
    RAISE EXCEPTION 'schema check (%): a mint does not expire at now() + 90 days', step;
  END IF;

  -- renewal: the old token keeps 600 to 601 seconds, even when the caller asks for a one day grace
  step := 'renew: the old token keeps 600 to 601 seconds with a one day grace';
  SET LOCAL ROLE geldar_register;
  PERFORM register_renew_token(a_hash, 'ag-tl-a-01', 'tok-tl-a-02', h2, now() + interval '1 day');
  RESET ROLE;
  SELECT extract(epoch FROM (expires_at - now())) BETWEEN 600 AND 601 INTO ok
    FROM mcp_tokens WHERE token_id = 'tok-tl-a-01';
  IF NOT coalesce(ok, false) THEN
    RAISE EXCEPTION 'schema check (%): the old token did not keep 600 to 601 seconds', step;
  END IF;
  SELECT expires_at = now() + interval '90 days' INTO ok FROM mcp_tokens WHERE token_id = 'tok-tl-a-02';
  IF NOT coalesce(ok, false) THEN
    RAISE EXCEPTION 'schema check (%): the renewed token does not expire at now() + 90 days', step;
  END IF;
  SELECT count(*) INTO n FROM register_audit
    WHERE target = 'ag-tl-a-01' AND action = 'token.renew' AND outcome = 'renewed' AND admin = false;
  IF n <> 1 THEN
    RAISE EXCEPTION 'schema check (%): a renewal wrote % audit rows, expected 1', step, n;
  END IF;
  -- the actor is the owner id hash (0025 header), the same form the supervisor writes
  step := 'audit: the renewal actor is the owner id hash, not the raw owner id';
  SELECT count(*) INTO n FROM register_audit
    WHERE target = 'ag-tl-a-01' AND action = 'token.renew'
      AND actor = left(encode(sha256(convert_to((SELECT i.owner_id FROM mcp_identities i WHERE i.identity_hash = a_hash), 'UTF8')), 'hex'), 16);
  IF n <> 1 THEN
    RAISE EXCEPTION 'schema check (%): the renewal actor is not the owner id hash', step;
  END IF;

  -- refusals: each is 42501 and stores no token
  step := 'refusals: another owner player, banned identity, retired player, no live token';
  SET LOCAL ROLE geldar_register;
  PERFORM tl_expect_42501(format('SELECT register_renew_token(%L, %L, %L, %L, now() + interval ''1 day'')', a_hash, 'ag-tl-b-01', 'tok-tl-x', h6));
  PERFORM tl_expect_42501(format('SELECT register_revoke_tokens(%L, %L)', a_hash, 'ag-tl-b-01'));
  PERFORM tl_expect_42501(format('SELECT count(*) FROM register_token_info(%L, %L)', a_hash, 'ag-tl-b-01'));
  PERFORM tl_expect_42501(format('SELECT register_renew_token(%L, %L, %L, %L, now() + interval ''1 day'')', c_hash, 'ag-tl-c-01', 'tok-tl-x', h6));
  PERFORM tl_expect_42501(format('SELECT register_revoke_tokens(%L, %L)', c_hash, 'ag-tl-c-01'));
  PERFORM tl_expect_42501(format('SELECT register_renew_token(%L, %L, %L, %L, now() + interval ''1 day'')', a_hash, 'ag-tl-a-02', 'tok-tl-x', h6));
  PERFORM tl_expect_42501(format('SELECT register_renew_token(%L, %L, %L, %L, now() + interval ''1 day'')', a_hash, 'ag-tl-a-03', 'tok-tl-x', h6));
  RESET ROLE;
  SELECT count(*) INTO n FROM mcp_tokens WHERE token_id = 'tok-tl-x';
  IF n <> 0 THEN
    RAISE EXCEPTION 'schema check (%): a refused call stored a token', step;
  END IF;

  -- atomic audit: a register_audit insert that raises rolls the renewal back, the old expiries stay
  step := 'atomic audit: a failing register_audit insert rolls the renewal back';
  CREATE FUNCTION tl_refuse_audit() RETURNS TRIGGER
  LANGUAGE plpgsql AS $tl_refuse$
  BEGIN
    RAISE EXCEPTION 'tl probe: audit refused' USING ERRCODE = 'check_violation';
  END
  $tl_refuse$;
  CREATE TRIGGER tl_refuse_audit BEFORE INSERT ON register_audit
    FOR EACH ROW EXECUTE FUNCTION tl_refuse_audit();
  SELECT string_agg(token_id || '=' || expires_at::text, ',' ORDER BY token_id) INTO snap_before
    FROM mcp_tokens WHERE player_id = 'ag-tl-a-01';
  ok := false;
  SET LOCAL ROLE geldar_register;
  BEGIN
    PERFORM register_renew_token(a_hash, 'ag-tl-a-01', 'tok-tl-x', h6, now() + interval '1 day');
  EXCEPTION WHEN OTHERS THEN
    ok := SQLERRM LIKE '%tl probe: audit refused%';
  END;
  RESET ROLE;
  IF NOT ok THEN
    RAISE EXCEPTION 'schema check (%): the renewal was not refused by the failing audit insert', step;
  END IF;
  SELECT string_agg(token_id || '=' || expires_at::text, ',' ORDER BY token_id) INTO snap_after
    FROM mcp_tokens WHERE player_id = 'ag-tl-a-01';
  IF snap_after IS DISTINCT FROM snap_before THEN
    RAISE EXCEPTION 'schema check (%): an expiry changed although the audit insert failed', step;
  END IF;
  SELECT count(*) INTO n FROM mcp_tokens WHERE token_id = 'tok-tl-x';
  IF n <> 0 THEN
    RAISE EXCEPTION 'schema check (%): a renewal whose audit failed stored a token', step;
  END IF;
  DROP TRIGGER tl_refuse_audit ON register_audit;
  DROP FUNCTION tl_refuse_audit();
  DROP FUNCTION tl_expect_42501(TEXT);
END
$token_lifecycle_fix_a$;

ROLLBACK;
