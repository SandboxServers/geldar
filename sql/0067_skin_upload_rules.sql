-- Migration 0067 (C7-13a-sql, decision 0172): register definer functions for owner skin uploads, and account deletion
-- reaches skin_uploads. Additive to 0031 (the table; 0031 adds lock_cleared_at, which this migration reads) and to
-- 0040 (register_account_delete is recreated
-- with the same signature, SECURITY DEFINER, pinned search_path, grants and 3 s lock_timeout; the body is the 0053 body,
-- which also erases turn_records, and the only new statement is the skin_uploads delete).
--
-- register_skin_submit(identity hash, player id, PNG bytes, sha256): the owner id comes from the session identity
-- (mcp_identities), and the agent must belong to that owner. Refused with a stable code, in this order:
--   23505 skin_upload_pending   the agent already has a pending upload (one pending per agent, 0172 point 2)
--   42501 skin_upload_locked    the owner has 3 rejects within 30 days of each other (decided_at), none cleared by the
--                               operator (0172 point 5). The lock does not lapse with time: it holds until the operator
--                               sets lock_cleared_at on the owner's rejected rows (worknote C7-13a, one SQL statement).
--   55000 skin_upload_wait      the agent's last decided upload was a reject less than 1 hour ago (0172 point 5)
--   53400 skin_upload_daily     3 uploads of this agent in the last 24 hours (0172 point 2: the cap is per agent)
-- The last three are rate rules: an admin owner (0170) is exempt from them, not from the owner check or the pending
-- check. The PNG signature, the 32768-byte cap and the sha256 are checked here too (fail closed), and by the table.
-- The row is stored `pending` and nothing else happens: no approval, no MineSkin call, no KV write (principle 1).
-- Each accepted submit writes one register_audit row (action skin.upload, outcome pending).
--
-- register_skin_status(identity hash, player id): the newest upload of the agent for the owner. No PNG, no sha256,
-- no decided_by: the owner sees the status and the reason code only (0172 point 4). Zero rows = no upload yet.
--
-- The 30-day reject count reads the owner's rows through skin_uploads_owner_created (owner_id, created_at), as 0031
-- says. The daily and pending counts are per agent (player_id) and read no index. A pg_advisory_xact_lock per owner
-- serialises two submits of one owner, so the counts cannot be raced past.

CREATE OR REPLACE FUNCTION register_skin_submit(p_identity_hash BYTEA, p_player_id TEXT, p_png BYTEA, p_sha256 BYTEA)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $skin_submit$
DECLARE
  who TEXT;
  is_admin BOOLEAN;
  n INT;
  last_status TEXT;
  last_decided TIMESTAMPTZ;
  new_id BIGINT;
BEGIN
  -- FOR SHARE: register_account_delete takes FOR UPDATE on this row. A submit that waits for a delete sees no identity
  -- row (or owner_id NULL, a ban tombstone) once the delete commits, and is refused, so no skin row outlives its owner.
  -- a banned owner (banned_at set) is refused here, as in every other owner write function (0009 to 0035)
  SELECT i.owner_id INTO who FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash AND i.banned_at IS NULL FOR SHARE;
  IF NOT FOUND OR who IS NULL THEN
    RAISE EXCEPTION 'register_skin_submit: not an owner' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.mcp_players p WHERE p.player_id = p_player_id AND p.owner_id = who;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_skin_submit: not your agent' USING ERRCODE = '42501';
  END IF;

  IF p_png IS NULL OR octet_length(p_png) < 8
     OR substring(p_png FROM 1 FOR 8) <> decode('89504e470d0a1a0a', 'hex') THEN
    RAISE EXCEPTION 'register_skin_submit: not a PNG' USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_png) > 32768 THEN
    RAISE EXCEPTION 'register_skin_submit: image too large' USING ERRCODE = '22023';
  END IF;
  IF p_sha256 IS NULL OR p_sha256 <> sha256(p_png) THEN
    RAISE EXCEPTION 'register_skin_submit: sha256 does not match the PNG' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('register_skin_submit:' || who));
  is_admin := public.register_is_admin(who);

  IF EXISTS (SELECT 1 FROM public.skin_uploads s WHERE s.player_id = p_player_id AND s.status = 'pending') THEN
    RAISE EXCEPTION 'skin_upload_pending' USING ERRCODE = '23505';
  END IF;

  IF NOT is_admin THEN
    -- the lock is anchored at a reject r that is not cleared: the owner's uncleared rejects decided within 30 days
    -- before r number 3 or more. Nothing here depends on now(), so the lock holds until the operator clears it.
    IF EXISTS (
      SELECT 1 FROM public.skin_uploads r
        WHERE r.owner_id = who AND r.status = 'rejected' AND r.lock_cleared_at IS NULL
          AND (SELECT count(*) FROM public.skin_uploads s
                 WHERE s.owner_id = who AND s.status = 'rejected' AND s.lock_cleared_at IS NULL
                   AND s.decided_at BETWEEN r.decided_at - interval '30 days' AND r.decided_at) >= 3
    ) THEN
      RAISE EXCEPTION 'skin_upload_locked' USING ERRCODE = '42501';
    END IF;

    SELECT s.status, s.decided_at INTO last_status, last_decided FROM public.skin_uploads s
      WHERE s.player_id = p_player_id AND s.decided_at IS NOT NULL
      ORDER BY s.id DESC LIMIT 1;
    IF last_status = 'rejected' AND now() < last_decided + interval '1 hour' THEN
      RAISE EXCEPTION 'skin_upload_wait' USING ERRCODE = '55000';
    END IF;

    SELECT count(*) INTO n FROM public.skin_uploads s
      WHERE s.player_id = p_player_id AND s.created_at > now() - interval '1 day';
    IF n >= 3 THEN
      RAISE EXCEPTION 'skin_upload_daily' USING ERRCODE = '53400';
    END IF;
  END IF;

  INSERT INTO public.skin_uploads (owner_id, player_id, png, sha256, status)
    VALUES (who, p_player_id, p_png, p_sha256, 'pending')
    RETURNING id INTO new_id;

  INSERT INTO public.register_audit (actor, action, target, outcome, admin, detail)
    VALUES (left(encode(sha256(convert_to(who, 'UTF8')), 'hex'), 16), 'skin.upload', p_player_id, 'pending', is_admin, '');
  RETURN new_id;
END
$skin_submit$;

CREATE OR REPLACE FUNCTION register_skin_status(p_identity_hash BYTEA, p_player_id TEXT)
RETURNS TABLE (upload_id BIGINT, upload_status TEXT, upload_reason TEXT, upload_created TIMESTAMPTZ, upload_decided TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $skin_status$
DECLARE
  who TEXT;
BEGIN
  SELECT i.owner_id INTO who FROM public.mcp_identities i WHERE i.identity_hash = p_identity_hash;
  IF NOT FOUND OR who IS NULL THEN
    RAISE EXCEPTION 'register_skin_status: not an owner' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.mcp_players p WHERE p.player_id = p_player_id AND p.owner_id = who;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'register_skin_status: not your agent' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT s.id, s.status, s.reason_code, s.created_at, s.decided_at
      FROM public.skin_uploads s
      WHERE s.player_id = p_player_id AND s.owner_id = who
      ORDER BY s.id DESC
      LIMIT 1;
END
$skin_status$;

REVOKE ALL ON FUNCTION register_skin_submit(BYTEA, TEXT, BYTEA, BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_skin_status(BYTEA, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_skin_submit(BYTEA, TEXT, BYTEA, BYTEA) TO geldar_register;
GRANT EXECUTE ON FUNCTION register_skin_status(BYTEA, TEXT) TO geldar_register;

-- register_account_delete: the body of 0053 (turn_records erased too), with one statement added (skin uploads of the owner, 0172 point 7).
CREATE OR REPLACE FUNCTION register_account_delete(p_identity_hash BYTEA)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $acct_delete$
DECLARE
  who TEXT;
  was_banned BOOLEAN;
  was_admin BOOLEAN;
  lives TEXT[];
  j_ids BIGINT[];
  t_ids TEXT[];
  r_ids TEXT[];
  s_ids BIGINT[];
  erasure_actor TEXT := left(replace(gen_random_uuid()::text, '-', ''), 16);
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  SELECT i.owner_id, i.banned_at IS NOT NULL INTO who, was_banned
    FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash
    FOR UPDATE;
  IF NOT FOUND OR who IS NULL THEN
    RETURN false;
  END IF;

  PERFORM 1 FROM public.mcp_owners o WHERE o.owner_id = who FOR UPDATE;
  was_admin := public.register_is_admin(who);

  -- every life of the owner, dead or alive, read before the player rows are removed
  lives := ARRAY(SELECT a.agent_id FROM public.agents a WHERE a.owner = who
                 UNION
                 SELECT p.life_id FROM public.mcp_players p WHERE p.owner_id = who);

  -- the character sheet rows of each life (0051: one life's rows, the only erase path)
  PERFORM public.sheet_erase_life(l) FROM unnest(lives) AS l;

  -- rows that no append-only trigger protects: no lock window is needed
  DELETE FROM public.mcp_sleep_marks WHERE life_id = ANY (lives);
  DELETE FROM public.mcp_budget WHERE life_id = ANY (lives);
  DELETE FROM public.mcp_life_deaths WHERE life_id = ANY (lives);
  DELETE FROM public.mcp_death_events WHERE life_id = ANY (lives);
  DELETE FROM public.actions WHERE life_id = ANY (lives);
  DELETE FROM public.intents WHERE life_id = ANY (lives);
  DELETE FROM public.skill_runs WHERE life_id = ANY (lives);
  DELETE FROM public.turn_records WHERE life_id = ANY (lives);
  DELETE FROM public.memories WHERE agent_id = ANY (lives);
  DELETE FROM public.goals WHERE agent_id = ANY (lives);
  DELETE FROM public.skill_library WHERE agent_id = ANY (lives);
  DELETE FROM public.relationships WHERE agent_id = ANY (lives) OR other_id = ANY (lives);
  DELETE FROM public.ledger WHERE agent_id = ANY (lives);
  DELETE FROM public.votes WHERE agent_id = ANY (lives);
  DELETE FROM public.events WHERE agent_id = ANY (lives) OR thinker_id = ANY (lives);

  -- every token of the owner's players: revoked (this fires mcp_token_revoked, which ends cached MCP sessions),
  -- then removed
  UPDATE public.mcp_tokens SET revoked_at = now()
    WHERE revoked_at IS NULL
      AND player_id IN (SELECT p.player_id FROM public.mcp_players p WHERE p.owner_id = who);
  DELETE FROM public.mcp_tokens
    WHERE player_id IN (SELECT p.player_id FROM public.mcp_players p WHERE p.owner_id = who);

  -- the primary keys of the rows of the four append-only tables to erase are collected BEFORE the lock window, under
  -- ordinary locks (the scan of a table without an index on life_id runs here, not under SHARE ROW EXCLUSIVE). The
  -- window deletes by these keys, so it holds no sequential scan and no temp table. Each table's own key is used, so
  -- a key of one table can never name a row of another.
  j_ids := ARRAY(SELECT j.id FROM public.mcp_journal j WHERE j.life_id = ANY (lives));
  t_ids := ARRAY(SELECT t.thought_id FROM public.thoughts t WHERE t.life_id = ANY (lives));
  r_ids := ARRAY(SELECT r.receipt_id FROM public.receipts r WHERE r.life_id = ANY (lives));
  s_ids := ARRAY(SELECT s.id FROM public.suppressed_wakeups s WHERE s.life_id = ANY (lives));

  -- the lock window: mcp_journal, thoughts, receipts and suppressed_wakeups are append-only (0007); erasure is the
  -- one case that removes rows, so their triggers are switched off for this transaction only and on again right
  -- after the deletes. Inside the window only the four ALTER and four DELETE statements run.
  ALTER TABLE public.mcp_journal DISABLE TRIGGER mcp_journal_append_only;
  ALTER TABLE public.thoughts DISABLE TRIGGER thoughts_append_only;
  ALTER TABLE public.receipts DISABLE TRIGGER receipts_append_only;
  ALTER TABLE public.suppressed_wakeups DISABLE TRIGGER suppressed_wakeups_append_only;
  DELETE FROM public.mcp_journal WHERE id = ANY (j_ids);
  DELETE FROM public.thoughts WHERE thought_id = ANY (t_ids);
  DELETE FROM public.receipts WHERE receipt_id = ANY (r_ids);
  DELETE FROM public.suppressed_wakeups WHERE id = ANY (s_ids);
  ALTER TABLE public.mcp_journal ENABLE TRIGGER mcp_journal_append_only;
  ALTER TABLE public.thoughts ENABLE TRIGGER thoughts_append_only;
  ALTER TABLE public.receipts ENABLE TRIGGER receipts_append_only;
  ALTER TABLE public.suppressed_wakeups ENABLE TRIGGER suppressed_wakeups_append_only;

  -- a living life is retired: dead, with a cause, and no public camera or delayed public thoughts (F5)
  UPDATE public.agents
    SET died_at = now(), death_cause = 'owner-erased', public_camera = FALSE, thoughts_delayed_public = FALSE
    WHERE died_at IS NULL
      AND agent_id = ANY (lives);

  -- owner links on the agents rows that stay (dead or alive)
  UPDATE public.agents SET owner = NULL WHERE owner = who;

  DELETE FROM public.mcp_players WHERE owner_id = who;
  DELETE FROM public.owner_api_keys WHERE owner_id = who;
  DELETE FROM public.mcp_roster WHERE owner_id = who;
  DELETE FROM public.body_ops WHERE owner_id = who;
  DELETE FROM public.skin_uploads WHERE owner_id = who;

  DELETE FROM public.register_sessions WHERE identity_hash = p_identity_hash;
  DELETE FROM public.register_consents WHERE identity_hash = p_identity_hash;
  DELETE FROM public.kino_admins WHERE identity_hash = p_identity_hash;
  -- glass writes the identity hash itself, as hex, into login_hash for a signed-in viewer (audit.ts loginHash);
  -- only that value's rows go, and no other owner's rows
  DELETE FROM public.kino_audit WHERE login_hash = encode(p_identity_hash, 'hex');

  IF was_banned THEN
    UPDATE public.mcp_identities SET owner_id = NULL WHERE identity_hash = p_identity_hash;
  ELSE
    DELETE FROM public.mcp_identities WHERE identity_hash = p_identity_hash;
  END IF;
  DELETE FROM public.mcp_owners WHERE owner_id = who;

  INSERT INTO public.register_audit (actor, action, target, outcome, admin, detail)
    VALUES (erasure_actor, 'account.delete', 'account', 'erased', was_admin,
            CASE WHEN was_banned THEN 'tombstone kept' ELSE 'no tombstone' END);
  RETURN true;
END
$acct_delete$;

REVOKE ALL ON FUNCTION register_account_delete(BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_account_delete(BYTEA) TO geldar_register;

INSERT INTO schema_migrations (version) VALUES ('0067') ON CONFLICT DO NOTHING;
