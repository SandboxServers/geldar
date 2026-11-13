-- Migration 0025 (decision 0170, C7-12): the admin flag grants and the append-only register_audit.
-- Run after sql/test/check-schema.sql, on the same migrated database. Every probe rolls back.
DO $admin_flag$
DECLARE
  step TEXT;
  audit_id BIGINT;
BEGIN
  step := 'grant: register role has no privilege on mcp_owners (the flag is read through register_is_admin)';
  IF has_any_column_privilege('geldar_register', 'mcp_owners', 'SELECT')
     OR has_table_privilege('geldar_register', 'mcp_owners', 'SELECT') THEN
    RAISE EXCEPTION 'schema check (%): geldar_register must not read mcp_owners directly', step;
  END IF;

  step := 'grant: register role cannot write is_admin';
  IF has_column_privilege('geldar_register', 'mcp_owners', 'is_admin', 'UPDATE')
     OR has_table_privilege('geldar_register', 'mcp_owners', 'UPDATE') THEN
    RAISE EXCEPTION 'schema check (%): geldar_register must not update mcp_owners.is_admin', step;
  END IF;

  step := 'grant: register role may insert and read register_audit, never change it';
  IF NOT has_table_privilege('geldar_register', 'register_audit', 'INSERT')
     OR NOT has_table_privilege('geldar_register', 'register_audit', 'SELECT')
     OR has_table_privilege('geldar_register', 'register_audit', 'UPDATE')
     OR has_table_privilege('geldar_register', 'register_audit', 'DELETE') THEN
    RAISE EXCEPTION 'schema check (%): register_audit grants are not insert and select only', step;
  END IF;

  step := 'grant: register role reads the flag through register_is_admin, which fails closed';
  IF NOT has_function_privilege('geldar_register', 'register_is_admin(text)', 'EXECUTE')
     OR register_is_admin('no-such-owner-0025') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'schema check (%): register_is_admin must be executable and false for an unknown owner', step;
  END IF;

  step := 'definer: register_is_admin and the audit trigger pin search_path, and PUBLIC has no EXECUTE on the trigger';
  IF EXISTS (SELECT 1 FROM pg_proc p
             WHERE p.proname IN ('register_is_admin', 'register_audit_append_only')
               AND NOT (coalesce(p.proconfig, '{}') @> ARRAY['search_path=pg_catalog, public, pg_temp']))
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.proname = 'register_audit_append_only' AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'schema check (%): the audit trigger and register_is_admin must pin the search_path and not be public', step;
  END IF;

  step := 'trigger: register_audit refuses UPDATE and DELETE';
  INSERT INTO register_audit (actor, action, target, outcome)
  VALUES ('operator', 'admin_set', 'probe-owner', 'ok')
  RETURNING id INTO audit_id;
  BEGIN
    UPDATE register_audit SET outcome = 'changed' WHERE id = audit_id;
    RAISE EXCEPTION 'schema check (%): register_audit accepted an UPDATE', step;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM register_audit WHERE id = audit_id;
    RAISE EXCEPTION 'schema check (%): register_audit accepted a DELETE', step;
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  step := 'rows: detail is capped at 256 characters';
  BEGIN
    INSERT INTO register_audit (actor, action, target, outcome, detail)
    VALUES ('operator', 'admin_set', 'probe-owner', 'ok', repeat('x', 257));
    RAISE EXCEPTION 'schema check (%): register_audit accepted a 257 character detail', step;
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE EXCEPTION USING MESSAGE = 'admin flag checks passed (rolled back)', ERRCODE = 'P0001';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'admin flag checks passed%' THEN
    RAISE;
  END IF;
END
$admin_flag$;
