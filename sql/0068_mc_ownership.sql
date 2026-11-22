-- Migration 0068 (mc-sql, owner-approved design: Minecraft Java ownership gate on sign-up).
-- The one-time check of a NEW sign-up stores three fields on the identity row: owns_java (boolean), mc_checked_at and
-- mc_profile_uuid (32 lowercase hex, when the check returned one). No token, gamertag, XUID, email or entitlement is
-- stored. Existing owners keep NULL in all three (= not checked); the gate never blocks an existing owner.
-- The check itself runs in the server (not here); this migration only records its answer.
--
-- 1. mcp_identities gets the three columns. owns_java and mc_checked_at are NULL together (the CHECK below).
-- 2. register_mc_ownership_record(identity_hash, owns_java, profile_uuid): records the answer once per identity.
--    Fail closed: a NULL answer or a malformed profile id writes nothing and returns false; an unknown identity, a
--    banned tombstone (owner link gone) and an identity already checked return false and write nothing.
--    Each recorded answer writes one register_audit row (action mc.ownership, actor = the owner id hash, non-empty detail).
-- 3. register_account_delete (latest: 0067) is recreated unchanged except the banned branch, which clears the three
--    new columns with the owner link (the tombstone keeps only the identity hash and the ban time).
-- 4. register_owner_export (latest: 0065) is recreated unchanged except that the identity object lists
--    mc_ownership: owns_java, checked_at and mc_profile_uuid.

ALTER TABLE mcp_identities
  ADD COLUMN owns_java BOOLEAN,
  ADD COLUMN mc_checked_at TIMESTAMPTZ,
  ADD COLUMN mc_profile_uuid TEXT CHECK (mc_profile_uuid IS NULL OR mc_profile_uuid ~ '^[0-9a-f]{32}$'),
  ADD CONSTRAINT mcp_identities_mc_check_pair CHECK ((owns_java IS NULL) = (mc_checked_at IS NULL));

CREATE FUNCTION register_mc_ownership_record(p_identity_hash BYTEA, p_owns_java BOOLEAN, p_profile_uuid TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $mc_record$
DECLARE
  who TEXT;
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  -- fail closed: only a definite answer is stored, and a malformed profile id is refused
  IF p_owns_java IS NULL OR (p_profile_uuid IS NOT NULL AND p_profile_uuid !~ '^[0-9a-f]{32}$') THEN
    RETURN false;
  END IF;

  SELECT i.owner_id INTO who
    FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash AND i.owner_id IS NOT NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- once per identity: a row already checked is never written again
  UPDATE public.mcp_identities
    SET owns_java = p_owns_java, mc_checked_at = now(), mc_profile_uuid = p_profile_uuid
    WHERE identity_hash = p_identity_hash AND mc_checked_at IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.register_audit (actor, action, target, outcome, admin, detail)
    VALUES (left(encode(sha256(convert_to(who, 'UTF8')), 'hex'), 16), 'mc.ownership', 'account',
            CASE WHEN p_owns_java THEN 'owns-java' ELSE 'no-java' END, public.register_is_admin(who),
            'one-time sign-up check');
  RETURN true;
END
$mc_record$;

REVOKE ALL ON FUNCTION register_mc_ownership_record(BYTEA, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_mc_ownership_record(BYTEA, BOOLEAN, TEXT) TO geldar_register;

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

  -- the Minecraft ownership columns (0068) go with the owner link, in the tombstone branch too
  IF was_banned THEN
    UPDATE public.mcp_identities
      SET owner_id = NULL, owns_java = NULL, mc_checked_at = NULL, mc_profile_uuid = NULL
      WHERE identity_hash = p_identity_hash;
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

CREATE OR REPLACE FUNCTION register_owner_export(p_identity_hash BYTEA)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $owner_export$
DECLARE
  who TEXT;
  ident_provider TEXT;
  ident_created TIMESTAMPTZ;
  ident_owns_java BOOLEAN;
  ident_checked TIMESTAMPTZ;
  ident_profile TEXT;
  owner_display TEXT;
  owner_cap INT;
  lives TEXT[];
  life_list TEXT[];
  th_part JSONB;
  jr_part JSONB;
  counts JSONB;
  out JSONB;
BEGIN
  SELECT i.owner_id, i.provider, i.created_at, i.owns_java, i.mc_checked_at, i.mc_profile_uuid
    INTO who, ident_provider, ident_created, ident_owns_java, ident_checked, ident_profile
    FROM public.mcp_identities i
    WHERE i.identity_hash = p_identity_hash AND i.owner_id IS NOT NULL;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT o.display, o.player_cap INTO owner_display, owner_cap
    FROM public.mcp_owners o WHERE o.owner_id = who;

  -- every life of the owner, dead or alive (the same derivation as register_account_delete in 0040)
  lives := ARRAY(SELECT a.agent_id FROM public.agents a WHERE a.owner = who
                 UNION
                 SELECT p.life_id FROM public.mcp_players p WHERE p.owner_id = who);
  -- the exported lives (the lives list below): the first 50 by id; the per-life counts cover only these
  life_list := ARRAY(SELECT a.agent_id FROM public.agents a WHERE a.agent_id = ANY (lives)
                     ORDER BY a.agent_id LIMIT 50);

  -- thoughts: one statement ranks the rows, keeps the prefix that fits the row cap and the byte budget, and sets the
  -- truncated flag from the same ranked set (one snapshot, so the flag always agrees with the rows)
  -- the thoughts row cap (20000) cannot bind: the smallest thoughts row is about 439 bytes, so the 3,000,000-byte budget binds first
  th_part := (WITH src AS (
      SELECT x.at, x.thought_id AS sort_id, jsonb_build_object(
          'thought_id', x.thought_id, 'life_id', x.life_id, 'at', x.at, 'world_day', x.world_day,
          'world_tick', x.world_tick, 'wake_reason', x.wake_reason, 'parsed', x.parsed,
          'prompt_template_version', x.prompt_template_version, 'schema_version', x.schema_version,
          'mind_version', x.mind_version, 'body_version', x.body_version, 'model_config', x.model_config,
          'thinker_id', x.thinker_id, 'effort', x.effort, 'tokens_in_estimated', x.tokens_in_estimated,
          'tokens_out_estimated', x.tokens_out_estimated, 'latency_ms', x.latency_ms,
          'credits_reserved', x.credits_reserved, 'credits_settled', x.credits_settled) AS row_json
        FROM public.thoughts x WHERE x.life_id = ANY (lives)
    ), ranked AS (
      SELECT s.at, s.sort_id, s.row_json,
             row_number() OVER w AS rn, sum(octet_length(s.row_json::text) + 1) OVER w AS run
        FROM src s WINDOW w AS (ORDER BY s.at, s.sort_id)
    ), kept AS (
      SELECT k.* FROM ranked k WHERE k.rn <= 20000 AND k.run <= 3000000
    )
    SELECT jsonb_build_object(
      'truncated', (SELECT count(*) FROM kept) < (SELECT count(*) FROM ranked),
      'rows', COALESCE((SELECT jsonb_agg(k.row_json ORDER BY k.at, k.sort_id) FROM kept k), '[]'::jsonb)));

  -- mcp_journal: the same shape (text is capped at 4000 characters by the table)
  jr_part := (WITH src AS (
      SELECT x.at, x.id AS sort_id, jsonb_build_object('id', x.id, 'life_id', x.life_id, 'at', x.at,
                                                      'text', x.text) AS row_json
        FROM public.mcp_journal x WHERE x.life_id = ANY (lives)
    ), ranked AS (
      SELECT s.at, s.sort_id, s.row_json,
             row_number() OVER w AS rn, sum(octet_length(s.row_json::text) + 1) OVER w AS run
        FROM src s WINDOW w AS (ORDER BY s.at, s.sort_id)
    ), kept AS (
      SELECT k.* FROM ranked k WHERE k.rn <= 20000 AND k.run <= 3000000
    )
    SELECT jsonb_build_object(
      'truncated', (SELECT count(*) FROM kept) < (SELECT count(*) FROM ranked),
      'rows', COALESCE((SELECT jsonb_agg(k.row_json ORDER BY k.at, k.sort_id) FROM kept k), '[]'::jsonb)));

  -- counts: one scan per table, grouped by life; a row that names two lives counts once for each of them
  counts := (WITH
    c_events AS (SELECT m.l, count(*) AS n FROM public.events e,
                   LATERAL (SELECT x AS l FROM unnest(lives) AS x WHERE x = e.agent_id OR x = e.thinker_id) m
                 WHERE e.agent_id = ANY (lives) OR e.thinker_id = ANY (lives) GROUP BY m.l),
    c_relationships AS (SELECT m.l, count(*) AS n FROM public.relationships r,
                   LATERAL (SELECT x AS l FROM unnest(lives) AS x WHERE x = r.agent_id OR x = r.other_id) m
                 WHERE r.agent_id = ANY (lives) OR r.other_id = ANY (lives) GROUP BY m.l),
    c_memories AS (SELECT x.agent_id AS l, count(*) AS n FROM public.memories x
                   WHERE x.agent_id = ANY (lives) GROUP BY x.agent_id),
    c_goals AS (SELECT x.agent_id AS l, count(*) AS n FROM public.goals x
                WHERE x.agent_id = ANY (lives) GROUP BY x.agent_id),
    c_intents AS (SELECT x.life_id AS l, count(*) AS n FROM public.intents x
                  WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_actions AS (SELECT x.life_id AS l, count(*) AS n FROM public.actions x
                  WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_skill_runs AS (SELECT x.life_id AS l, count(*) AS n FROM public.skill_runs x
                     WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_skill_library AS (SELECT x.agent_id AS l, count(*) AS n FROM public.skill_library x
                        WHERE x.agent_id = ANY (lives) GROUP BY x.agent_id),
    c_ledger AS (SELECT x.agent_id AS l, count(*) AS n FROM public.ledger x
                 WHERE x.agent_id = ANY (lives) GROUP BY x.agent_id),
    c_votes AS (SELECT x.agent_id AS l, count(*) AS n FROM public.votes x
                WHERE x.agent_id = ANY (lives) GROUP BY x.agent_id),
    c_receipts AS (SELECT x.life_id AS l, count(*) AS n FROM public.receipts x
                   WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_suppressed_wakeups AS (SELECT x.life_id AS l, count(*) AS n FROM public.suppressed_wakeups x
                             WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_mcp_sleep_marks AS (SELECT x.life_id AS l, count(*) AS n FROM public.mcp_sleep_marks x
                          WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_mcp_budget AS (SELECT x.life_id AS l, count(*) AS n FROM public.mcp_budget x
                     WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_mcp_life_deaths AS (SELECT x.life_id AS l, count(*) AS n FROM public.mcp_life_deaths x
                          WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_mcp_death_events AS (SELECT x.life_id AS l, count(*) AS n FROM public.mcp_death_events x
                           WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_rolls AS (SELECT x.life_id AS l, count(*) AS n FROM public.rolls x
                WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_decisions AS (SELECT x.life_id AS l, count(*) AS n FROM public.decisions x
                    WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_xp_evidence AS (SELECT x.life_id AS l, count(*) AS n FROM public.xp_evidence x
                      WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_character_sheet_adoptions AS (SELECT x.life_id AS l, count(*) AS n FROM public.character_sheet_adoptions x
                                    WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_proficiency AS (SELECT x.life_id AS l, count(*) AS n FROM public.proficiency x
                      WHERE x.life_id = ANY (lives) GROUP BY x.life_id),
    c_proficiency_outbox AS (SELECT x.life_id AS l, count(*) AS n FROM public.proficiency_outbox x
                             WHERE x.life_id = ANY (lives) GROUP BY x.life_id)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'life_id', u.l,
        'events', COALESCE(c_events.n, 0), 'memories', COALESCE(c_memories.n, 0),
        'goals', COALESCE(c_goals.n, 0), 'intents', COALESCE(c_intents.n, 0),
        'actions', COALESCE(c_actions.n, 0), 'skill_runs', COALESCE(c_skill_runs.n, 0),
        'skill_library', COALESCE(c_skill_library.n, 0), 'relationships', COALESCE(c_relationships.n, 0),
        'ledger', COALESCE(c_ledger.n, 0), 'votes', COALESCE(c_votes.n, 0),
        'receipts', COALESCE(c_receipts.n, 0), 'suppressed_wakeups', COALESCE(c_suppressed_wakeups.n, 0),
        'mcp_sleep_marks', COALESCE(c_mcp_sleep_marks.n, 0), 'mcp_budget', COALESCE(c_mcp_budget.n, 0),
        'mcp_life_deaths', COALESCE(c_mcp_life_deaths.n, 0), 'mcp_death_events', COALESCE(c_mcp_death_events.n, 0),
        'rolls', COALESCE(c_rolls.n, 0), 'decisions', COALESCE(c_decisions.n, 0),
        'xp_evidence', COALESCE(c_xp_evidence.n, 0),
        'character_sheet_adoptions', COALESCE(c_character_sheet_adoptions.n, 0),
        'proficiency', COALESCE(c_proficiency.n, 0), 'proficiency_outbox', COALESCE(c_proficiency_outbox.n, 0)
      ) ORDER BY u.l), '[]'::jsonb)
    FROM unnest(life_list) AS u(l)
      LEFT JOIN c_events ON c_events.l = u.l
      LEFT JOIN c_memories ON c_memories.l = u.l
      LEFT JOIN c_goals ON c_goals.l = u.l
      LEFT JOIN c_intents ON c_intents.l = u.l
      LEFT JOIN c_actions ON c_actions.l = u.l
      LEFT JOIN c_skill_runs ON c_skill_runs.l = u.l
      LEFT JOIN c_skill_library ON c_skill_library.l = u.l
      LEFT JOIN c_relationships ON c_relationships.l = u.l
      LEFT JOIN c_ledger ON c_ledger.l = u.l
      LEFT JOIN c_votes ON c_votes.l = u.l
      LEFT JOIN c_receipts ON c_receipts.l = u.l
      LEFT JOIN c_suppressed_wakeups ON c_suppressed_wakeups.l = u.l
      LEFT JOIN c_mcp_sleep_marks ON c_mcp_sleep_marks.l = u.l
      LEFT JOIN c_mcp_budget ON c_mcp_budget.l = u.l
      LEFT JOIN c_mcp_life_deaths ON c_mcp_life_deaths.l = u.l
      LEFT JOIN c_mcp_death_events ON c_mcp_death_events.l = u.l
      LEFT JOIN c_rolls ON c_rolls.l = u.l
      LEFT JOIN c_decisions ON c_decisions.l = u.l
      LEFT JOIN c_xp_evidence ON c_xp_evidence.l = u.l
      LEFT JOIN c_character_sheet_adoptions ON c_character_sheet_adoptions.l = u.l
      LEFT JOIN c_proficiency ON c_proficiency.l = u.l
      LEFT JOIN c_proficiency_outbox ON c_proficiency_outbox.l = u.l);

  -- the lists: a row cap per list (ranked by the key, LIMIT), and a truncated flag per list in the top-level
  -- truncated object; free-text fields of the lists are cut at 200 characters (left), so one row is bounded
  out := jsonb_build_object(
    'format', 'geldar-owner-export/1',
    'exported_at', now(),
    'owner', jsonb_build_object('display_name', left(owner_display, 200), 'player_cap', owner_cap),
    'identity', jsonb_build_object('provider', ident_provider, 'created_at', ident_created,
      'mc_ownership', jsonb_build_object('owns_java', ident_owns_java, 'checked_at', ident_checked,
                                         'mc_profile_uuid', ident_profile)),
    'truncated', jsonb_build_object(
      'players', (SELECT count(*) > 150 FROM public.mcp_players p WHERE p.owner_id = who),
      'tokens', (SELECT count(*) > 150 FROM public.mcp_tokens t
                 JOIN public.mcp_players p ON p.player_id = t.player_id WHERE p.owner_id = who),
      'roster', (SELECT count(*) > 100 FROM public.mcp_roster r WHERE r.owner_id = who),
      'body_ops', (SELECT count(*) > 500 FROM public.body_ops b WHERE b.owner_id = who),
      'consents', (SELECT count(*) > 100 FROM public.register_consents c
                   JOIN public.mcp_identities i ON i.identity_hash = c.identity_hash WHERE i.owner_id = who),
      'lives', (SELECT count(*) > 50 FROM public.agents a WHERE a.agent_id = ANY (lives))),
    'players', (SELECT COALESCE(jsonb_agg(x.row_json ORDER BY x.player_id), '[]'::jsonb) FROM (
                  SELECT p.player_id, jsonb_build_object(
                    'player_id', p.player_id, 'life_id', p.life_id, 'display_name', left(p.display_name, 200),
                    'harness', p.harness, 'status', p.status) AS row_json
                  FROM public.mcp_players p WHERE p.owner_id = who ORDER BY p.player_id LIMIT 150) x),
    'tokens', (SELECT COALESCE(jsonb_agg(x.row_json ORDER BY x.token_id), '[]'::jsonb) FROM (
                  SELECT t.token_id, jsonb_build_object(
                    'token_id', t.token_id, 'player_id', t.player_id, 'label', left(t.label, 200),
                    'created_at', t.created_at, 'expires_at', t.expires_at, 'revoked_at', t.revoked_at,
                    'last_used_at', t.last_used_at) AS row_json
                  FROM public.mcp_tokens t
                  JOIN public.mcp_players p ON p.player_id = t.player_id
                  WHERE p.owner_id = who ORDER BY t.token_id LIMIT 150) x),
    'roster', (SELECT COALESCE(jsonb_agg(x.row_json ORDER BY x.player_name), '[]'::jsonb) FROM (
                  SELECT r.player_name, jsonb_build_object(
                    'player_name', left(r.player_name, 200), 'max_agents', r.max_agents,
                    'created_at', r.created_at) AS row_json
                  FROM public.mcp_roster r WHERE r.owner_id = who ORDER BY r.player_name LIMIT 100) x),
    'body_ops', (SELECT COALESCE(jsonb_agg(x.row_json ORDER BY x.at, x.id), '[]'::jsonb) FROM (
                  SELECT b.at, b.id, jsonb_build_object(
                    'at', b.at, 'player_name', left(b.player_name, 200), 'op', b.op) AS row_json
                  FROM public.body_ops b WHERE b.owner_id = who ORDER BY b.at, b.id LIMIT 500) x),
    'consents', (SELECT COALESCE(jsonb_agg(x.row_json ORDER BY x.accepted_at, x.terms_version), '[]'::jsonb) FROM (
                  SELECT c.accepted_at, c.terms_version, jsonb_build_object(
                    'terms_version', left(c.terms_version, 200), 'accepted_at', c.accepted_at) AS row_json
                  FROM public.register_consents c
                  JOIN public.mcp_identities i ON i.identity_hash = c.identity_hash
                  WHERE i.owner_id = who ORDER BY c.accepted_at, c.terms_version LIMIT 100) x),
    'lives', (SELECT COALESCE(jsonb_agg(x.row_json ORDER BY x.agent_id), '[]'::jsonb) FROM (
                  SELECT a.agent_id, jsonb_build_object(
                    'life_id', a.agent_id, 'name', left(a.name, 200), 'shard', left(a.shard, 200), 'mode', a.mode,
                    'harness', left(a.harness, 200), 'declared_model', left(a.declared_model, 200), 'tier', left(a.tier, 200),
                    'born_at', a.born_at, 'died_at', a.died_at, 'death_cause', left(a.death_cause, 200)) AS row_json
                  FROM public.agents a WHERE a.agent_id = ANY (lives) ORDER BY a.agent_id LIMIT 50) x),
    'records', jsonb_build_object('thoughts', th_part, 'mcp_journal', jr_part, 'counts', counts),
    'not_included', to_jsonb(ARRAY[
      'shared world objects kept by design: skills you authored, books, proposals and laws, which other lives depend on',
      'audit rows: the register audit (this export is one of them, hashed), the glass login audit and the kino audit (kino_audit)',
      'the ban tombstone of the identity, if one exists',
      'records of other players and other owners',
      'secrets: token values and token hashes, the identity hash, and API keys (owner_api_keys)',
      'login sessions (register_sessions)',
      'admin records (kino_admins)',
      'skins: skin files and their bindings',
      'thoughts columns model_input, snapshot, raw_output and provider_usage: the prompts and world snapshots carry other residents words, and the rows are bulky; the life own output is exported in the thoughts rows',
      'turn_records (0060): the per-turn model input and raw output of a kit Mind; operator-only, no owner link; erasure is deferred to GX-05c',
      'row counts only, not contents, per life, for: events, memories, goals, intents, actions, skill_runs, skill_library, relationships, ledger, votes, receipts, suppressed_wakeups, mcp_sleep_marks, mcp_budget, mcp_life_deaths, mcp_death_events, rolls, decisions, xp_evidence, character_sheet_adoptions, proficiency, proficiency_outbox',
      'list rows past the caps are left out (players 150, tokens 150, roster 100, body_ops 500, consents 100, lives 50; the top-level truncated object says which list was cut); free-text fields over 200 characters are cut at 200 characters'
    ]::text[])
  );

  INSERT INTO public.register_audit (actor, action, target, outcome, admin, detail)
    VALUES (left(encode(sha256(convert_to(who, 'UTF8')), 'hex'), 16), 'owner.export', 'owner-export', 'exported',
            public.register_is_admin(who), '');
  RETURN out;
END
$owner_export$;

REVOKE ALL ON FUNCTION register_owner_export(BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_owner_export(BYTEA) TO geldar_register;

INSERT INTO schema_migrations (version) VALUES ('0068') ON CONFLICT DO NOTHING;
