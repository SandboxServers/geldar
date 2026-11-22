-- Migration 0068 (mc-sql): the Minecraft Java ownership columns on mcp_identities, register_mc_ownership_record, and the
-- erase (account delete) and export of the three columns. Run after check-schema.sql and the migrations through 0068,
-- once, on a fresh database (as ci.yml does). Owners mc-own-a to mc-own-e; identity hashes be..01 to be..05,
-- used nowhere else. Failures are raised with the step name.

INSERT INTO mcp_owners (owner_id, display) VALUES
  ('mc-own-a', 'mc-own-a'), ('mc-own-b', 'mc-own-b'), ('mc-own-c', 'mc-own-c'),
  ('mc-own-d', 'mc-own-d'), ('mc-own-e', 'mc-own-e');
INSERT INTO mcp_identities (identity_hash, provider, owner_id) VALUES
  (decode(repeat('be', 31) || '01', 'hex'), 'github', 'mc-own-a'),
  (decode(repeat('be', 31) || '02', 'hex'), 'github', 'mc-own-b'),
  (decode(repeat('be', 31) || '03', 'hex'), 'github', 'mc-own-c'),
  (decode(repeat('be', 31) || '04', 'hex'), 'github', 'mc-own-d'),
  (decode(repeat('be', 31) || '05', 'hex'), 'github', 'mc-own-e');

DO $mc_cols$
DECLARE
  n INT;
BEGIN
  -- the three columns exist, and an existing owner row has NULL in all three (not checked)
  SELECT count(*) INTO n FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mcp_identities'
      AND column_name IN ('owns_java', 'mc_checked_at', 'mc_profile_uuid');
  IF n <> 3 THEN RAISE EXCEPTION 'mc-sql cols: expected 3 columns, found %', n; END IF;
  IF EXISTS (SELECT 1 FROM mcp_identities
             WHERE identity_hash IN (decode(repeat('be', 31) || '01', 'hex'), decode(repeat('be', 31) || '02', 'hex'))
               AND (owns_java IS NOT NULL OR mc_checked_at IS NOT NULL OR mc_profile_uuid IS NOT NULL)) THEN
    RAISE EXCEPTION 'mc-sql cols: a new identity row is not NULL before the check';
  END IF;
END
$mc_cols$;

DO $mc_record_ok$
DECLARE
  h BYTEA := decode(repeat('be', 31) || '01', 'hex');
  r RECORD;
BEGIN
  IF NOT register_mc_ownership_record(h, true, repeat('a', 32)) THEN
    RAISE EXCEPTION 'mc-sql record: the first answer for a new identity is not stored';
  END IF;
  SELECT owns_java, mc_checked_at, mc_profile_uuid INTO r FROM mcp_identities WHERE identity_hash = h;
  IF r.owns_java IS NOT TRUE OR r.mc_checked_at IS NULL OR r.mc_profile_uuid <> repeat('a', 32) THEN
    RAISE EXCEPTION 'mc-sql record: the stored row does not match the answer';
  END IF;
END
$mc_record_ok$;

DO $mc_record_once$
DECLARE
  h BYTEA := decode(repeat('be', 31) || '01', 'hex');
  r RECORD;
BEGIN
  -- once per identity: a second answer is refused and the stored row is unchanged
  IF register_mc_ownership_record(h, false, NULL) THEN
    RAISE EXCEPTION 'mc-sql once: a checked identity was written again';
  END IF;
  SELECT owns_java, mc_profile_uuid INTO r FROM mcp_identities WHERE identity_hash = h;
  IF r.owns_java IS NOT TRUE OR r.mc_profile_uuid <> repeat('a', 32) THEN
    RAISE EXCEPTION 'mc-sql once: the stored row changed on a refused write';
  END IF;
END
$mc_record_once$;

DO $mc_record_refuse$
DECLARE
  hb BYTEA := decode(repeat('be', 31) || '02', 'hex');
  hc BYTEA := decode(repeat('be', 31) || '03', 'hex');
  n INT;
BEGIN
  -- fail closed: a NULL answer, a malformed profile id (upper case, short, not hex) and an unknown identity write nothing
  IF register_mc_ownership_record(hb, NULL, NULL) THEN
    RAISE EXCEPTION 'mc-sql refuse: a NULL answer was accepted';
  END IF;
  IF register_mc_ownership_record(hb, true, repeat('A', 32)) THEN
    RAISE EXCEPTION 'mc-sql refuse: an upper-case profile id was accepted';
  END IF;
  IF register_mc_ownership_record(hb, true, 'abc') THEN
    RAISE EXCEPTION 'mc-sql refuse: a short profile id was accepted';
  END IF;
  IF register_mc_ownership_record(decode(repeat('be', 31) || '99', 'hex'), true, NULL) THEN
    RAISE EXCEPTION 'mc-sql refuse: an unknown identity was recorded';
  END IF;
  SELECT count(*) INTO n FROM mcp_identities WHERE identity_hash = hb AND owns_java IS NULL AND mc_checked_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'mc-sql refuse: a refused write changed the row of owner b'; END IF;
  -- a known answer with no profile id is legal: owner c is recorded as true with a NULL profile id
  IF NOT register_mc_ownership_record(hc, true, NULL) THEN
    RAISE EXCEPTION 'mc-sql refuse: a NULL profile id is not allowed when the answer is known';
  END IF;
END
$mc_record_refuse$;

DO $mc_record_false$
DECLARE
  hd BYTEA := decode(repeat('be', 31) || '04', 'hex');
  r RECORD;
  n INT;
BEGIN
  -- a definite false answer is stored (not refused) with a NULL profile id; a second answer is refused
  IF NOT register_mc_ownership_record(hd, false, NULL) THEN
    RAISE EXCEPTION 'mc-sql false: a false answer with no profile id was not stored';
  END IF;
  SELECT owns_java, mc_checked_at, mc_profile_uuid INTO r FROM mcp_identities WHERE identity_hash = hd;
  IF r.owns_java IS NOT FALSE OR r.mc_checked_at IS NULL OR r.mc_profile_uuid IS NOT NULL THEN
    RAISE EXCEPTION 'mc-sql false: the stored row does not match a false answer';
  END IF;
  IF register_mc_ownership_record(hd, true, NULL) THEN
    RAISE EXCEPTION 'mc-sql false: a checked identity was written again';
  END IF;
  SELECT count(*) INTO n FROM register_audit
    WHERE action = 'mc.ownership' AND actor = left(encode(sha256(convert_to('mc-own-d', 'UTF8')), 'hex'), 16)
      AND outcome = 'no-java' AND detail <> '';
  IF n <> 1 THEN RAISE EXCEPTION 'mc-sql false: owner d has % no-java audit rows, expected 1', n; END IF;
  -- the audit admin column is false for an owner who is not an admin
  IF EXISTS (SELECT 1 FROM register_audit WHERE action = 'mc.ownership' AND admin) THEN
    RAISE EXCEPTION 'mc-sql false: a plain owner has an mc.ownership audit row marked admin';
  END IF;
END
$mc_record_false$;

DO $mc_audit$
DECLARE
  n_a INT;
  n_b INT;
  n_c INT;
BEGIN
  -- one audit row per recorded answer, under the hashed owner id, with a non-empty detail; refused writes add none
  SELECT count(*) INTO n_a FROM register_audit
    WHERE action = 'mc.ownership' AND actor = left(encode(sha256(convert_to('mc-own-a', 'UTF8')), 'hex'), 16)
      AND outcome = 'owns-java' AND detail <> '';
  IF n_a <> 1 THEN RAISE EXCEPTION 'mc-sql audit: owner a has % audit rows, expected 1', n_a; END IF;
  SELECT count(*) INTO n_b FROM register_audit
    WHERE action = 'mc.ownership' AND actor = left(encode(sha256(convert_to('mc-own-b', 'UTF8')), 'hex'), 16);
  IF n_b <> 0 THEN RAISE EXCEPTION 'mc-sql audit: refused writes for owner b left % audit rows', n_b; END IF;
  SELECT count(*) INTO n_c FROM register_audit
    WHERE action = 'mc.ownership' AND actor = left(encode(sha256(convert_to('mc-own-c', 'UTF8')), 'hex'), 16)
      AND outcome = 'owns-java';
  IF n_c <> 1 THEN RAISE EXCEPTION 'mc-sql audit: owner c has % audit rows, expected 1', n_c; END IF;
  IF EXISTS (SELECT 1 FROM register_audit WHERE action = 'mc.ownership' AND actor LIKE 'mc-own%') THEN
    RAISE EXCEPTION 'mc-sql audit: an owner id appears in the audit actor';
  END IF;
END
$mc_audit$;

DO $mc_export$
DECLARE
  j JSONB;
  h BYTEA := decode(repeat('be', 31) || '01', 'hex');
BEGIN
  j := register_owner_export(h);
  IF j IS NULL THEN RAISE EXCEPTION 'mc-sql export: owner a has no export'; END IF;
  IF (j->'identity'->'mc_ownership'->>'owns_java') <> 'true'
     OR (j->'identity'->'mc_ownership'->>'checked_at') IS NULL
     OR (j->'identity'->'mc_ownership'->>'mc_profile_uuid') <> repeat('a', 32) THEN
    RAISE EXCEPTION 'mc-sql export: the export does not list the three columns of owner a';
  END IF;
  IF (j->'identity') ? 'identity_hash' THEN RAISE EXCEPTION 'mc-sql export: the identity hash is exported'; END IF;
END
$mc_export$;

DO $mc_export_unchecked$
DECLARE
  he BYTEA := decode(repeat('be', 31) || '05', 'hex');
  j JSONB;
  k TEXT;
BEGIN
  -- an owner never checked: the export lists the three columns, each as JSON null
  j := register_owner_export(he);
  IF j IS NULL THEN RAISE EXCEPTION 'mc-sql unchecked: owner e has no export'; END IF;
  IF (j->'identity'->'mc_ownership') IS NULL THEN RAISE EXCEPTION 'mc-sql unchecked: no mc_ownership object'; END IF;
  FOREACH k IN ARRAY ARRAY['owns_java', 'checked_at', 'mc_profile_uuid'] LOOP
    IF COALESCE(jsonb_typeof(j->'identity'->'mc_ownership'->k), 'missing') <> 'null' THEN
      RAISE EXCEPTION 'mc-sql unchecked: mc_ownership.% is not JSON null', k;
    END IF;
  END LOOP;
END
$mc_export_unchecked$;

DO $mc_ban_tomb$
DECLARE
  hb BYTEA := decode(repeat('be', 31) || '02', 'hex');
  r RECORD;
BEGIN
  -- owner b: checked now, then banned; the deletion keeps the tombstone and clears the three columns with the owner link
  IF NOT register_mc_ownership_record(hb, true, repeat('b', 32)) THEN
    RAISE EXCEPTION 'mc-sql tombstone: owner b was not recorded before the ban';
  END IF;
  UPDATE mcp_identities SET banned_at = now() WHERE identity_hash = hb;
  IF NOT register_account_delete(hb) THEN RAISE EXCEPTION 'mc-sql tombstone: the delete of banned b returned false'; END IF;
  SELECT owner_id, owns_java, mc_checked_at, mc_profile_uuid INTO r FROM mcp_identities WHERE identity_hash = hb;
  IF NOT FOUND THEN RAISE EXCEPTION 'mc-sql tombstone: the ban tombstone row is gone'; END IF;
  IF r.owner_id IS NOT NULL OR r.owns_java IS NOT NULL OR r.mc_checked_at IS NOT NULL OR r.mc_profile_uuid IS NOT NULL THEN
    RAISE EXCEPTION 'mc-sql tombstone: the deletion left Minecraft ownership columns on the tombstone';
  END IF;
END
$mc_ban_tomb$;

DO $mc_tomb_record$
DECLARE
  hb BYTEA := decode(repeat('be', 31) || '02', 'hex');
  r RECORD;
BEGIN
  -- the banned tombstone (owner link gone) is refused, and its three columns stay NULL
  IF register_mc_ownership_record(hb, true, repeat('c', 32)) THEN
    RAISE EXCEPTION 'mc-sql tombstone record: a tombstone was recorded';
  END IF;
  SELECT owner_id, owns_java, mc_checked_at, mc_profile_uuid INTO r FROM mcp_identities WHERE identity_hash = hb;
  IF NOT FOUND OR r.owner_id IS NOT NULL OR r.owns_java IS NOT NULL OR r.mc_checked_at IS NOT NULL
     OR r.mc_profile_uuid IS NOT NULL THEN
    RAISE EXCEPTION 'mc-sql tombstone record: the tombstone row changed';
  END IF;
END
$mc_tomb_record$;

DO $mc_delete$
DECLARE
  ha BYTEA := decode(repeat('be', 31) || '01', 'hex');
  n INT;
BEGIN
  -- owner a: the deletion erases the row (and so the three columns), and the export is gone
  IF NOT register_account_delete(ha) THEN RAISE EXCEPTION 'mc-sql delete: the delete of owner a returned false'; END IF;
  SELECT count(*) INTO n FROM mcp_identities WHERE identity_hash = ha;
  IF n <> 0 THEN RAISE EXCEPTION 'mc-sql delete: the identity row of owner a survived the deletion'; END IF;
  IF register_owner_export(ha) IS NOT NULL THEN RAISE EXCEPTION 'mc-sql delete: owner a still has an export'; END IF;
END
$mc_delete$;

DO $mc_grants$
DECLARE
  sig TEXT := 'register_mc_ownership_record(bytea,boolean,text)';
  col TEXT;
BEGIN
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(sig)) THEN
    RAISE EXCEPTION 'mc-sql grants: register_mc_ownership_record is not a definer function';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(sig)
                 AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']) THEN
    RAISE EXCEPTION 'mc-sql grants: search_path is not pinned';
  END IF;
  IF has_function_privilege('public', sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'mc-sql grants: PUBLIC can execute register_mc_ownership_record';
  END IF;
  IF NOT has_function_privilege('geldar_register', sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'mc-sql grants: geldar_register cannot execute register_mc_ownership_record';
  END IF;
  IF has_function_privilege('geldar_mcp', sig, 'EXECUTE') OR has_function_privilege('geldar_glass', sig, 'EXECUTE')
     OR has_function_privilege('geldar_supervisor', sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'mc-sql grants: a service role other than geldar_register can execute register_mc_ownership_record';
  END IF;
  -- the three columns are not readable by the service roles (column grants of 0010 and 0012)
  FOREACH col IN ARRAY ARRAY['owns_java', 'mc_checked_at', 'mc_profile_uuid'] LOOP
    IF has_column_privilege('geldar_mcp', 'mcp_identities', col, 'SELECT')
       OR has_column_privilege('geldar_register', 'mcp_identities', col, 'SELECT')
       OR has_column_privilege('geldar_glass', 'mcp_identities', col, 'SELECT') THEN
      RAISE EXCEPTION 'mc-sql grants: a service role can read column % of mcp_identities', col;
    END IF;
  END LOOP;
END
$mc_grants$;
