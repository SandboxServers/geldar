-- Migration 0039 (C7-09a, decision 0171): self-serve account deletion, the delete half. One SECURITY DEFINER
-- function, register_account_delete(identity hash), removes what decision 0171 says goes, in one statement (so a
-- DB error part way through rolls back every step). Bodies are stopped by the register BEFORE this function is
-- called (the register route refuses and calls nothing when a stop fails); this function does not reach the
-- supervisor. A second call for the same identity finds no owner and returns false: a no-op, with no audit row.
--
-- Removed: every token (revoked, then deleted), every owner API key, every player of the owner, the owner's
-- roster rows, its body_ops rows, the identity's register sessions, consents and kino admin row, the owner row.
-- A life still alive (no died_at) is retired by this function: its mcp_journal, thoughts, sleep marks and budget
-- rows are removed, and the agents row gets died_at = now(), death_cause 'owner-erased', public_camera and
-- thoughts_delayed_public FALSE (so no public camera shows a life with no body and no owner). A dead life keeps
-- its agents row, thoughts, sleep marks and budget, with owner NULL. Events are not owner-linked and stay
-- (open point of 0171).
-- Identity: an unbanned identity row is deleted. A banned identity keeps its hash and banned_at (the tombstone,
-- 0136 and 0171 point 4) with owner_id set to NULL, so the owner row can go; a sign-in with it is refused by the
-- banned check before any owner is read. The tombstone keeps provider and created_at too (NOT NULL columns).
-- Audit: one register_audit row, actor = a random erasure id (not derived from the owner id), target 'account'.
-- Not referenced yet: skin upload rows (C7-13a adds them to this function; see the worknote).
-- Owner id is never written to the audit row. The function runs as its owner with the pinned search_path; only
-- geldar_register may execute it.
--
-- Locks (F2): lock_timeout is 3 s for this transaction. The ALTER TABLE ... DISABLE TRIGGER statements take a
-- SHARE ROW EXCLUSIVE lock on mcp_journal and thoughts, which waits for every open writer of those tables and
-- blocks new ones until the transaction ends. The window is kept as short as the work allows: the sleep marks and
-- budget rows (not trigger-protected) go first, the window covers only the two journal/thought deletes, and the
-- triggers are enabled as soon as those deletes are done. If the lock is not free within 3 s the call fails with
-- 55P03 and nothing is removed: the register answers 500 and the owner may retry. A failure after the disable
-- rolls the disable back too (DDL is transactional), so no trigger stays off. Enable is plain ENABLE TRIGGER, as
-- 0007 installed; a future ENABLE ALWAYS hardening of 0007 must change this function too.

ALTER TABLE mcp_identities ALTER COLUMN owner_id DROP NOT NULL;

CREATE FUNCTION register_account_delete(p_identity_hash BYTEA)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $acct_delete$
DECLARE
  who TEXT;
  was_banned BOOLEAN;
  was_admin BOOLEAN;
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

  -- sleep marks and budget of the living lives (not trigger-protected, so no lock window is needed)
  DELETE FROM public.mcp_sleep_marks
    WHERE life_id IN (SELECT p.life_id FROM public.mcp_players p JOIN public.agents a ON a.agent_id = p.life_id
                      WHERE p.owner_id = who AND a.died_at IS NULL);
  DELETE FROM public.mcp_budget
    WHERE life_id IN (SELECT p.life_id FROM public.mcp_players p JOIN public.agents a ON a.agent_id = p.life_id
                      WHERE p.owner_id = who AND a.died_at IS NULL);

  -- every token of the owner's players: revoked (this fires mcp_token_revoked, which ends cached MCP sessions),
  -- then removed
  UPDATE public.mcp_tokens SET revoked_at = now()
    WHERE revoked_at IS NULL
      AND player_id IN (SELECT p.player_id FROM public.mcp_players p WHERE p.owner_id = who);
  DELETE FROM public.mcp_tokens
    WHERE player_id IN (SELECT p.player_id FROM public.mcp_players p WHERE p.owner_id = who);

  -- the lock window: mcp_journal and thoughts are append-only (0007); erasure is the one case that removes rows,
  -- so their append-only triggers are switched off for this transaction only and on again right after the deletes.
  ALTER TABLE public.mcp_journal DISABLE TRIGGER mcp_journal_append_only;
  ALTER TABLE public.thoughts DISABLE TRIGGER thoughts_append_only;
  DELETE FROM public.mcp_journal
    WHERE life_id IN (SELECT p.life_id FROM public.mcp_players p JOIN public.agents a ON a.agent_id = p.life_id
                      WHERE p.owner_id = who AND a.died_at IS NULL);
  DELETE FROM public.thoughts
    WHERE life_id IN (SELECT p.life_id FROM public.mcp_players p JOIN public.agents a ON a.agent_id = p.life_id
                      WHERE p.owner_id = who AND a.died_at IS NULL);
  ALTER TABLE public.mcp_journal ENABLE TRIGGER mcp_journal_append_only;
  ALTER TABLE public.thoughts ENABLE TRIGGER thoughts_append_only;

  -- a living life is retired: dead, with a cause, and no public camera or delayed public thoughts (F5)
  UPDATE public.agents
    SET died_at = now(), death_cause = 'owner-erased', public_camera = FALSE, thoughts_delayed_public = FALSE
    WHERE died_at IS NULL
      AND agent_id IN (SELECT p.life_id FROM public.mcp_players p WHERE p.owner_id = who);

  -- owner links on the rows that stay (the agents, dead or alive, and their world history)
  UPDATE public.agents SET owner = NULL WHERE owner = who;

  DELETE FROM public.mcp_players WHERE owner_id = who;
  DELETE FROM public.owner_api_keys WHERE owner_id = who;
  DELETE FROM public.mcp_roster WHERE owner_id = who;
  DELETE FROM public.body_ops WHERE owner_id = who;

  DELETE FROM public.register_sessions WHERE identity_hash = p_identity_hash;
  DELETE FROM public.register_consents WHERE identity_hash = p_identity_hash;
  DELETE FROM public.kino_admins WHERE identity_hash = p_identity_hash;

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

INSERT INTO schema_migrations (version) VALUES ('0039') ON CONFLICT DO NOTHING;
