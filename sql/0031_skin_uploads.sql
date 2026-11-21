-- Migration 0031 (C7-13a, decision 0172): owner skin uploads, held for operator approval.
-- A skin is stored here as `pending` and is never applied on upload. Nothing is sent to MineSkin or any external
-- service from the register side. Only the operator side (C7-13b) moves a row out of `pending`, so the register
-- role has no UPDATE on this table. The PNG is stored as bytes in this table only: never in the repo, never on a
-- public path, never in a log. At most one `pending` row per player is enforced by the partial unique index.
-- The sha256 is the hash of the PNG bytes. The size cap is 32 KiB (32768 bytes), matching the validator.
-- Rate rules (3 a day per agent, 1 hour after a reject, a lock after 3 rejects in 30 days until the operator clears
-- it) are enforced by register_skin_submit in 0067, not here; this table only holds the state those rules read.

CREATE TABLE IF NOT EXISTS skin_uploads (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  png BYTEA NOT NULL CHECK (octet_length(png) BETWEEN 1 AND 32768),
  sha256 BYTEA NOT NULL CHECK (octet_length(sha256) = 32),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  reason_code TEXT CHECK (reason_code IN ('inappropriate', 'impersonation', 'not_a_skin', 'invalid_format', 'other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by TEXT,
  -- set by the operator (table owner role geldar, one statement, worknote C7-13a) to release the 3-rejects lock
  lock_cleared_at TIMESTAMPTZ,
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  CHECK ((status = 'rejected') = (reason_code IS NOT NULL)),
  CHECK (lock_cleared_at IS NULL OR status = 'rejected')
);

-- One pending upload per agent (0172 point 2).
CREATE UNIQUE INDEX IF NOT EXISTS skin_uploads_one_pending ON skin_uploads (player_id) WHERE status = 'pending';
-- The 30-day reject count reads this index; the daily count is per agent (player_id) and reads none.
CREATE INDEX IF NOT EXISTS skin_uploads_owner_created ON skin_uploads (owner_id, created_at);

REVOKE ALL ON skin_uploads FROM PUBLIC;
GRANT SELECT, INSERT ON skin_uploads TO geldar_register;
GRANT USAGE, SELECT ON SEQUENCE skin_uploads_id_seq TO geldar_register;

INSERT INTO schema_migrations (version) VALUES ('0031') ON CONFLICT DO NOTHING;
