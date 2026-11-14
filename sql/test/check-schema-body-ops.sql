-- Migration 0027 (decision 0170, C7-03a): the supervisor role's grants on body_ops and its reads.
-- Run as a superuser after every migration, like check-schema-admin-flag.sql.
DO $check$
DECLARE
  step TEXT;
BEGIN
  step := 'body_ops: supervisor role inserts';
  IF NOT has_table_privilege('geldar_supervisor', 'body_ops', 'INSERT') THEN
    RAISE EXCEPTION 'schema check (%): geldar_supervisor must insert body_ops', step;
  END IF;

  step := 'body_ops: supervisor role cannot update or delete';
  IF has_table_privilege('geldar_supervisor', 'body_ops', 'UPDATE')
     OR has_table_privilege('geldar_supervisor', 'body_ops', 'DELETE') THEN
    RAISE EXCEPTION 'schema check (%): geldar_supervisor must not update or delete body_ops', step;
  END IF;

  step := 'body_ops: public has no access';
  IF has_table_privilege('public', 'body_ops', 'SELECT') THEN
    RAISE EXCEPTION 'schema check (%): public must not read body_ops', step;
  END IF;

  step := 'roster: supervisor role reads mcp_roster';
  IF NOT has_table_privilege('geldar_supervisor', 'mcp_roster', 'SELECT') THEN
    RAISE EXCEPTION 'schema check (%): geldar_supervisor must read mcp_roster', step;
  END IF;

  step := 'roster: supervisor role cannot write mcp_roster';
  IF has_table_privilege('geldar_supervisor', 'mcp_roster', 'INSERT')
     OR has_table_privilege('geldar_supervisor', 'mcp_roster', 'UPDATE') THEN
    RAISE EXCEPTION 'schema check (%): geldar_supervisor must not write mcp_roster', step;
  END IF;

  step := 'audit: supervisor role appends register_audit, cannot update it';
  IF NOT has_table_privilege('geldar_supervisor', 'register_audit', 'INSERT')
     OR has_table_privilege('geldar_supervisor', 'register_audit', 'UPDATE') THEN
    RAISE EXCEPTION 'schema check (%): geldar_supervisor must append register_audit only', step;
  END IF;

  step := 'admin flag: supervisor role reads through supervisor_is_admin, never register_is_admin';
  IF NOT has_function_privilege('geldar_supervisor', 'supervisor_is_admin(text)', 'EXECUTE')
     OR has_function_privilege('geldar_supervisor', 'register_is_admin(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'schema check (%): geldar_supervisor must execute supervisor_is_admin and not register_is_admin', step;
  END IF;
  IF supervisor_is_admin('no-such-owner-0027') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'schema check (%): supervisor_is_admin must be false for an unknown owner', step;
  END IF;
  IF has_column_privilege('geldar_supervisor', 'mcp_owners', 'is_admin', 'UPDATE') THEN
    RAISE EXCEPTION 'schema check (%): geldar_supervisor must not update mcp_owners.is_admin', step;
  END IF;

  step := 'admin flag: supervisor_is_admin has no PUBLIC or other-role EXECUTE and pins search_path';
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             WHERE p.proname = 'supervisor_is_admin' AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'schema check (%): supervisor_is_admin must not be executable by PUBLIC', step;
  END IF;
  IF has_function_privilege('geldar_register', 'supervisor_is_admin(text)', 'EXECUTE')
     OR has_function_privilege('geldar_mcp', 'supervisor_is_admin(text)', 'EXECUTE')
     OR has_function_privilege('geldar_glass', 'supervisor_is_admin(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'schema check (%): only geldar_supervisor may execute supervisor_is_admin', step;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                 WHERE p.proname = 'supervisor_is_admin'
                   AND coalesce(p.proconfig, '{}') @> ARRAY['search_path=pg_catalog, public, pg_temp']) THEN
    RAISE EXCEPTION 'schema check (%): supervisor_is_admin must pin its search_path', step;
  END IF;

  step := 'body_ops: the row holds player_name, 1 to 64 characters, and no agent_id';
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'body_ops' AND column_name = 'player_name')
     OR EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'body_ops' AND column_name = 'agent_id') THEN
    RAISE EXCEPTION 'schema check (%): body_ops must hold player_name and no agent_id', step;
  END IF;
  BEGIN
    INSERT INTO body_ops (owner_id, player_name, op) VALUES ('no-such-owner-0027', repeat('x', 65), 'start');
    RAISE EXCEPTION 'schema check (%): body_ops accepted a 65 character player_name', step;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$check$;
