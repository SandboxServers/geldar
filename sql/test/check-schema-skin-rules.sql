-- Migration 0067 (C7-13a-sql, decision 0172): register_skin_submit, register_skin_status and the skin part of
-- register_account_delete. Run after check-schema.sql and the migrations through 0067, once, on a fresh database
-- (as ci.yml does): the fixtures are not removed, and the owners and hashes are fixed. Owners skin-rules-a (the one
-- deleted) and skin-rules-b (must keep every row). Identity hashes are 7c..01 and 7c..02, used nowhere else.
-- Every time-based rule is tested with now() fixed inside this one transaction, so 59:59 and 60:00 are exact.
-- Not covered here: the admin exemption (its owner flag is set outside this file) and the status of another owner's
-- agent (the routes packet covers both).

CREATE FUNCTION check_skin_try(h BYTEA, p TEXT, png BYTEA, sh BYTEA) RETURNS TEXT
LANGUAGE plpgsql AS $try$
BEGIN
  PERFORM register_skin_submit(h, p, png, sh);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END
$try$;

DO $skin_rules$
DECLARE
  png BYTEA := decode('89504e470d0a1a0a', 'hex');
  h_a BYTEA := decode(repeat('7c', 31) || '01', 'hex');
  h_b BYTEA := decode(repeat('7c', 31) || '02', 'hex');
  got TEXT;
  n INT;
BEGIN
  INSERT INTO mcp_owners (owner_id, display, player_cap) VALUES
    ('skin-rules-a', 'a', 5), ('skin-rules-b', 'b', 5);
  INSERT INTO mcp_identities (identity_hash, provider, owner_id, banned_at) VALUES
    (h_a, 'github', 'skin-rules-a', NULL), (h_b, 'github', 'skin-rules-b', NULL);
  INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status) VALUES
    ('skin-rules-p1', 'skin-rules-a', 'skin_rules_p1', 'rulesp1', 'claude-code', 'active'),
    ('skin-rules-p2', 'skin-rules-a', 'skin_rules_p2', 'rulesp2', 'claude-code', 'active'),
    ('skin-rules-p3', 'skin-rules-a', 'skin_rules_p3', 'rulesp3', 'claude-code', 'active'),
    ('skin-rules-p4', 'skin-rules-a', 'skin_rules_p4', 'rulesp4', 'claude-code', 'active'),
    ('skin-rules-q', 'skin-rules-b', 'skin_rules_q', 'rulesq', 'claude-code', 'active'),
    ('skin-rules-s', 'skin-rules-b', 'skin_rules_s', 'ruless', 'claude-code', 'active');

  -- the daily count: attempts 1 to 3 of the owner are accepted, attempt 4 is refused
  got := check_skin_try(h_a, 'skin-rules-p1', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: attempt 1 refused: %', got; END IF;
  got := check_skin_try(h_a, 'skin-rules-p2', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: attempt 2 refused: %', got; END IF;
  got := check_skin_try(h_a, 'skin-rules-p3', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: attempt 3 refused: %', got; END IF;
  got := check_skin_try(h_a, 'skin-rules-p4', png, sha256(png));
  IF got <> 'skin_upload_daily' THEN RAISE EXCEPTION 'skin rules: attempt 4 must hit the daily cap, got %', got; END IF;

  -- error paths: another owner's agent, one pending per agent, a sha256 that does not match the bytes
  got := check_skin_try(h_b, 'skin-rules-p1', png, sha256(png));
  IF got <> 'register_skin_submit: not your agent' THEN RAISE EXCEPTION 'skin rules: cross-owner submit not refused: %', got; END IF;
  got := check_skin_try(h_a, 'skin-rules-p1', png, sha256(png));
  IF got <> 'skin_upload_pending' THEN RAISE EXCEPTION 'skin rules: second pending upload not refused: %', got; END IF;
  got := check_skin_try(h_a, 'skin-rules-p4', png, decode(repeat('00', 32), 'hex'));
  IF got <> 'register_skin_submit: sha256 does not match the PNG' THEN RAISE EXCEPTION 'skin rules: bad sha256 not refused: %', got; END IF;

  -- the reject wait: the owner's rows are moved two days back so the daily count is clear; p2 is rejected 59:59 ago
  UPDATE skin_uploads SET created_at = now() - interval '2 days' WHERE owner_id = 'skin-rules-a';
  UPDATE skin_uploads SET status = 'rejected', reason_code = 'other', decided_at = now() - interval '59 minutes 59 seconds',
    decided_by = 'op' WHERE player_id = 'skin-rules-p2' AND status = 'pending';
  got := check_skin_try(h_a, 'skin-rules-p2', png, sha256(png));
  IF got <> 'skin_upload_wait' THEN RAISE EXCEPTION 'skin rules: reject wait at 59:59 must refuse, got %', got; END IF;
  UPDATE skin_uploads SET decided_at = now() - interval '60 minutes' WHERE player_id = 'skin-rules-p2' AND status = 'rejected';
  got := check_skin_try(h_a, 'skin-rules-p2', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: reject wait at 60:00 must allow, got %', got; END IF;

  -- the lock: three rejects of the owner in 30 days (p2, p1 and p3); a fourth agent is locked
  UPDATE skin_uploads SET status = 'rejected', reason_code = 'other', decided_at = now() - interval '3 days',
    decided_by = 'op' WHERE player_id IN ('skin-rules-p1', 'skin-rules-p3') AND status = 'pending';
  got := check_skin_try(h_a, 'skin-rules-p4', png, sha256(png));
  IF got <> 'skin_upload_locked' THEN RAISE EXCEPTION 'skin rules: three rejects in 30 days must lock, got %', got; END IF;

  -- the status for the owner: the newest row of the agent, with its state and no bytes
  SELECT count(*) INTO n FROM register_skin_status(h_a, 'skin-rules-p2') WHERE upload_status = 'pending';
  IF n <> 1 THEN RAISE EXCEPTION 'skin rules: status of p2 must be the pending row, found % pending', n; END IF;

  -- the 30-day window: three rejects 31 days old do not lock owner b; the same rejects at 29 days do
  INSERT INTO skin_uploads (owner_id, player_id, png, sha256, status, reason_code, created_at, decided_at, decided_by) VALUES
    ('skin-rules-b', 'skin-rules-q', png, sha256(png), 'rejected', 'other', now() - interval '31 days', now() - interval '31 days', 'op'),
    ('skin-rules-b', 'skin-rules-q', png, sha256(png), 'rejected', 'other', now() - interval '31 days', now() - interval '31 days', 'op'),
    ('skin-rules-b', 'skin-rules-q', png, sha256(png), 'rejected', 'other', now() - interval '31 days', now() - interval '31 days', 'op');
  got := check_skin_try(h_b, 'skin-rules-s', png, sha256(png));
  IF got <> 'ok' THEN RAISE EXCEPTION 'skin rules: rejects 31 days old must not lock owner b, got %', got; END IF;
  UPDATE skin_uploads SET created_at = now() - interval '29 days', decided_at = now() - interval '29 days'
    WHERE owner_id = 'skin-rules-b' AND player_id = 'skin-rules-q';
  got := check_skin_try(h_b, 'skin-rules-q', png, sha256(png));
  IF got <> 'skin_upload_locked' THEN RAISE EXCEPTION 'skin rules: rejects 29 days old must lock owner b, got %', got; END IF;

  -- deletion: owner a leaves zero skin rows, none for its agents, and owner b keeps all of its rows (3 rejected, 1 pending)
  IF NOT register_account_delete(h_a) THEN
    RAISE EXCEPTION 'skin rules: account delete of owner a returned false';
  END IF;
  SELECT count(*) INTO n FROM skin_uploads WHERE owner_id = 'skin-rules-a' OR player_id LIKE 'skin-rules-p%';
  IF n <> 0 THEN RAISE EXCEPTION 'skin rules: % skin row(s) of deleted owner a survive', n; END IF;
  SELECT count(*) INTO n FROM skin_uploads WHERE owner_id = 'skin-rules-b';
  IF n <> 4 THEN RAISE EXCEPTION 'skin rules: owner b lost skin rows (found %, expected 4)', n; END IF;
END
$skin_rules$;

DROP FUNCTION check_skin_try(BYTEA, TEXT, BYTEA, BYTEA);
