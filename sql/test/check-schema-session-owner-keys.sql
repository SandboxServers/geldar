-- Migration 0035 (C7-04b-3, decision 0173): behaviour of the cookie-session owner key functions. Run after
-- check-schema-owner-keys.sql. Fixtures are written by the superuser; every call runs under geldar_register.
DO $session_keys$
DECLARE
  step TEXT;
  refused BOOLEAN;
  denied BOOLEAN;
  exp TIMESTAMPTZ;
  n INT;
  hit BOOLEAN;
  h_a BYTEA := decode(repeat('e1', 32), 'hex');
  h_b BYTEA := decode(repeat('e2', 32), 'hex');
  h_c BYTEA := decode(repeat('e3', 32), 'hex');
  h_e BYTEA := decode(repeat('e5', 32), 'hex');
  h_f BYTEA := decode(repeat('e6', 32), 'hex');
  h_none BYTEA := decode(repeat('ee', 32), 'hex');
  actor_a TEXT := left(encode(sha256(convert_to('sess-a', 'UTF8')), 'hex'), 16);
BEGIN
  step := 'fixture: owners a, b, c (banned), e (9 live keys), f (admin, 10 live keys)';
  INSERT INTO mcp_owners (owner_id, display, player_cap, is_admin) VALUES
    ('sess-a', 'a', 5, false), ('sess-b', 'b', 5, false), ('sess-c', 'c', 5, false),
    ('sess-e', 'e', 5, false), ('sess-f', 'f', 5, true);
  INSERT INTO mcp_identities (identity_hash, provider, owner_id, banned_at) VALUES
    (h_a, 'microsoft', 'sess-a', NULL), (h_b, 'microsoft', 'sess-b', NULL),
    (h_c, 'microsoft', 'sess-c', now()), (h_e, 'microsoft', 'sess-e', NULL),
    (h_f, 'microsoft', 'sess-f', NULL);

  step := 'fixture: key 5b01 (owner b), keys 5e01-5e09 live, 5e0a revoked, 5e0b expired (owner e), 5f01-5f0a live admin keys (owner f)';
  INSERT INTO owner_api_keys (key_id, owner_id, key_hash, scopes, expires_at, revoked_at)
    VALUES ('gok-0000000000005b01', 'sess-b', sha256(convert_to('gok-0000000000005b01', 'UTF8')),
      ARRAY['manage'], now() + interval '90 days', NULL);
  INSERT INTO owner_api_keys (key_id, owner_id, key_hash, scopes, expires_at, revoked_at)
    SELECT 'gok-0000000000005e' || lpad(to_hex(i), 2, '0'), 'sess-e',
      sha256(convert_to('gok-0000000000005e' || lpad(to_hex(i), 2, '0'), 'UTF8')), ARRAY['manage'],
      now() + interval '90 days', NULL
    FROM generate_series(1, 9) AS g(i);
  INSERT INTO owner_api_keys (key_id, owner_id, key_hash, scopes, expires_at, revoked_at) VALUES
    ('gok-0000000000005e0a', 'sess-e', sha256(convert_to('gok-0000000000005e0a', 'UTF8')), ARRAY['manage'],
      now() + interval '90 days', now()),
    ('gok-0000000000005e0b', 'sess-e', sha256(convert_to('gok-0000000000005e0b', 'UTF8')), ARRAY['manage'],
      now() - interval '1 second', NULL);
  INSERT INTO owner_api_keys (key_id, owner_id, key_hash, scopes, expires_at)
    SELECT 'gok-0000000000005f' || lpad(to_hex(i), 2, '0'), 'sess-f',
      sha256(convert_to('gok-0000000000005f' || lpad(to_hex(i), 2, '0'), 'UTF8')), ARRAY['manage'],
      now() + interval '90 days'
    FROM generate_series(1, 10) AS g(i);

  step := 'grants: geldar_register executes the three functions; PUBLIC, geldar_mcp and geldar_supervisor do not';
  IF NOT (has_function_privilege('geldar_register', 'register_session_mint_owner_key(bytea,text,bytea,text[])', 'EXECUTE')
     AND has_function_privilege('geldar_register', 'register_session_list_owner_keys(bytea)', 'EXECUTE')
     AND has_function_privilege('geldar_register', 'register_session_revoke_owner_key(bytea,text)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'schema check (%): geldar_register must execute the session owner key functions', step;
  END IF;
  IF has_function_privilege('geldar_mcp', 'register_session_mint_owner_key(bytea,text,bytea,text[])', 'EXECUTE')
     OR has_function_privilege('geldar_mcp', 'register_session_list_owner_keys(bytea)', 'EXECUTE')
     OR has_function_privilege('geldar_mcp', 'register_session_revoke_owner_key(bytea,text)', 'EXECUTE')
     OR has_function_privilege('geldar_supervisor', 'register_session_mint_owner_key(bytea,text,bytea,text[])', 'EXECUTE')
     OR has_function_privilege('geldar_supervisor', 'register_session_list_owner_keys(bytea)', 'EXECUTE')
     OR has_function_privilege('geldar_supervisor', 'register_session_revoke_owner_key(bytea,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'schema check (%): geldar_mcp and geldar_supervisor must not execute the session owner key functions', step;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             WHERE p.proname LIKE 'register\_session\_%' AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'schema check (%): PUBLIC must not execute the session owner key functions', step;
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.proname LIKE 'register\_session\_%owner\_key%' AND p.prosecdef
      AND p.proconfig::text LIKE '%search_path=pg_catalog, public, pg_temp%') <> 3 THEN
    RAISE EXCEPTION 'schema check (%): the session owner key functions must be definer-owned with a pinned search_path', step;
  END IF;

  SET LOCAL ROLE geldar_register;

  step := 'mint by identity: a session mints a read key and an all-scope key; expiry is 90 days';
  exp := register_session_mint_owner_key(h_a, 'gok-0000000000005001', sha256(convert_to('gok-0000000000005001', 'UTF8')), ARRAY['read']);
  PERFORM register_session_mint_owner_key(h_a, 'gok-0000000000005002', sha256(convert_to('gok-0000000000005002', 'UTF8')),
    ARRAY['read', 'body', 'manage']);
  RESET ROLE;
  IF exp IS NULL OR exp < now() + interval '89 days' OR exp > now() + interval '91 days' THEN
    RAISE EXCEPTION 'schema check (%): the minted key must expire in 90 days', step;
  END IF;
  IF (SELECT count(*) FROM owner_api_keys WHERE owner_id = 'sess-a' AND revoked_at IS NULL) <> 2 THEN
    RAISE EXCEPTION 'schema check (%): the mint must write the key under the session owner', step;
  END IF;
  SET LOCAL ROLE geldar_register;

  step := 'list: a session sees only its own keys, and a foreign session sees only its own';
  SELECT count(*) INTO n FROM register_session_list_owner_keys(h_a);
  IF n <> 2 THEN
    RAISE EXCEPTION 'schema check (%): owner a must list its two keys, saw %', step, n;
  END IF;
  SELECT count(*) INTO n FROM register_session_list_owner_keys(h_b)
    WHERE key_id IN ('gok-0000000000005001', 'gok-0000000000005002');
  IF n <> 0 THEN
    RAISE EXCEPTION 'schema check (%): owner b must not list owner a keys', step;
  END IF;

  step := 'revoke: a foreign identity cannot revoke another owner key';
  hit := register_session_revoke_owner_key(h_b, 'gok-0000000000005001');
  IF hit THEN
    RAISE EXCEPTION 'schema check (%): a foreign session revoked another owner key', step;
  END IF;

  step := 'revoke: the owner revokes its own key, once';
  hit := register_session_revoke_owner_key(h_a, 'gok-0000000000005002');
  IF NOT hit THEN
    RAISE EXCEPTION 'schema check (%): the owner must revoke its own live key', step;
  END IF;
  IF register_session_revoke_owner_key(h_a, 'gok-0000000000005002') THEN
    RAISE EXCEPTION 'schema check (%): a revoked key must not be revoked again', step;
  END IF;

  step := 'banned and unknown identities are refused (42501) by mint, list and revoke';
  refused := false;
  BEGIN
    PERFORM register_session_mint_owner_key(h_c, 'gok-0000000000005c01', sha256(convert_to('gok-0000000000005c01', 'UTF8')), ARRAY['read']);
  EXCEPTION WHEN sqlstate '42501' THEN refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check (%): a banned identity must not mint', step;
  END IF;
  refused := false;
  BEGIN
    PERFORM * FROM register_session_list_owner_keys(h_c);
  EXCEPTION WHEN sqlstate '42501' THEN refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check (%): a banned identity must not list, and a refusal must not read as an empty list', step;
  END IF;
  refused := false;
  BEGIN
    PERFORM register_session_revoke_owner_key(h_c, 'gok-0000000000005b01');
  EXCEPTION WHEN sqlstate '42501' THEN refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check (%): a banned identity must not revoke', step;
  END IF;
  refused := false;
  BEGIN
    PERFORM * FROM register_session_list_owner_keys(h_none);
  EXCEPTION WHEN sqlstate '42501' THEN refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check (%): an unknown identity must not list', step;
  END IF;

  step := 'cap: owner e has 9 live keys, so the 10th mint passes and the 11th is refused (53400)';
  PERFORM register_session_mint_owner_key(h_e, 'gok-0000000000005e0c', sha256(convert_to('gok-0000000000005e0c', 'UTF8')), ARRAY['read']);
  refused := false;
  BEGIN
    PERFORM register_session_mint_owner_key(h_e, 'gok-0000000000005e0d', sha256(convert_to('gok-0000000000005e0d', 'UTF8')), ARRAY['read']);
  EXCEPTION WHEN sqlstate '53400' THEN refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check (%): the 11th live key must be refused with live_key_cap', step;
  END IF;

  step := 'cap: an admin with 10 live keys is refused too';
  refused := false;
  BEGIN
    PERFORM register_session_mint_owner_key(h_f, 'gok-0000000000005f0b', sha256(convert_to('gok-0000000000005f0b', 'UTF8')), ARRAY['read']);
  EXCEPTION WHEN sqlstate '53400' THEN refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check (%): the cap must apply to admins', step;
  END IF;

  step := 'a scope outside read, body, manage is refused by the table (23514)';
  refused := false;
  BEGIN
    PERFORM register_session_mint_owner_key(h_a, 'gok-0000000000005a09', sha256(convert_to('gok-0000000000005a09', 'UTF8')), ARRAY['admin']);
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check (%): a scope outside the three must be refused', step;
  END IF;

  step := 'a role without EXECUTE gets insufficient_privilege (42501)';
  RESET ROLE;
  SET LOCAL ROLE geldar_mcp;
  denied := false;
  BEGIN
    PERFORM * FROM register_session_list_owner_keys(h_a);
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  RESET ROLE;
  IF NOT denied THEN
    RAISE EXCEPTION 'schema check (%): geldar_mcp must not reach the session list', step;
  END IF;

  step := 'audit: the mint and the revoke write rows with the owner actor and no key value';
  IF NOT EXISTS (SELECT 1 FROM register_audit WHERE actor = actor_a AND action = 'key.mint'
                   AND target = 'gok-0000000000005002' AND outcome = 'minted') THEN
    RAISE EXCEPTION 'schema check (%): the session mint must write its audit row', step;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM register_audit WHERE actor = actor_a AND action = 'key.revoke'
                   AND target = 'gok-0000000000005002' AND outcome = 'revoked') THEN
    RAISE EXCEPTION 'schema check (%): the session revoke must write its audit row', step;
  END IF;
  IF EXISTS (SELECT 1 FROM register_audit r JOIN owner_api_keys ok ON ok.key_id = r.target
             WHERE r.action LIKE 'key.%' AND ok.owner_id IN ('sess-a', 'sess-b', 'sess-e', 'sess-f', 'sess-c')
               AND (position(encode(ok.key_hash, 'hex') IN r.target) > 0 OR position(encode(ok.key_hash, 'hex') IN r.outcome) > 0)) THEN
    RAISE EXCEPTION 'schema check (%): an audit row must never carry a key hash', step;
  END IF;
END
$session_keys$;
