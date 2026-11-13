-- Migration 0026 (C7-02b, decision 0170 point 2): behaviour of the owner API key functions. Run after
-- check-schema.sql. The fixture keys are written by the superuser; every call runs under geldar_register.
DO $owner_keys$
DECLARE
  step TEXT;
  refused BOOLEAN;
  exp TIMESTAMPTZ;
  n INT;
  found BOOLEAN;
  ok_expiry BOOLEAN;
  actor_a TEXT := left(encode(sha256(convert_to('reg-ok-a', 'UTF8')), 'hex'), 16);
  actor_d TEXT := left(encode(sha256(convert_to('reg-ok-d', 'UTF8')), 'hex'), 16);
BEGIN
  step := 'fixture: owners a, b, d (admin) and c (banned identity)';
  INSERT INTO mcp_owners (owner_id, display, player_cap, is_admin) VALUES
    ('reg-ok-a', 'a', 5, false), ('reg-ok-b', 'b', 5, false), ('reg-ok-c', 'c', 5, false),
    ('reg-ok-d', 'd', 5, true);
  INSERT INTO mcp_identities (identity_hash, provider, owner_id, banned_at) VALUES
    (decode(repeat('01', 32), 'hex'), 'microsoft', 'reg-ok-a', NULL),
    (decode(repeat('02', 32), 'hex'), 'microsoft', 'reg-ok-b', NULL),
    (decode(repeat('03', 32), 'hex'), 'microsoft', 'reg-ok-c', now()),
    (decode(repeat('04', 32), 'hex'), 'microsoft', 'reg-ok-d', NULL);

  step := 'fixture: keys (a1 manage, a2 read only, a3 expired, a4 revoked, a5 expires now(), b1, c1 banned owner, d1 admin)';
  INSERT INTO owner_api_keys (key_id, owner_id, key_hash, scopes, expires_at, revoked_at) VALUES
    ('gok-00000000000000a1', 'reg-ok-a', decode(repeat('a1', 32), 'hex'), ARRAY['read', 'body', 'manage'], now() + interval '90 days', NULL),
    ('gok-00000000000000a2', 'reg-ok-a', decode(repeat('a2', 32), 'hex'), ARRAY['read'], now() + interval '90 days', NULL),
    ('gok-00000000000000a3', 'reg-ok-a', decode(repeat('a3', 32), 'hex'), ARRAY['manage'], now() - interval '1 second', NULL),
    ('gok-00000000000000a4', 'reg-ok-a', decode(repeat('a4', 32), 'hex'), ARRAY['manage'], now() + interval '90 days', now()),
    ('gok-00000000000000a5', 'reg-ok-a', decode(repeat('a5', 32), 'hex'), ARRAY['manage'], now(), NULL),
    ('gok-00000000000000b1', 'reg-ok-b', decode(repeat('b1', 32), 'hex'), ARRAY['manage'], now() + interval '90 days', NULL),
    ('gok-00000000000000c1', 'reg-ok-c', decode(repeat('c1', 32), 'hex'), ARRAY['manage'], now() + interval '90 days', NULL),
    ('gok-00000000000000d1', 'reg-ok-d', decode(repeat('d1', 32), 'hex'), ARRAY['manage'], now() + interval '90 days', NULL);

  step := 'schema: a bad scope is refused by the table';
  refused := false;
  BEGIN
    INSERT INTO owner_api_keys (key_id, owner_id, key_hash, scopes, expires_at)
      VALUES ('gok-00000000000000ff', 'reg-ok-a', decode(repeat('ff', 32), 'hex'), ARRAY['admin'], now() + interval '1 day');
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check (%): the table accepted a scope outside read, body, manage', step;
  END IF;

  step := 'grant: register role may run the three key functions and reads no key table';
  IF NOT has_function_privilege('geldar_register', 'register_mint_owner_key(bytea, text, bytea, text[])', 'EXECUTE')
     OR NOT has_function_privilege('geldar_register', 'register_revoke_owner_key(bytea, text)', 'EXECUTE')
     OR NOT has_function_privilege('geldar_register', 'register_list_owner_keys(bytea)', 'EXECUTE')
     OR NOT has_function_privilege('geldar_register', 'register_owner_key_resolve(bytea)', 'EXECUTE') THEN
    RAISE EXCEPTION 'schema check (%): geldar_register must execute the owner key functions', step;
  END IF;
  IF has_table_privilege('geldar_register', 'owner_api_keys', 'SELECT')
     OR has_table_privilege('geldar_register', 'owner_api_keys', 'INSERT')
     OR has_table_privilege('geldar_register', 'owner_api_keys', 'UPDATE') THEN
    RAISE EXCEPTION 'schema check (%): geldar_register must not read or write owner_api_keys directly', step;
  END IF;

  SET LOCAL ROLE geldar_register;

  step := 'mint: a manage key mints a 90 day key (expiry = created + 90 days)';
  SELECT register_mint_owner_key(decode(repeat('a1', 32), 'hex'), 'gok-0000000000000e01',
    decode(repeat('e1', 32), 'hex'), ARRAY['read', 'body']) INTO exp;
  IF exp IS NULL THEN
    RAISE EXCEPTION 'schema check (%): a live manage key was refused', step;
  END IF;

  step := 'mint: a key without manage is refused with 42501 and mints nothing';
  refused := false;
  BEGIN
    PERFORM register_mint_owner_key(decode(repeat('a2', 32), 'hex'), 'gok-0000000000000e02',
      decode(repeat('e2', 32), 'hex'), ARRAY['read']);
  EXCEPTION WHEN insufficient_privilege THEN refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check (%): a read-only key minted a key', step;
  END IF;

  step := 'mint: a banned owner, an expired key, a revoked key and a key at its expiry instant are refused (NULL)';
  IF register_mint_owner_key(decode(repeat('c1', 32), 'hex'), 'gok-0000000000000e03', decode(repeat('e3', 32), 'hex'), ARRAY['read']) IS NOT NULL
     OR register_mint_owner_key(decode(repeat('a3', 32), 'hex'), 'gok-0000000000000e04', decode(repeat('e4', 32), 'hex'), ARRAY['read']) IS NOT NULL
     OR register_mint_owner_key(decode(repeat('a4', 32), 'hex'), 'gok-0000000000000e05', decode(repeat('e5', 32), 'hex'), ARRAY['read']) IS NOT NULL
     OR register_mint_owner_key(decode(repeat('a5', 32), 'hex'), 'gok-0000000000000e06', decode(repeat('e6', 32), 'hex'), ARRAY['read']) IS NOT NULL THEN
    RAISE EXCEPTION 'schema check (%): a refused presenter minted a key', step;
  END IF;

  step := 'mint: a duplicate hash raises and leaves no row';
  refused := false;
  BEGIN
    PERFORM register_mint_owner_key(decode(repeat('a1', 32), 'hex'), 'gok-0000000000000e07',
      decode(repeat('e1', 32), 'hex'), ARRAY['read']);
  EXCEPTION WHEN unique_violation THEN refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check (%): a duplicate key hash was accepted', step;
  END IF;

  step := 'mint: the admin mints and the audit row says admin';
  SELECT register_mint_owner_key(decode(repeat('d1', 32), 'hex'), 'gok-00000000000000ad',
    decode(repeat('ad', 32), 'hex'), ARRAY['manage']) INTO exp;
  IF exp IS NULL THEN
    RAISE EXCEPTION 'schema check (%): the admin key was refused', step;
  END IF;

  step := 'revoke: another owner key id is not found (FALSE) and stays live';
  IF register_revoke_owner_key(decode(repeat('b1', 32), 'hex'), 'gok-00000000000000a1') IS NOT FALSE THEN
    RAISE EXCEPTION 'schema check (%): owner b revoked a key of owner a', step;
  END IF;

  step := 'revoke: a manage key revokes a sibling key (TRUE); that key is refused at once';
  IF register_revoke_owner_key(decode(repeat('a1', 32), 'hex'), 'gok-00000000000000a2') IS NOT TRUE THEN
    RAISE EXCEPTION 'schema check (%): the owner could not revoke its own key', step;
  END IF;
  SELECT count(*) INTO n FROM register_list_owner_keys(decode(repeat('a2', 32), 'hex'));
  IF n <> 0 THEN
    RAISE EXCEPTION 'schema check (%): a revoked key still lists', step;
  END IF;
  IF register_revoke_owner_key(decode(repeat('a2', 32), 'hex'), 'gok-00000000000000a1') IS NOT NULL THEN
    RAISE EXCEPTION 'schema check (%): a revoked key still acts', step;
  END IF;

  step := 'list: the owner sees its six keys; an expired key lists nothing';
  SELECT count(*) INTO n FROM register_list_owner_keys(decode(repeat('a1', 32), 'hex'));
  IF n <> 6 THEN
    RAISE EXCEPTION 'schema check (%): owner a listed % keys, expected 6', step, n;
  END IF;
  SELECT count(*) INTO n FROM register_list_owner_keys(decode(repeat('a3', 32), 'hex'));
  IF n <> 0 THEN
    RAISE EXCEPTION 'schema check (%): an expired key listed', step;
  END IF;

  RESET ROLE;

  step := 'boundary: the minted key expires at created_at + 90 days; a key at its expiry instant is refused';
  SELECT (expires_at = created_at + interval '90 days') INTO ok_expiry FROM owner_api_keys WHERE key_id = 'gok-0000000000000e01';
  IF NOT coalesce(ok_expiry, false) THEN
    RAISE EXCEPTION 'schema check (%): the minted key lifetime is not 90 days', step;
  END IF;

  step := 'rows: the refused and duplicate mints wrote no key row';
  SELECT count(*) INTO n FROM owner_api_keys WHERE key_id IN ('gok-0000000000000e02', 'gok-0000000000000e03',
    'gok-0000000000000e04', 'gok-0000000000000e05', 'gok-0000000000000e06', 'gok-0000000000000e07');
  IF n <> 0 THEN
    RAISE EXCEPTION 'schema check (%): % refused or duplicate mints left a row', step, n;
  END IF;

  step := 'audit: one key.mint row for the minted key (admin false) and one for the admin key (admin true)';
  SELECT count(*) INTO n FROM register_audit WHERE action = 'key.mint' AND target = 'gok-0000000000000e01' AND actor = actor_a AND admin = false;
  IF n <> 1 THEN
    RAISE EXCEPTION 'schema check (%): expected 1 key.mint row for e01, found %', step, n;
  END IF;
  SELECT count(*) INTO n FROM register_audit WHERE action = 'key.mint' AND target = 'gok-00000000000000ad' AND actor = actor_d AND admin = true;
  IF n <> 1 THEN
    RAISE EXCEPTION 'schema check (%): expected 1 admin key.mint row, found %', step, n;
  END IF;

  step := 'audit: the revoke wrote one key.revoke row; each refused use wrote one key.use row with its reason';
  SELECT count(*) INTO n FROM register_audit WHERE action = 'key.revoke' AND target = 'gok-00000000000000a2' AND actor = actor_a;
  IF n <> 1 THEN
    RAISE EXCEPTION 'schema check (%): expected 1 key.revoke row, found %', step, n;
  END IF;
  SELECT count(*) INTO n FROM register_audit
    WHERE action = 'key.use' AND outcome IN ('refused_banned', 'refused_expired', 'refused_revoked')
      AND target IN ('gok-00000000000000c1', 'gok-00000000000000a3', 'gok-00000000000000a4', 'gok-00000000000000a5');
  IF n < 4 THEN
    RAISE EXCEPTION 'schema check (%): expected 4 refused key.use rows, found %', step, n;
  END IF;

  step := 'store: the key value is never a column; the hash is bytea; the listing has no hash column';
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'owner_api_keys' AND column_name IN ('value', 'secret', 'key', 'token')) INTO found;
  IF found OR NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'owner_api_keys' AND column_name = 'key_hash' AND data_type = 'bytea') THEN
    RAISE EXCEPTION 'schema check (%): owner_api_keys stores a value column or no bytea hash', step;
  END IF;
  IF position('key_hash' IN pg_get_function_result('register_list_owner_keys(bytea)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'schema check (%): the listing returns a hash', step;
  END IF;

  step := 'use: a successful use stamps last_used_at';
  IF (SELECT last_used_at FROM owner_api_keys WHERE key_id = 'gok-00000000000000a1') IS NULL THEN
    RAISE EXCEPTION 'schema check (%): last_used_at was not stamped', step;
  END IF;

  RAISE NOTICE 'schema check passed: the owner API key functions apply decision 0170 point 2';
END
$owner_keys$;
