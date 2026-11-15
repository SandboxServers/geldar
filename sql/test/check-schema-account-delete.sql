-- Migrations 0039 (C7-09a, decision 0171) and 0040 (C7-09a2, decision 0262): behaviour of register_account_delete.
-- Run after check-schema.sql and the migrations through 0040. Under 0040 every life of a deleted owner is erased,
-- dead or alive; the table loop below asserts that per table. Fixtures are written by the superuser; the delete is called as the superuser (the
-- privilege checks use has_function_privilege). Owners reg-del-a (unbanned, the one deleted), reg-del-b (a second
-- owner that must keep every row) and reg-del-c (banned: the tombstone stays). Each owner has rows in every table the
-- function touches, and a living and a dead life, so a missing or widened filter in the function shows up as a row
-- of owner b (or of a dead life) that goes. register_audit refuses DELETE, so the fixture is not cleaned up: run this
-- file once on a fresh database, as ci.yml does.

-- Capture of every token row the function deletes: whether it was revoked by then, and the lock_timeout in force.
CREATE TABLE check_account_delete_capture (token_id TEXT, was_revoked BOOLEAN, lock_wait TEXT);

CREATE FUNCTION check_account_delete_capture() RETURNS trigger
LANGUAGE plpgsql AS $cap$
BEGIN
  INSERT INTO check_account_delete_capture VALUES (OLD.token_id, OLD.revoked_at IS NOT NULL, current_setting('lock_timeout'));
  RETURN OLD;
END
$cap$;

CREATE TRIGGER check_account_delete_capture BEFORE DELETE ON mcp_tokens
  FOR EACH ROW EXECUTE FUNCTION check_account_delete_capture();

-- Forced failure: an audit insert is the last statement of the function, so this raises after every delete and
-- after the trigger enable. Installed only for the forced block below.
CREATE FUNCTION check_account_delete_refuse_audit() RETURNS trigger
LANGUAGE plpgsql AS $ref$
BEGIN
  RAISE EXCEPTION 'check forced audit failure';
END
$ref$;

DO $account_delete$
DECLARE
  step TEXT;
  n INT;
  found BOOLEAN;
  forced BOOLEAN := false;
  refused BOOLEAN := false;
  audit_before BIGINT;
  owner_val TEXT;
  banned_val BOOLEAN;
  hash_a BYTEA := decode(repeat('51', 32), 'hex');
  hash_b BYTEA := decode(repeat('52', 32), 'hex');
  hash_c BYTEA := decode(repeat('53', 32), 'hex');
  actor_a TEXT := left(encode(sha256(convert_to('reg-del-a', 'UTF8')), 'hex'), 16);
  r RECORD;
  tc TEXT;
  tbl TEXT;
  col TEXT;
BEGIN
  step := 'fixture: owners a, b, c; identities a, b, c (c banned); lives, players, tokens, keys, rows per owner';
  INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES
    ('reg-del-a', 'a', 5), ('reg-del-b', 'b', 5), ('reg-del-c', 'c', 5);
  INSERT INTO mcp_identities (identity_hash, provider, owner_id, banned_at) VALUES
    (hash_a, 'github', 'reg-del-a', NULL),
    (hash_b, 'github', 'reg-del-b', NULL),
    (hash_c, 'discord', 'reg-del-c', now());
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
                      declared_model, model_config, tier, personality_seed, thoughts_delayed_public, public_camera,
                      died_at, death_cause)
    VALUES ('ag_del_live', 'dellive', 1, 'ag_del_live', 'test', 'sovereign', 'reg-del-a', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', TRUE, TRUE, NULL, NULL),
           ('ag_del_dead', 'deldead', 1, 'ag_del_dead', 'test', 'sovereign', 'reg-del-a', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE, FALSE, now(), 'test'),
           ('ag_del_b', 'delb', 1, 'ag_del_b', 'test', 'sovereign', 'reg-del-b', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', TRUE, TRUE, NULL, NULL),
           ('ag_del_bdead', 'delbdead', 1, 'ag_del_bdead', 'test', 'sovereign', 'reg-del-b', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE, FALSE, now(), 'test');
  INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status) VALUES
    ('ag-del-live', 'reg-del-a', 'ag_del_live', 'dellive', 'claude-code', 'active'),
    ('ag-del-dead', 'reg-del-a', 'ag_del_dead', 'deldead', 'claude-code', 'retired'),
    ('ag-del-b', 'reg-del-b', 'ag_del_b', 'delb', 'claude-code', 'active'),
    ('ag-del-bdead', 'reg-del-b', 'ag_del_bdead', 'delbdead', 'claude-code', 'retired');
  INSERT INTO mcp_budget (life_id, credits, accrued_at) VALUES
    ('ag_del_live', 10, now()), ('ag_del_dead', 10, now()), ('ag_del_b', 10, now()), ('ag_del_bdead', 10, now());
  INSERT INTO mcp_sleep_marks (life_id, last_sleep_day) VALUES
    ('ag_del_live', 1), ('ag_del_dead', 1), ('ag_del_b', 1), ('ag_del_bdead', 1);
  INSERT INTO mcp_journal (life_id, at, text) VALUES
    ('ag_del_live', now(), 'live journal'), ('ag_del_dead', now(), 'dead journal'),
    ('ag_del_b', now(), 'b journal'), ('ag_del_bdead', now(), 'bdead journal');
  INSERT INTO thoughts (thought_id, life_id, at) VALUES
    ('th-del-live', 'ag_del_live', now()), ('th-del-dead', 'ag_del_dead', now()),
    ('th-del-b', 'ag_del_b', now()), ('th-del-bdead', 'ag_del_bdead', now());
  INSERT INTO mcp_tokens (token_id, player_id, token_hash, expires_at) VALUES
    ('mtok-del-live', 'ag-del-live', decode(repeat('a1', 32), 'hex'), now() + interval '30 days'),
    ('mtok-del-dead', 'ag-del-dead', decode(repeat('a2', 32), 'hex'), now() + interval '30 days'),
    ('mtok-del-b', 'ag-del-b', decode(repeat('b1', 32), 'hex'), now() + interval '30 days');
  INSERT INTO owner_api_keys (key_id, owner_id, key_hash, scopes, expires_at) VALUES
    ('gok-0000000000de1e01', 'reg-del-a', decode(repeat('de', 31) || '01', 'hex'), ARRAY['read'], now() + interval '90 days'),
    ('gok-0000000000de1e02', 'reg-del-b', decode(repeat('de', 31) || '02', 'hex'), ARRAY['read'], now() + interval '90 days');
  INSERT INTO mcp_roster (player_name, owner_id) VALUES ('del-a-roster', 'reg-del-a'), ('del-b-roster', 'reg-del-b');
  INSERT INTO body_ops (owner_id, player_name, op) VALUES ('reg-del-a', 'dellive', 'start'), ('reg-del-b', 'delb', 'start');
  INSERT INTO register_sessions (session_hash, owner_id, identity_hash, signed_in_ms, last_seen_ms, expires_ms) VALUES
    (decode(repeat('5a', 32), 'hex'), 'reg-del-a', hash_a, 1000, 1000, 9000000000000),
    (decode(repeat('5b', 32), 'hex'), 'reg-del-b', hash_b, 1000, 1000, 9000000000000);
  INSERT INTO register_consents (identity_hash, terms_version) VALUES (hash_a, 'terms-1'), (hash_b, 'terms-1');
  INSERT INTO kino_admins (identity_hash) VALUES (hash_a), (hash_b);
  -- 0040: kino_audit rows carry the identity hash as hex (glass loginHash returns the identity hash itself),
  -- so owner a's two rows are erased and owner b's row is kept
  INSERT INTO kino_audit (event, login_hash, agent_id, pane_id, mode, at) VALUES
    ('pane_opened', encode(hash_a, 'hex'), 'ag_del_live', 'pn_' || repeat('0', 25) || '1', 'follow', now()),
    ('pane_closed', encode(hash_a, 'hex'), 'ag_del_live', 'pn_' || repeat('0', 25) || '1', 'follow', now()),
    ('pane_opened', encode(hash_b, 'hex'), 'ag_del_b', 'pn_' || repeat('0', 25) || '2', 'follow', now());

  -- 0040: one row in every table keyed by a life, for each of the four lives (a live and a dead life of owner a,
  -- owner b's live and dead lives). Owner a's four lives must leave no row; owner b's two lives keep one row each.
  INSERT INTO events (source_event_id, at, world_day, world_tick, type, agent_id, payload, thinker_id) VALUES
    ('del-ev-ag_del_live', now(), 1, 1, 'test.life', 'ag_del_live', '{}', NULL),
    ('del-ev-ag_del_dead', now(), 1, 1, 'test.life', 'ag_del_dead', '{}', NULL),
    ('del-ev-ag_del_b', now(), 1, 1, 'test.life', 'ag_del_b', '{}', NULL),
    ('del-ev-ag_del_bdead', now(), 1, 1, 'test.life', 'ag_del_bdead', '{}', NULL),
    -- events keyed ONLY by thinker_id (agent_id NULL): the thinker arm of the events delete
    ('del-ev-th-live', now(), 1, 1, 'test.thinker', NULL, '{}', 'ag_del_live'),
    ('del-ev-th-dead', now(), 1, 1, 'test.thinker', NULL, '{}', 'ag_del_dead'),
    ('del-ev-th-b', now(), 1, 1, 'test.thinker', NULL, '{}', 'ag_del_b');
  INSERT INTO mcp_life_deaths (life_id, death_count, last_death_day) VALUES
    ('ag_del_live', 1, 1), ('ag_del_dead', 1, 1), ('ag_del_b', 1, 1), ('ag_del_bdead', 1, 1);
  INSERT INTO mcp_death_events (event_id, life_id) VALUES
    ('del-death-live', 'ag_del_live'), ('del-death-dead', 'ag_del_dead'),
    ('del-death-b', 'ag_del_b'), ('del-death-bdead', 'ag_del_bdead');
  INSERT INTO intents (intent_id, life_id, state) VALUES
    ('del-int-live', 'ag_del_live', 'completed'), ('del-int-dead', 'ag_del_dead', 'completed'),
    ('del-int-b', 'ag_del_b', 'completed'), ('del-int-bdead', 'ag_del_bdead', 'completed');
  INSERT INTO actions (action_id, intent_id, life_id, kind) VALUES
    ('del-act-live', 'del-int-live', 'ag_del_live', 'noop'), ('del-act-dead', 'del-int-dead', 'ag_del_dead', 'noop'),
    ('del-act-b', 'del-int-b', 'ag_del_b', 'noop'), ('del-act-bdead', 'del-int-bdead', 'ag_del_bdead', 'noop');
  INSERT INTO receipts (receipt_id, action_id, life_id, kind) VALUES
    ('del-rcpt-live', 'del-act-live', 'ag_del_live', 'final'), ('del-rcpt-dead', 'del-act-dead', 'ag_del_dead', 'final'),
    ('del-rcpt-b', 'del-act-b', 'ag_del_b', 'final'), ('del-rcpt-bdead', 'del-act-bdead', 'ag_del_bdead', 'final');
  INSERT INTO suppressed_wakeups (life_id, at, reason) VALUES
    ('ag_del_live', now(), 'test'), ('ag_del_dead', now(), 'test'), ('ag_del_b', now(), 'test'), ('ag_del_bdead', now(), 'test');
  INSERT INTO skills (skill_id, edition, name, author) VALUES ('sk-del-b', 1, 'b skill', 'ag_del_b');
  INSERT INTO skill_runs (skill_id, edition, life_id, outcome) VALUES
    ('sk-del-b', 1, 'ag_del_live', 'ok'), ('sk-del-b', 1, 'ag_del_dead', 'ok'),
    ('sk-del-b', 1, 'ag_del_b', 'ok'), ('sk-del-b', 1, 'ag_del_bdead', 'ok');
  INSERT INTO skill_library (agent_id, skill_id, edition, learned_day) VALUES
    ('ag_del_live', 'sk-del-b', 1, 1), ('ag_del_dead', 'sk-del-b', 1, 1),
    ('ag_del_b', 'sk-del-b', 1, 1), ('ag_del_bdead', 'sk-del-b', 1, 1);
  INSERT INTO memories (agent_id, kind, provenance, text) VALUES
    ('ag_del_live', 'episodic', 'observation', 'live memory'), ('ag_del_dead', 'episodic', 'observation', 'dead memory'),
    ('ag_del_b', 'episodic', 'observation', 'b memory'), ('ag_del_bdead', 'episodic', 'observation', 'bdead memory');
  INSERT INTO goals (agent_id, rank, goal, why) VALUES
    ('ag_del_live', 1, 'g', 'w'), ('ag_del_dead', 1, 'g', 'w'), ('ag_del_b', 1, 'g', 'w'), ('ag_del_bdead', 1, 'g', 'w');
  INSERT INTO relationships (agent_id, other_id, impression, trust, last_seen_day) VALUES
    ('ag_del_dead', 'ag_del_b', 'x', 1, 1), ('ag_del_b', 'ag_del_dead', 'y', 1, 1), ('ag_del_b', 'ag_del_bdead', 'z', 1, 1);
  INSERT INTO ledger (agent_id, item, count, world_day) VALUES
    ('ag_del_live', 'bread', 1, 1), ('ag_del_dead', 'bread', 1, 1), ('ag_del_b', 'bread', 1, 1), ('ag_del_bdead', 'bread', 1, 1);
  INSERT INTO votes (proposal_id, agent_id, vote, world_day) VALUES
    ('del-prop-1', 'ag_del_live', 'yes', 1), ('del-prop-1', 'ag_del_dead', 'yes', 1),
    ('del-prop-1', 'ag_del_b', 'no', 1), ('del-prop-1', 'ag_del_bdead', 'no', 1);
  -- 0040 (decision 0262): a dead life with an owner link and no player row (only the agents arm finds it), and a dead
  -- life with a player row and no owner link (only the player arm finds it)
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
                      declared_model, model_config, tier, personality_seed, thoughts_delayed_public, public_camera,
                      died_at, death_cause)
    VALUES ('ag_del_orphan', 'delorphan', 1, 'ag_del_orphan', 'test', 'sovereign', 'reg-del-a', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE, FALSE, now(), 'test'),
           ('ag_del_rel', 'delrel', 1, 'ag_del_rel', 'test', 'sovereign', NULL, 'claude-code', 'self-reported', 'declared:unverified', 'sovereign', 'seed', FALSE, FALSE, now(), 'test');
  INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status) VALUES
    ('ag-del-rel', 'reg-del-a', 'ag_del_rel', 'delrel', 'claude-code', 'retired');
  INSERT INTO memories (agent_id, kind, provenance, text) VALUES
    ('ag_del_orphan', 'episodic', 'observation', 'orphan memory'), ('ag_del_rel', 'episodic', 'observation', 'rel memory');
  INSERT INTO rolls (source_event_id, life_id, world_tick, decision_id, draw_index, engine_version, producer, fx,
    score, dc, mode, dice, kept, bonus, total, success) VALUES
    ('del-ev-ag_del_live', 'ag_del_live', 10, 'del-dec-live', 0, 1, 'body', 'mine', 3, 12, 'flat', '{7}', 7, 0, 7, false),
    ('del-ev-ag_del_dead', 'ag_del_dead', 10, 'del-dec-dead', 0, 1, 'body', 'mine', 3, 12, 'flat', '{7}', 7, 0, 7, false),
    ('del-ev-ag_del_b', 'ag_del_b', 10, 'del-dec-b', 0, 1, 'body', 'mine', 3, 12, 'flat', '{7}', 7, 0, 7, false),
    ('del-ev-ag_del_bdead', 'ag_del_bdead', 10, 'del-dec-bdead', 0, 1, 'body', 'mine', 3, 12, 'flat', '{7}', 7, 0, 7, false);
  INSERT INTO decisions (source_event_id, life_id, world_tick, decision_id, engine_version, producer, fx, kind) VALUES
    ('del-ev-ag_del_live', 'ag_del_live', 10, 'del-dec-live', 1, 'body', 'mine', 'd20'),
    ('del-ev-ag_del_dead', 'ag_del_dead', 10, 'del-dec-dead', 1, 'body', 'mine', 'd20'),
    ('del-ev-ag_del_b', 'ag_del_b', 10, 'del-dec-b', 1, 'body', 'mine', 'd20'),
    ('del-ev-ag_del_bdead', 'ag_del_bdead', 10, 'del-dec-bdead', 1, 'body', 'mine', 'd20');
  INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result) VALUES
    ('del-ev-ag_del_live', 'ag_del_live', repeat('ab', 32), '{}'::jsonb, 'birth', 'adopted'),
    ('del-ev-ag_del_dead', 'ag_del_dead', repeat('ab', 32), '{}'::jsonb, 'birth', 'adopted'),
    ('del-ev-ag_del_b', 'ag_del_b', repeat('ab', 32), '{}'::jsonb, 'birth', 'adopted'),
    ('del-ev-ag_del_bdead', 'ag_del_bdead', repeat('ab', 32), '{}'::jsonb, 'birth', 'adopted');
  INSERT INTO xp_evidence (life_id, domain, evidence_key, source_event_id, world_tick) VALUES
    ('ag_del_live', 'combat', 'del-k1', 'del-ev-ag_del_live', 10), ('ag_del_dead', 'combat', 'del-k1', 'del-ev-ag_del_dead', 10),
    ('ag_del_b', 'combat', 'del-k1', 'del-ev-ag_del_b', 10), ('ag_del_bdead', 'combat', 'del-k1', 'del-ev-ag_del_bdead', 10);
  INSERT INTO proficiency (life_id, domain, xp, level, updated_tick) VALUES
    ('ag_del_live', 'combat', 5, 0, 10), ('ag_del_dead', 'combat', 5, 0, 10),
    ('ag_del_b', 'combat', 5, 0, 10), ('ag_del_bdead', 'combat', 5, 0, 10);
  INSERT INTO proficiency_outbox (life_id, domain, level, xp, version) VALUES
    ('ag_del_live', 'combat', 1, 5, 1), ('ag_del_dead', 'combat', 1, 5, 1),
    ('ag_del_b', 'combat', 1, 5, 1), ('ag_del_bdead', 'combat', 1, 5, 1);

  step := 'privilege: geldar_register may execute, PUBLIC may not, the definer runs with the pinned search_path';
  IF NOT has_function_privilege('geldar_register', 'register_account_delete(bytea)', 'EXECUTE') THEN
    RAISE EXCEPTION 'account delete: geldar_register cannot execute';
  END IF;
  IF has_function_privilege('public', 'register_account_delete(bytea)', 'EXECUTE') THEN
    RAISE EXCEPTION 'account delete: PUBLIC can execute';
  END IF;
  SELECT prosecdef, proconfig INTO r FROM pg_proc WHERE proname = 'register_account_delete';
  IF NOT r.prosecdef OR NOT ('search_path=pg_catalog, public, pg_temp' = ANY (r.proconfig)) THEN
    RAISE EXCEPTION 'account delete: not a definer with the pinned search_path';
  END IF;

  step := 'forced failure at the last statement: the whole delete rolls back, triggers stay on, no thought can be deleted';
  CREATE TRIGGER check_account_delete_refuse_audit BEFORE INSERT ON register_audit
    FOR EACH ROW EXECUTE FUNCTION check_account_delete_refuse_audit();
  BEGIN
    PERFORM register_account_delete(hash_a);
  EXCEPTION WHEN raise_exception THEN
    forced := (SQLERRM = 'check forced audit failure');
  END;
  IF NOT forced THEN RAISE EXCEPTION 'account delete: the forced audit failure was not raised'; END IF;
  SELECT count(*) INTO n FROM pg_trigger t
    WHERE t.tgname IN ('mcp_journal_append_only', 'thoughts_append_only', 'receipts_append_only', 'suppressed_wakeups_append_only')
      AND t.tgenabled = 'O';
  IF n <> 4 THEN RAISE EXCEPTION 'account delete: a failed delete left an append-only trigger disabled'; END IF;
  SELECT EXISTS (SELECT 1 FROM mcp_identities WHERE identity_hash = hash_a) INTO found;
  IF NOT found THEN RAISE EXCEPTION 'account delete: a failed delete removed the identity'; END IF;
  SELECT count(*) INTO n FROM thoughts WHERE thought_id = 'th-del-live';
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: a failed delete removed a living thought'; END IF;
  SELECT count(*) INTO n FROM mcp_tokens WHERE token_id = 'mtok-del-live' AND revoked_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: a failed delete left a token revoked'; END IF;
  SELECT count(*) INTO n FROM kino_audit WHERE login_hash = encode(hash_a, 'hex');
  IF n <> 2 THEN RAISE EXCEPTION 'account delete: a failed delete removed a kino audit row'; END IF;
  BEGIN
    DELETE FROM thoughts WHERE thought_id = 'th-del-b';
  EXCEPTION WHEN others THEN
    refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'account delete: a thought of another owner can be deleted'; END IF;
  DROP TRIGGER check_account_delete_refuse_audit ON register_audit;
  DROP FUNCTION check_account_delete_refuse_audit();
  -- the forced call above is not the owner's real call: it leaves no audit row and no capture row
  SELECT count(*) INTO n FROM check_account_delete_capture;
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: a rolled back delete left capture rows'; END IF;

  step := 'first delete of a: true; a identity, owner, tokens, keys, player and living thoughts are gone';
  SELECT coalesce(max(id), 0) INTO audit_before FROM register_audit;
  IF NOT register_account_delete(hash_a) THEN
    RAISE EXCEPTION 'account delete: first delete returned false';
  END IF;
  SELECT EXISTS (SELECT 1 FROM mcp_identities WHERE identity_hash = hash_a) INTO found;
  IF found THEN RAISE EXCEPTION 'account delete: unbanned identity row kept'; END IF;
  SELECT count(*) INTO n FROM mcp_owners WHERE owner_id = 'reg-del-a';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: owner row kept'; END IF;
  SELECT count(*) INTO n FROM owner_api_keys WHERE owner_id = 'reg-del-a';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: owner key kept'; END IF;
  SELECT count(*) INTO n FROM mcp_players WHERE owner_id = 'reg-del-a';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: player row kept'; END IF;
  SELECT count(*) INTO n FROM body_ops WHERE owner_id = 'reg-del-a';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: body op of owner a kept'; END IF;
  SELECT count(*) INTO n FROM register_sessions WHERE identity_hash = hash_a;
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: register session of owner a kept'; END IF;
  SELECT count(*) INTO n FROM register_consents WHERE identity_hash = hash_a;
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: consent of owner a kept'; END IF;
  SELECT count(*) INTO n FROM kino_admins WHERE identity_hash = hash_a;
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: kino admin of owner a kept'; END IF;
  SELECT count(*) INTO n FROM kino_audit WHERE login_hash = encode(hash_a, 'hex');
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: kino audit rows of owner a kept'; END IF;
  SELECT count(*) INTO n FROM mcp_journal WHERE life_id = 'ag_del_live';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: journal of a living life kept'; END IF;
  SELECT count(*) INTO n FROM thoughts WHERE thought_id = 'th-del-live';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: thoughts of a living life kept'; END IF;
  SELECT count(*) INTO n FROM mcp_sleep_marks WHERE life_id = 'ag_del_live';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: sleep marks of a living life kept'; END IF;
  SELECT count(*) INTO n FROM mcp_budget WHERE life_id = 'ag_del_live';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: budget of a living life kept'; END IF;

  step := 'tokens: both tokens of a were revoked before they were deleted (the mcp_token_revoked NOTIFY path), with lock_timeout 3s';
  SELECT count(*) INTO n FROM mcp_tokens WHERE player_id IN ('ag-del-live', 'ag-del-dead');
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: token of a player of a kept'; END IF;
  SELECT count(*) INTO n FROM check_account_delete_capture
    WHERE token_id IN ('mtok-del-live', 'mtok-del-dead') AND was_revoked AND lock_wait = '3s';
  IF n <> 2 THEN RAISE EXCEPTION 'account delete: % of a token rows were revoked with lock_timeout 3s, expected 2', n; END IF;

  step := 'dead life is erased too (decision 0262): journal, thought, sleep mark and budget gone; the agents row stays with no owner link';
  SELECT count(*) INTO n FROM mcp_journal WHERE life_id = 'ag_del_dead';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: journal of a dead life kept'; END IF;
  SELECT count(*) INTO n FROM thoughts WHERE thought_id = 'th-del-dead';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: thought of a dead life kept'; END IF;
  SELECT count(*) INTO n FROM mcp_sleep_marks WHERE life_id = 'ag_del_dead';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: sleep mark of a dead life kept'; END IF;
  SELECT count(*) INTO n FROM mcp_budget WHERE life_id = 'ag_del_dead';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: budget of a dead life kept'; END IF;
  SELECT count(*) INTO n FROM memories WHERE agent_id = 'ag_del_orphan';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: memory of a dead life with an owner link and no player row kept'; END IF;
  SELECT count(*) INTO n FROM memories WHERE agent_id = 'ag_del_rel';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: memory of a dead life reached only by its player row kept'; END IF;
  SELECT owner INTO STRICT owner_val FROM agents WHERE agent_id = 'ag_del_dead';
  IF owner_val IS NOT NULL THEN RAISE EXCEPTION 'account delete: dead life keeps an owner link'; END IF;
  SELECT owner, died_at IS NOT NULL AS dead, death_cause, public_camera, thoughts_delayed_public
    INTO STRICT r FROM agents WHERE agent_id = 'ag_del_dead';
  IF r.death_cause <> 'test' OR NOT r.dead THEN RAISE EXCEPTION 'account delete: dead life death record changed'; END IF;

  step := 'a living life is retired: died_at set, death_cause owner-erased, public_camera and thoughts_delayed_public FALSE, owner NULL';
  SELECT owner, died_at IS NOT NULL AS dead, death_cause, public_camera, thoughts_delayed_public
    INTO STRICT r FROM agents WHERE agent_id = 'ag_del_live';
  IF r.owner IS NOT NULL THEN RAISE EXCEPTION 'account delete: living life keeps an owner link'; END IF;
  IF NOT r.dead THEN RAISE EXCEPTION 'account delete: living life not retired (died_at null)'; END IF;
  IF r.death_cause IS DISTINCT FROM 'owner-erased' THEN RAISE EXCEPTION 'account delete: living life death_cause is %', r.death_cause; END IF;
  IF r.public_camera OR r.thoughts_delayed_public THEN RAISE EXCEPTION 'account delete: retired life still public'; END IF;

  step := 'two-owner fixture: owner b keeps every row (owner, player, token, key, roster, body op, session, consent, admin, budget, sleep, journal, thought, agent link, public flags)';
  SELECT count(*) INTO n FROM mcp_owners WHERE owner_id = 'reg-del-b';
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: other owner row removed'; END IF;
  SELECT count(*) INTO n FROM mcp_players WHERE owner_id = 'reg-del-b';
  IF n <> 2 THEN RAISE EXCEPTION 'account delete: other owner players removed (% left)', n; END IF;
  SELECT count(*) INTO n FROM mcp_tokens WHERE token_id = 'mtok-del-b' AND revoked_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: other owner token removed or revoked'; END IF;
  SELECT count(*) INTO n FROM owner_api_keys WHERE key_id = 'gok-0000000000de1e02';
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: other owner key removed'; END IF;
  SELECT count(*) INTO n FROM mcp_roster WHERE owner_id = 'reg-del-b';
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: other owner roster row removed'; END IF;
  SELECT count(*) INTO n FROM body_ops WHERE owner_id = 'reg-del-b';
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: other owner body op removed'; END IF;
  SELECT count(*) INTO n FROM register_sessions WHERE session_hash = decode(repeat('5b', 32), 'hex');
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: other owner session removed'; END IF;
  SELECT count(*) INTO n FROM register_consents WHERE identity_hash = hash_b;
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: other owner consent removed'; END IF;
  SELECT count(*) INTO n FROM kino_admins WHERE identity_hash = hash_b;
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: other owner kino admin row removed'; END IF;
  SELECT count(*) INTO n FROM kino_audit WHERE login_hash = encode(hash_b, 'hex');
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: other owner kino audit row removed'; END IF;
  SELECT count(*) INTO n FROM mcp_budget WHERE life_id IN ('ag_del_b', 'ag_del_bdead');
  IF n <> 2 THEN RAISE EXCEPTION 'account delete: other owner budget removed'; END IF;
  SELECT count(*) INTO n FROM mcp_sleep_marks WHERE life_id IN ('ag_del_b', 'ag_del_bdead');
  IF n <> 2 THEN RAISE EXCEPTION 'account delete: other owner sleep marks removed'; END IF;
  SELECT count(*) INTO n FROM mcp_journal WHERE life_id IN ('ag_del_b', 'ag_del_bdead');
  IF n <> 2 THEN RAISE EXCEPTION 'account delete: other owner journal removed'; END IF;
  SELECT count(*) INTO n FROM thoughts WHERE thought_id IN ('th-del-b', 'th-del-bdead');
  IF n <> 2 THEN RAISE EXCEPTION 'account delete: other owner thoughts removed'; END IF;
  SELECT owner, died_at IS NULL AS alive, public_camera, thoughts_delayed_public
    INTO STRICT r FROM agents WHERE agent_id = 'ag_del_b';
  IF r.owner IS DISTINCT FROM 'reg-del-b' OR NOT r.alive OR NOT r.public_camera OR NOT r.thoughts_delayed_public THEN
    RAISE EXCEPTION 'account delete: other owner living agent changed';
  END IF;
  SELECT owner, died_at IS NOT NULL AS dead INTO STRICT r FROM agents WHERE agent_id = 'ag_del_bdead';
  IF r.owner IS DISTINCT FROM 'reg-del-b' OR NOT r.dead THEN RAISE EXCEPTION 'account delete: other owner dead agent changed'; END IF;

  step := 'one audit row, with an erasure actor that is not the owner id hash';
  SELECT count(*) INTO n FROM register_audit WHERE id > audit_before;
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: % audit rows written, expected 1', n; END IF;
  SELECT count(*) INTO n FROM register_audit WHERE id > audit_before AND actor = actor_a;
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: audit row keyed by the owner id hash'; END IF;
  -- the erasure actor is random: it is neither the owner id, nor its hash prefix, nor anything that contains either
  SELECT count(*) INTO n FROM register_audit WHERE id > audit_before
    AND (actor = 'reg-del-a' OR position('reg-del-a' IN actor) > 0 OR position(actor_a IN actor) > 0);
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: audit actor names the owner id or derives from it'; END IF;

  step := 'second delete of a is a no-op: false, and no audit row';
  IF register_account_delete(hash_a) THEN
    RAISE EXCEPTION 'account delete: second delete returned true';
  END IF;
  SELECT count(*) INTO n FROM register_audit WHERE id > audit_before;
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: second delete wrote an audit row'; END IF;

  step := 'banned c: true; the tombstone keeps the hash and the ban with no owner; sign-in finds it banned';
  IF NOT register_account_delete(hash_c) THEN
    RAISE EXCEPTION 'account delete: banned identity delete returned false';
  END IF;
  SELECT i.owner_id, i.banned_at IS NOT NULL AS banned INTO STRICT r FROM mcp_identities i WHERE i.identity_hash = hash_c;
  IF r.owner_id IS NOT NULL OR NOT r.banned THEN RAISE EXCEPTION 'account delete: tombstone wrong'; END IF;
  SELECT count(*) INTO n FROM mcp_owners WHERE owner_id = 'reg-del-c';
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: banned owner row kept'; END IF;
  SELECT f.banned INTO STRICT banned_val FROM register_find_owner(hash_c) f;
  IF NOT banned_val THEN RAISE EXCEPTION 'account delete: tombstone not seen as banned'; END IF;

  step := 'unbanned a: no identity left, so a sign-in finds no owner';
  SELECT count(*) INTO n FROM register_find_owner(hash_a);
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: unbanned hash left behind'; END IF;

  step := 'every table keyed by a life (0040): no row of owner a lives left; owner b lives keep one row each';
  FOREACH tc IN ARRAY ARRAY[
    'mcp_journal:life_id', 'thoughts:life_id', 'mcp_budget:life_id', 'mcp_sleep_marks:life_id',
    'mcp_life_deaths:life_id', 'mcp_death_events:life_id', 'intents:life_id', 'actions:life_id',
    'receipts:life_id', 'suppressed_wakeups:life_id', 'skill_runs:life_id', 'memories:agent_id',
    'goals:agent_id', 'skill_library:agent_id', 'ledger:agent_id', 'votes:agent_id', 'events:agent_id',
    'rolls:life_id', 'decisions:life_id', 'character_sheet_adoptions:life_id', 'xp_evidence:life_id',
    'proficiency:life_id', 'proficiency_outbox:life_id'] LOOP
    tbl := split_part(tc, ':', 1);
    col := split_part(tc, ':', 2);
    EXECUTE format('SELECT count(*) FROM %I WHERE %I = ANY (ARRAY[''ag_del_live'', ''ag_del_dead''])', tbl, col) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'account delete: % row(s) of a life of owner a left in %', n, tbl; END IF;
    EXECUTE format('SELECT count(*) FROM %I WHERE %I = ANY (ARRAY[''ag_del_b'', ''ag_del_bdead''])', tbl, col) INTO n;
    IF n <> 2 THEN RAISE EXCEPTION 'account delete: owner b rows in % are % (expected 2)', tbl, n; END IF;
  END LOOP;
  -- events of owner a's lives keyed by thinker_id alone are erased (live and dead); owner b's is kept
  SELECT count(*) INTO n FROM events WHERE source_event_id IN ('del-ev-th-live', 'del-ev-th-dead');
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: % event(s) keyed by thinker_id of a life of owner a left', n; END IF;
  SELECT count(*) INTO n FROM events WHERE source_event_id = 'del-ev-th-b' AND thinker_id = 'ag_del_b';
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: owner b event keyed by thinker_id removed'; END IF;
  SELECT count(*) INTO n FROM relationships
    WHERE agent_id IN ('ag_del_live', 'ag_del_dead') OR other_id IN ('ag_del_live', 'ag_del_dead');
  IF n <> 0 THEN RAISE EXCEPTION 'account delete: % relationship row(s) of a life of owner a left', n; END IF;
  SELECT count(*) INTO n FROM relationships WHERE agent_id = 'ag_del_b' AND other_id = 'ag_del_bdead';
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: owner b relationship removed'; END IF;
  SELECT count(*) INTO n FROM skills WHERE skill_id = 'sk-del-b';
  IF n <> 1 THEN RAISE EXCEPTION 'account delete: shared skill of owner b removed'; END IF;

  step := 'triggers on: the four append-only triggers are enabled after the delete';
  SELECT count(*) INTO n FROM pg_trigger t
    WHERE t.tgname IN ('mcp_journal_append_only', 'thoughts_append_only', 'receipts_append_only', 'suppressed_wakeups_append_only')
      AND t.tgenabled = 'O';
  IF n <> 4 THEN RAISE EXCEPTION 'account delete: an append-only trigger is not enabled after the delete'; END IF;
END
$account_delete$;

-- The lock timeout must be transaction-local (set_config(..., true)). The DO block above is one transaction, so it
-- cannot see a session-wide setting. This top-level call runs in its own autocommit transaction with an unknown hash
-- (set_config runs first, then the function returns false); the next top-level statement is a new transaction and must
-- see the default lock_timeout of 0.
SELECT register_account_delete(decode(repeat('ee', 32), 'hex'));
DO $lock_local$
BEGIN
  IF current_setting('lock_timeout') <> '0' THEN
    RAISE EXCEPTION 'account delete: lock_timeout leaked out of the delete transaction (%)', current_setting('lock_timeout');
  END IF;
END
$lock_local$;

DROP TRIGGER check_account_delete_capture ON mcp_tokens;
DROP FUNCTION check_account_delete_capture();
DROP TABLE check_account_delete_capture;
