-- Migration 0031 (C7-13a): the skin_uploads table, its constraints and its grants. Run after the migrations, as the
-- superuser. The fixtures use the player ids 'skin-check-*' and are deleted at the end of this file.

DO $skin_uploads$
DECLARE
  png BYTEA := decode('89504e470d0a1a0a', 'hex');
  h BYTEA := decode(repeat('5a', 32), 'hex');
  refused BOOLEAN;
BEGIN
  IF to_regclass('public.skin_uploads') IS NULL THEN
    RAISE EXCEPTION 'schema check: skin_uploads is missing';
  END IF;

  -- The register role may INSERT and SELECT, and may never UPDATE or DELETE the status of a row.
  IF NOT (has_table_privilege('geldar_register', 'skin_uploads', 'INSERT')
          AND has_table_privilege('geldar_register', 'skin_uploads', 'SELECT')) THEN
    RAISE EXCEPTION 'schema check: geldar_register must INSERT and SELECT skin_uploads';
  END IF;
  IF has_table_privilege('geldar_register', 'skin_uploads', 'UPDATE')
     OR has_table_privilege('geldar_register', 'skin_uploads', 'DELETE')
     OR has_table_privilege('geldar_mcp', 'skin_uploads', 'SELECT')
     OR has_table_privilege('geldar_glass', 'skin_uploads', 'SELECT') THEN
    RAISE EXCEPTION 'schema check: skin_uploads must not be writable by geldar_register, or readable by geldar_mcp or geldar_glass';
  END IF;

  -- A row is written pending with no decision; a rejected row carries a reason code; a pending row cannot have one.
  INSERT INTO skin_uploads (owner_id, player_id, png, sha256, status) VALUES ('skin-check-owner', 'skin-check-a', png, h, 'pending');
  BEGIN
    INSERT INTO skin_uploads (owner_id, player_id, png, sha256, status) VALUES ('skin-check-owner', 'skin-check-a', png, h, 'pending');
    refused := FALSE;
  EXCEPTION WHEN unique_violation THEN
    refused := TRUE;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check: a second pending skin upload for one agent must be refused';
  END IF;

  refused := FALSE;
  BEGIN
    INSERT INTO skin_uploads (owner_id, player_id, png, sha256, status, decided_at, decided_by)
      VALUES ('skin-check-owner', 'skin-check-b', png, h, 'rejected', now(), 'op');
  EXCEPTION WHEN check_violation THEN
    refused := TRUE;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check: a rejected skin upload without a reason code must be refused';
  END IF;

  refused := FALSE;
  BEGIN
    INSERT INTO skin_uploads (owner_id, player_id, png, sha256, status) VALUES ('skin-check-owner', 'skin-check-c', png || decode(repeat('00', 32768), 'hex'), h, 'pending');
  EXCEPTION WHEN check_violation THEN
    refused := TRUE;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check: a skin upload over 32 KiB must be refused';
  END IF;

  -- The cap is inclusive: exactly 32768 bytes is accepted (the PNG signature plus zero bytes).
  INSERT INTO skin_uploads (owner_id, player_id, png, sha256, status) VALUES ('skin-check-owner', 'skin-check-e', png || decode(repeat('00', 32760), 'hex'), h, 'pending');

  -- A pending row carries no decision: decided_at set on a pending row is refused.
  refused := FALSE;
  BEGIN
    INSERT INTO skin_uploads (owner_id, player_id, png, sha256, status, decided_at, decided_by)
      VALUES ('skin-check-owner', 'skin-check-f', png, h, 'pending', now(), 'op');
  EXCEPTION WHEN check_violation THEN
    refused := TRUE;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check: a pending skin upload with decided_at set must be refused';
  END IF;

  -- A pending row carries no reason code: a reason code on a pending row is refused.
  refused := FALSE;
  BEGIN
    INSERT INTO skin_uploads (owner_id, player_id, png, sha256, status, reason_code)
      VALUES ('skin-check-owner', 'skin-check-g', png, h, 'pending', 'other');
  EXCEPTION WHEN check_violation THEN
    refused := TRUE;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check: a pending skin upload with a reason code must be refused';
  END IF;

  -- The sha256 is exactly 32 bytes: 31 bytes is refused.
  refused := FALSE;
  BEGIN
    INSERT INTO skin_uploads (owner_id, player_id, png, sha256, status)
      VALUES ('skin-check-owner', 'skin-check-h', png, decode(repeat('5a', 31), 'hex'), 'pending');
  EXCEPTION WHEN check_violation THEN
    refused := TRUE;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'schema check: a sha256 that is not 32 bytes must be refused';
  END IF;

  DELETE FROM skin_uploads WHERE owner_id = 'skin-check-owner';
END
$skin_uploads$;
