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

  step := 'admin flag: supervisor role reads through register_is_admin';
  IF NOT has_function_privilege('geldar_supervisor', 'register_is_admin(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'schema check (%): geldar_supervisor must execute register_is_admin', step;
  END IF;
  IF has_column_privilege('geldar_supervisor', 'mcp_owners', 'is_admin', 'UPDATE') THEN
    RAISE EXCEPTION 'schema check (%): geldar_supervisor must not update mcp_owners.is_admin', step;
  END IF;
END
$check$;
