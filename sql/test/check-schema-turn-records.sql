-- Migration 0060 (GX-05a, decision 0185): privilege check for turn_records. Run after the migrations, on the same
-- migrated database, like the other check-schema-*.sql files. The table is operator-only: geldar_glass, geldar_mcp and
-- geldar_register hold no privilege on it, PUBLIC holds no entry in its ACL, and no other role but geldar and the owner
-- holds an entry. geldar (the sink's login and the operator role, see 0060) can INSERT and SELECT. The owner can do
-- everything, so the check does not assert on the owner's privileges. The check only reads, so it writes nothing.
DO $turn_records$
DECLARE
  step TEXT := 'start';
  r TEXT;
  p TEXT;
BEGIN
  step := 'table';
  IF to_regclass('public.turn_records') IS NULL THEN
    RAISE EXCEPTION 'schema check: turn_records is missing (migration 0060)';
  END IF;

  step := 'player-facing roles';
  FOREACH r IN ARRAY ARRAY['geldar_glass', 'geldar_mcp', 'geldar_register'] LOOP
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege(r, 'public.turn_records', p) THEN
        RAISE EXCEPTION 'schema check: % must not hold % on turn_records', r, p;
      END IF;
    END LOOP;
  END LOOP;

  step := 'acl entries';
  IF EXISTS (
    SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     WHERE c.oid = 'public.turn_records'::regclass
       AND a.grantee <> c.relowner
       AND pg_get_userbyid(a.grantee) IS DISTINCT FROM 'geldar'
  ) THEN
    RAISE EXCEPTION 'schema check: turn_records is granted to PUBLIC or to a role other than geldar';
  END IF;

  step := 'sink and operator';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geldar') THEN
    IF NOT (has_table_privilege('geldar', 'public.turn_records', 'INSERT')
            AND has_table_privilege('geldar', 'public.turn_records', 'SELECT')) THEN
      RAISE EXCEPTION 'schema check: geldar must hold INSERT and SELECT on turn_records';
    END IF;
  END IF;
END
$turn_records$;
