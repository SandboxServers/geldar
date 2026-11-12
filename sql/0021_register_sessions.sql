-- Migration 0021 (C7-01): register sessions survive a restart. The gr_session cookie carries a random id;
-- this table keys each session by the SHA-256 of that id, so the id itself is never stored.
-- Times are epoch milliseconds from the register process clock. The sliding expiry and the 12 hour cap
-- are computed by the register (threshold/register/src/session-store.ts), not by this table.
-- Only geldar_register (created in 0008) reads and writes the table; no other role gets a grant.

CREATE TABLE register_sessions (
  session_hash BYTEA PRIMARY KEY CHECK (octet_length(session_hash) = 32),
  owner_id TEXT NOT NULL,
  identity_hash BYTEA NOT NULL,
  signed_in_ms BIGINT NOT NULL,
  last_seen_ms BIGINT NOT NULL,
  expires_ms BIGINT NOT NULL,
  CHECK (last_seen_ms >= signed_in_ms AND expires_ms > signed_in_ms)
);

CREATE INDEX register_sessions_expires ON register_sessions (expires_ms);

REVOKE ALL ON register_sessions FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON register_sessions TO geldar_register;

INSERT INTO schema_migrations (version) VALUES ('0021') ON CONFLICT DO NOTHING;
