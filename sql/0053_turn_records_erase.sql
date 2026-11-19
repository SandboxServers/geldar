-- Migration 0053 (S9-00a, decision 0323): register_account_delete also erases turn_records rows of every life of the owner, dead or alive. The function is re-created from 0040 with one added line; nothing else changes.

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

INSERT INTO schema_migrations (version) VALUES ('0053') ON CONFLICT DO NOTHING;
