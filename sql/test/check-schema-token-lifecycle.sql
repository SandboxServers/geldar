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
