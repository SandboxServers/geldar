-- Migration 0067 (C7-13a-sql, decision 0172): register_skin_submit and register_skin_status. Run after check-schema.sql
-- and the migrations through 0067, once, on a fresh database (as ci.yml does): the fixtures are not removed, and the
-- owners and hashes are fixed. Owners skin-rules-a (the rate and lock cases), skin-rules-b (the 30-day window),
-- skin-rules-c (an admin owner, 0170), skin-rules-d (a banned owner) and skin-rules-e (an owner with no upload).
-- Identity hashes are 7c..01 to 05, used nowhere else. The account delete of owner a is in
-- check-schema-account-delete.sql.
-- Every time-based rule is tested with now() fixed inside this one transaction, so 59:59 and 60:00 are exact.

CREATE FUNCTION check_skin_try(h BYTEA, p TEXT, png BYTEA, sh BYTEA) RETURNS TEXT
LANGUAGE plpgsql AS $try$
BEGIN
  PERFORM register_skin_submit(h, p, png, sh);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END
$try$;

CREATE FUNCTION check_skin_status_try(h BYTEA, p TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $status_try$
BEGIN
  PERFORM 1 FROM register_skin_status(h, p);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END
$status_try$;

DO $skin_rules$
DECLARE
  png BYTEA := decode('89504e470d0a1a0a', 'hex');
  png_big BYTEA := decode('89504e470d0a1a0a', 'hex') || decode(repeat('00', 32761), 'hex');
  h_a BYTEA := decode(repeat('7c', 31) || '01', 'hex');
  h_b BYTEA := decode(repeat('7c', 31) || '02', 'hex');
  h_c BYTEA := decode(repeat('7c', 31) || '03', 'hex');
  h_d BYTEA := decode(repeat('7c', 31) || '04', 'hex');
  h_e BYTEA := decode(repeat('7c', 31) || '05', 'hex');
  got TEXT;
  n INT;
BEGIN
  INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES
    ('skin-rules-a', 'a', 5), ('skin-rules-b', 'b', 5), ('skin-rules-c', 'c', 5),
    ('skin-rules-d', 'd', 5), ('skin-rules-e', 'e', 5);
  INSERT INTO mcp_identities (identity_hash, provider, owner_id, banned_at) VALUES
    (h_a, 'github', 'skin-rules-a', NULL), (h_b, 'github', 'skin-rules-b', NULL), (h_c, 'github', 'skin-rules-c', NULL),
    (h_d, 'github', 'skin-rules-d', now()), (h_e, 'github', 'skin-rules-e', NULL);
  -- mcp_players.life_id references agents: one agents row per life (the fixture lives, as the other check files insert them)
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, harness, declared_model, model_config, tier) VALUES
    ('skin_rules_p1', 'rulesp1', 1, 'skin_rules_p1', 'test', 'sovereign', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign'),
    ('skin_rules_p2', 'rulesp2', 1, 'skin_rules_p2', 'test', 'sovereign', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign'),
    ('skin_rules_p3', 'rulesp3', 1, 'skin_rules_p3', 'test', 'sovereign', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign'),
    ('skin_rules_p4', 'rulesp4', 1, 'skin_rules_p4', 'test', 'sovereign', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign'),
    ('skin_rules_q', 'rulesq', 1, 'skin_rules_q', 'test', 'sovereign', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign'),
    ('skin_rules_s', 'ruless', 1, 'skin_rules_s', 'test', 'sovereign', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign'),
    ('skin_rules_k1', 'rulesk1', 1, 'skin_rules_k1', 'test', 'sovereign', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign'),
    ('skin_rules_k2', 'rulesk2', 1, 'skin_rules_k2', 'test', 'sovereign', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign'),
    ('skin_rules_k3', 'rulesk3', 1, 'skin_rules_k3', 'test', 'sovereign', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign'),
    ('skin_rules_k4', 'rulesk4', 1, 'skin_rules_k4', 'test', 'sovereign', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign'),
    ('skin_rules_d1', 'rulesd1', 1, 'skin_rules_d1', 'test', 'sovereign', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign'),
    ('skin_rules_e1', 'rulese1', 1, 'skin_rules_e1', 'test', 'sovereign', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign');
  INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status) VALUES
    ('ag-skin-rules-p1','skin-rules-a', 'skin_rules_p1', 'rulesp1', 'claude-code', 'active'),
    ('ag-skin-rules-p2', 'skin-rules-a', 'skin_rules_p2', 'rulesp2', 'claude-code', 'active'),
    ('ag-skin-rules-p3', 'skin-rules-a', 'skin_rules_p3', 'rulesp3', 'claude-code', 'active'),
    ('ag-skin-rules-p4', 'skin-rules-a', 'skin_rules_p4', 'rulesp4', 'claude-code', 'active'),
    ('ag-skin-rules-q', 'skin-rules-b', 'skin_rules_q', 'rulesq', 'claude-code', 'active'),
    ('ag-skin-rules-s', 'skin-rules-b', 'skin_rules_s', 'ruless', 'claude-code', 'active'),
    ('ag-skin-rules-k1', 'skin-rules-c', 'skin_rules_k1', 'rulesk1', 'claude-code', 'active'),
    ('ag-skin-rules-k2', 'skin-rules-c', 'skin_rules_k2', 'rulesk2', 'claude-code', 'active'),
    ('ag-skin-rules-k3', 'skin-rules-c', 'skin_rules_k3', 'rulesk3', 'claude-code', 'active'),
    ('ag-skin-rules-k4', 'skin-rules-c', 'skin_rules_k4', 'rulesk4', 'claude-code', 'active'),
    ('ag-skin-rules-d1', 'skin-rules-d', 'skin_rules_d1', 'rulesd1', 'claude-code', 'active'),
    ('ag-skin-rules-e1', 'skin-rules-e', 'skin_rules_e1', 'rulese1', 'claude-code', 'active');

  -- the daily cap is per agent (0172 point 2): owner a uploads on p1 to p4, four uploads of the owner, all accepted
  got := check_skin_try(h_a, 'ag-skin-rules-p1', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: upload 1 refused: %', got; END IF;
  got := check_skin_try(h_a, 'ag-skin-rules-p2', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: upload 2 refused: %', got; END IF;
  got := check_skin_try(h_a, 'ag-skin-rules-p3', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: upload 3 refused: %', got; END IF;
  got := check_skin_try(h_a, 'ag-skin-rules-p4', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: upload 4 of the owner (other agent) refused: %', got; END IF;

  -- the per-agent daily cap: p1 is approved after each upload so that only the daily count applies
  UPDATE skin_uploads SET status = 'approved', decided_at = now(), decided_by = 'op'
    WHERE player_id = 'ag-skin-rules-p1' AND status = 'pending';
  got := check_skin_try(h_a, 'ag-skin-rules-p1', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: p1 second upload refused: %', got; END IF;
  UPDATE skin_uploads SET status = 'approved', decided_at = now(), decided_by = 'op'
    WHERE player_id = 'ag-skin-rules-p1' AND status = 'pending';
  got := check_skin_try(h_a, 'ag-skin-rules-p1', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: p1 third upload refused: %', got; END IF;
  UPDATE skin_uploads SET status = 'approved', decided_at = now(), decided_by = 'op'
    WHERE player_id = 'ag-skin-rules-p1' AND status = 'pending';
  got := check_skin_try(h_a, 'ag-skin-rules-p1', png, sha256(png));
  IF got <> 'skin_upload_daily' THEN RAISE EXCEPTION 'skin rules: p1 fourth upload of the day must hit the daily cap, got %', got; END IF;

  -- error paths: another owner's agent, one pending per agent, the size cap, a NULL PNG, a sha256 that does not match
  got := check_skin_try(h_b, 'ag-skin-rules-p1', png, sha256(png));
  IF got <> 'register_skin_submit: not your agent' THEN RAISE EXCEPTION 'skin rules: cross-owner submit not refused: %', got; END IF;
  got := check_skin_try(h_a, 'ag-skin-rules-p2', png, sha256(png));
  IF got <> 'skin_upload_pending' THEN RAISE EXCEPTION 'skin rules: second pending upload not refused: %', got; END IF;
  got := check_skin_try(h_a, 'ag-skin-rules-p4', png_big, sha256(png_big));
  IF got <> 'register_skin_submit: image too large' THEN RAISE EXCEPTION 'skin rules: 32769 bytes not refused: %', got; END IF;
  got := check_skin_try(h_a, 'ag-skin-rules-p4', NULL, NULL);
  IF got <> 'register_skin_submit: not a PNG' THEN RAISE EXCEPTION 'skin rules: NULL png not refused: %', got; END IF;
  got := check_skin_try(h_a, 'ag-skin-rules-p4', png, decode(repeat('00', 32), 'hex'));
  IF got <> 'register_skin_submit: sha256 does not match the PNG' THEN RAISE EXCEPTION 'skin rules: bad sha256 not refused: %', got; END IF;
  got := check_skin_try(h_a, 'ag-skin-rules-p4', png, NULL);
  IF got <> 'register_skin_submit: sha256 does not match the PNG' THEN RAISE EXCEPTION 'skin rules: NULL sha256 not refused: %', got; END IF;
  -- the PNG signature: 20 bytes without it (a valid sha256 of them), and 7 bytes of the signature prefix (too short)
  got := check_skin_try(h_a, 'ag-skin-rules-p4', decode(repeat('00', 20), 'hex'), sha256(decode(repeat('00', 20), 'hex')));
  IF got <> 'register_skin_submit: not a PNG' THEN RAISE EXCEPTION 'skin rules: 20 bytes without the PNG signature not refused: %', got; END IF;
  got := check_skin_try(h_a, 'ag-skin-rules-p4', decode('89504e470d0a1a', 'hex'), sha256(decode('89504e470d0a1a', 'hex')));
  IF got <> 'register_skin_submit: not a PNG' THEN RAISE EXCEPTION 'skin rules: 7-byte PNG prefix not refused: %', got; END IF;
  -- a banned owner (0067 refuses it as not an owner, as the other owner write functions do): no row, no audit row
  got := check_skin_try(h_d, 'ag-skin-rules-d1', png, sha256(png));
  IF got <> 'register_skin_submit: not an owner' THEN RAISE EXCEPTION 'skin rules: banned owner not refused: %', got; END IF;
  SELECT count(*) INTO n FROM skin_uploads WHERE owner_id = 'skin-rules-d';
  IF n <> 0 THEN RAISE EXCEPTION 'skin rules: banned owner wrote % skin upload row(s)', n; END IF;
  SELECT count(*) INTO n FROM skin_uploads WHERE player_id = 'ag-skin-rules-p4';
  IF n <> 1 THEN RAISE EXCEPTION 'skin rules: refused uploads wrote rows (p4 has % rows, expected 1)', n; END IF;

  -- the reject wait, per agent: p2 is rejected 59:59 ago, then 60:00 ago
  UPDATE skin_uploads SET status = 'rejected', reason_code = 'other', decided_at = now() - interval '59 minutes 59 seconds',
    decided_by = 'op' WHERE player_id = 'ag-skin-rules-p2' AND status = 'pending';
  got := check_skin_try(h_a, 'ag-skin-rules-p2', png, sha256(png));
  IF got <> 'skin_upload_wait' THEN RAISE EXCEPTION 'skin rules: reject wait at 59:59 must refuse, got %', got; END IF;
  UPDATE skin_uploads SET decided_at = now() - interval '60 minutes' WHERE player_id = 'ag-skin-rules-p2' AND status = 'rejected';
  got := check_skin_try(h_a, 'ag-skin-rules-p2', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: reject wait at 60:00 must allow, got %', got; END IF;

  -- three rejects of owner a within 30 days lock it: p2 (60 min, and a second p2 upload at 2 days), p3 and p4 (3 days)
  UPDATE skin_uploads SET status = 'rejected', reason_code = 'other', decided_at = now() - interval '2 days',
    decided_by = 'op' WHERE player_id = 'ag-skin-rules-p2' AND status = 'pending';
  UPDATE skin_uploads SET status = 'rejected', reason_code = 'other', decided_at = now() - interval '3 days',
    decided_by = 'op' WHERE player_id IN ('ag-skin-rules-p3', 'ag-skin-rules-p4') AND status = 'pending';
  got := check_skin_try(h_a, 'ag-skin-rules-p1', png, sha256(png));
  IF got <> 'skin_upload_locked' THEN RAISE EXCEPTION 'skin rules: three rejects in 30 days must lock, got %', got; END IF;

  -- the lock holds beyond 30 days: every reject is 40 days old, and the owner is still locked until the operator clears it
  UPDATE skin_uploads SET decided_at = now() - interval '40 days' WHERE owner_id = 'skin-rules-a' AND status = 'rejected';
  got := check_skin_try(h_a, 'ag-skin-rules-p1', png, sha256(png));
  IF got <> 'skin_upload_locked' THEN RAISE EXCEPTION 'skin rules: lock must hold after 30 days until cleared, got %', got; END IF;
  -- the operator clear (one statement, worknote C7-13a) releases the lock
  UPDATE skin_uploads SET lock_cleared_at = now() WHERE owner_id = 'skin-rules-a' AND status = 'rejected' AND lock_cleared_at IS NULL;
  got := check_skin_try(h_a, 'ag-skin-rules-p3', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: lock must release after the operator clear, got %', got; END IF;

  -- the 30-day window counts decided_at, not created_at: owner b has three rejects, all created 40 days ago,
  -- decided 32, 10 and 1 days ago. That spans more than 30 days, so the newest reject sees only two: not locked.
  INSERT INTO skin_uploads (owner_id, player_id, png, sha256, status, reason_code, created_at, decided_at, decided_by) VALUES
    ('skin-rules-b', 'ag-skin-rules-q', png, sha256(png), 'rejected', 'other', now() - interval '40 days', now() - interval '32 days', 'op'),
    ('skin-rules-b', 'ag-skin-rules-q', png, sha256(png), 'rejected', 'other', now() - interval '40 days', now() - interval '10 days', 'op'),
    ('skin-rules-b', 'ag-skin-rules-q', png, sha256(png), 'rejected', 'other', now() - interval '40 days', now() - interval '1 day', 'op');
  got := check_skin_try(h_b, 'ag-skin-rules-s', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: rejects spread over 32 days must not lock owner b, got %', got; END IF;
  -- the oldest reject moves to 29 days: four rejects of owner b are not all in one window, but 29, 10 and 1 are: locked
  UPDATE skin_uploads SET decided_at = now() - interval '29 days'
    WHERE owner_id = 'skin-rules-b' AND status = 'rejected' AND decided_at < now() - interval '31 days';
  got := check_skin_try(h_b, 'ag-skin-rules-q', png, sha256(png));
  IF got <> 'skin_upload_locked' THEN RAISE EXCEPTION 'skin rules: three rejects within 30 days must lock owner b, got %', got; END IF;

  -- the operator clear releases the three old rejects; after it, two new rejects do not lock owner b (the cleared rows
  -- count for nothing), and a third new reject does. Without the clause on the inner count the two new rejects lock.
  UPDATE skin_uploads SET lock_cleared_at = now() WHERE owner_id = 'skin-rules-b' AND status = 'rejected' AND lock_cleared_at IS NULL;
  got := check_skin_try(h_b, 'ag-skin-rules-q', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: owner b must be unlocked after the clear, got %', got; END IF;
  UPDATE skin_uploads SET status = 'rejected', reason_code = 'other', decided_at = now() - interval '2 hours', decided_by = 'op'
    WHERE player_id = 'ag-skin-rules-q' AND status = 'pending';
  UPDATE skin_uploads SET status = 'rejected', reason_code = 'other', decided_at = now() - interval '2 hours', decided_by = 'op'
    WHERE player_id = 'ag-skin-rules-s' AND status = 'pending';
  got := check_skin_try(h_b, 'ag-skin-rules-q', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: two new rejects after a clear must not lock owner b, got %', got; END IF;
  UPDATE skin_uploads SET status = 'rejected', reason_code = 'other', decided_at = now() - interval '2 hours', decided_by = 'op'
    WHERE player_id = 'ag-skin-rules-q' AND status = 'pending';
  got := check_skin_try(h_b, 'ag-skin-rules-s', png, sha256(png));
  IF got <> 'skin_upload_locked' THEN RAISE EXCEPTION 'skin rules: a third reject after a clear must lock owner b again, got %', got; END IF;

  -- admin owner c (0170): exempt from the wait, the lock and the daily cap, and from nothing else
  UPDATE mcp_owners SET is_admin = true WHERE owner_id = 'skin-rules-c';
  got := check_skin_try(h_c, 'ag-skin-rules-k1', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: admin upload 1 refused: %', got; END IF;
  got := check_skin_try(h_c, 'ag-skin-rules-k2', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: admin upload 2 refused: %', got; END IF;
  got := check_skin_try(h_c, 'ag-skin-rules-k3', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: admin upload 3 refused: %', got; END IF;
  got := check_skin_try(h_c, 'ag-skin-rules-k4', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: admin fourth upload of the day refused: %', got; END IF;
  UPDATE skin_uploads SET status = 'rejected', reason_code = 'other', decided_at = now() - interval '1 minute', decided_by = 'op'
    WHERE player_id = 'ag-skin-rules-k1' AND status = 'pending';
  UPDATE skin_uploads SET status = 'rejected', reason_code = 'other', decided_at = now() - interval '2 days', decided_by = 'op'
    WHERE player_id IN ('ag-skin-rules-k2', 'ag-skin-rules-k3', 'ag-skin-rules-k4') AND status = 'pending';
  got := check_skin_try(h_c, 'ag-skin-rules-k1', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: admin re-upload at 1 minute must be accepted (wait and lock exempt): %', got; END IF;
  got := check_skin_try(h_c, 'ag-skin-rules-k1', png, sha256(png));
  IF got <> 'skin_upload_pending' THEN RAISE EXCEPTION 'skin rules: admin second pending upload not refused: %', got; END IF;
  got := check_skin_try(h_a, 'ag-skin-rules-k1', png, sha256(png));
  IF got <> 'register_skin_submit: not your agent' THEN RAISE EXCEPTION 'skin rules: admin exemption leaked to another owner: %', got; END IF;
  SELECT count(*) INTO n FROM skin_uploads WHERE player_id = 'ag-skin-rules-k1' AND status = 'pending';
  IF n <> 1 THEN RAISE EXCEPTION 'skin rules: admin upload must be stored pending once, found %', n; END IF;

  -- the audit actor is the hashed owner id (as the other owner actions); the raw owner id never appears, detail is ''
  SELECT count(*) INTO n FROM register_audit
    WHERE action = 'skin.upload' AND actor = left(encode(sha256(convert_to('skin-rules-c', 'UTF8')), 'hex'), 16) AND detail = '';
  IF n < 1 THEN RAISE EXCEPTION 'skin rules: no skin.upload audit row with the hashed actor of owner c'; END IF;
  SELECT count(*) INTO n FROM register_audit WHERE action = 'skin.upload' AND actor LIKE 'skin-rules-%';
  IF n <> 0 THEN RAISE EXCEPTION 'skin rules: % skin.upload audit row(s) carry a raw owner id', n; END IF;

  -- the status view: the newest row of the agent, its state and no bytes
  SELECT count(*) INTO n FROM register_skin_status(h_c, 'ag-skin-rules-k1') WHERE upload_status = 'pending';
  IF n <> 1 THEN RAISE EXCEPTION 'skin rules: status of k1 must be the pending row, found % pending', n; END IF;
  -- the status refusals: owner b reading owner a's agent, an identity that is no owner, and an agent with no upload (zero rows)
  got := check_skin_status_try(h_b, 'ag-skin-rules-p1');
  IF got <> 'register_skin_status: not your agent' THEN RAISE EXCEPTION 'skin rules: status of another owner agent not refused: %', got; END IF;
  got := check_skin_status_try(decode(repeat('00', 32), 'hex'), 'ag-skin-rules-p1');
  IF got <> 'register_skin_status: not an owner' THEN RAISE EXCEPTION 'skin rules: status by a non-owner not refused: %', got; END IF;
  SELECT count(*) INTO n FROM register_skin_status(h_e, 'ag-skin-rules-e1');
  IF n <> 0 THEN RAISE EXCEPTION 'skin rules: agent with no upload must return zero status rows, found %', n; END IF;

  -- the admin daily exemption: approve the pending row of k1 and upload again, twice, so k1 holds 4 rows created today.
  -- A non-admin agent is refused at the third row of the day (case p1 above); the admin fourth upload must be accepted.
  UPDATE skin_uploads SET status = 'approved', decided_at = now(), decided_by = 'op'
    WHERE player_id = 'ag-skin-rules-k1' AND status = 'pending';
  got := check_skin_try(h_c, 'ag-skin-rules-k1', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: admin third upload of one agent today refused: %', got; END IF;
  UPDATE skin_uploads SET status = 'approved', decided_at = now(), decided_by = 'op'
    WHERE player_id = 'ag-skin-rules-k1' AND status = 'pending';
  got := check_skin_try(h_c, 'ag-skin-rules-k1', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: admin fourth upload of one agent today refused (daily cap exempt): %', got; END IF;
  SELECT count(*) INTO n FROM skin_uploads WHERE player_id = 'ag-skin-rules-k1' AND created_at > now() - interval '1 day';
  IF n <> 4 THEN RAISE EXCEPTION 'skin rules: admin agent k1 must hold 4 rows in the last 24 hours, found %', n; END IF;

  -- the daily window is 24 hours on created_at and strict: three uploads of agent p5 created exactly 24 hours ago are
  -- outside it, so the next upload is accepted; the same three at 23:59:59 ago are inside it, so the next is refused.
  -- Owner a is not locked (its rejects are cleared above) and p5 has no reject, so only the daily rule is in play.
  INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, harness, declared_model, model_config, tier) VALUES
    ('skin_rules_p5', 'rulesp5', 1, 'skin_rules_p5', 'test', 'sovereign', 'claude-code', 'self-reported', 'declared:unverified', 'sovereign');
  INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status) VALUES
    ('ag-skin-rules-p5','skin-rules-a', 'skin_rules_p5', 'rulesp5', 'claude-code', 'active');
  INSERT INTO skin_uploads (owner_id, player_id, png, sha256, status, reason_code, created_at, decided_at, decided_by) VALUES
    ('skin-rules-a', 'ag-skin-rules-p5', png, sha256(png), 'approved', NULL, now() - interval '24 hours', now() - interval '24 hours', 'op'),
    ('skin-rules-a', 'ag-skin-rules-p5', png, sha256(png), 'approved', NULL, now() - interval '24 hours', now() - interval '24 hours', 'op'),
    ('skin-rules-a', 'ag-skin-rules-p5', png, sha256(png), 'approved', NULL, now() - interval '24 hours', now() - interval '24 hours', 'op');
  got := check_skin_try(h_a, 'ag-skin-rules-p5', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: uploads 24 hours old are outside the daily window, must accept, got %', got; END IF;
  UPDATE skin_uploads SET status = 'approved', decided_at = now(), decided_by = 'op'
    WHERE player_id = 'ag-skin-rules-p5' AND status = 'pending';
  UPDATE skin_uploads SET created_at = now() - interval '23 hours 59 minutes 59 seconds'
    WHERE player_id = 'ag-skin-rules-p5' AND created_at = now() - interval '24 hours';
  got := check_skin_try(h_a, 'ag-skin-rules-p5', png, sha256(png));
  IF got <> 'skin_upload_daily' THEN RAISE EXCEPTION 'skin rules: uploads 23:59:59 old are inside the daily window, must refuse, got %', got; END IF;
END
$skin_rules$;

DROP FUNCTION check_skin_try(BYTEA, TEXT, BYTEA, BYTEA);
DROP FUNCTION check_skin_status_try(BYTEA, TEXT);
