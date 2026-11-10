-- Migration 0002: the sovereign MCP tables (spec 5.15.3, 5.7, decision 0026).
-- Every table in this file is not in spec Appendix D: the MCP server owns them.
-- schema_migrations is created here too, so a database that already has 0001 can
-- be baselined by the runner (tools/migrate) and a fresh one gets both rows.

-- not in spec Appendix D: the runner's ledger of applied migrations.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations (version) VALUES ('0001'), ('0002') ON CONFLICT DO NOTHING;

-- not in spec Appendix D: an owner is a person who runs sovereign players.
CREATE TABLE mcp_owners (
  owner_id TEXT PRIMARY KEY,
  display TEXT NOT NULL,
  player_cap INT NOT NULL DEFAULT 3 CHECK (player_cap BETWEEN 0 AND 50)
);

-- not in spec Appendix D: a sovereign player, joined to its life. The launcher id
-- (such as ag-jason-01) is the URL path id; life_id is the game account (ag_jason_01).
CREATE TABLE mcp_players (
  player_id TEXT PRIMARY KEY CHECK (player_id ~ '^ag-[a-z0-9]+(-[a-z0-9]+)*$'),
  owner_id TEXT NOT NULL REFERENCES mcp_owners,
  life_id TEXT NOT NULL UNIQUE REFERENCES agents,
  display_name TEXT NOT NULL,
  harness TEXT NOT NULL CHECK (harness ~ '^[a-z][a-z0-9-]{0,31}$'),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'retired'))
);

-- not in spec Appendix D: hashed Bearer tokens. token_hash = HMAC-SHA256(pepper, token);
-- the token itself is never stored. A trigger sends NOTIFY mcp_token_revoked on revocation.
CREATE TABLE mcp_tokens (
  token_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES mcp_players,
  token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);
CREATE INDEX mcp_tokens_active_idx ON mcp_tokens (player_id) WHERE revoked_at IS NULL;

-- not in spec Appendix D: the credit balance of a life, accrued in real time (spec 5.7).
CREATE TABLE mcp_budget (
  life_id TEXT PRIMARY KEY REFERENCES agents,
  credits INT NOT NULL CHECK (credits >= 0),
  accrued_at TIMESTAMPTZ NOT NULL
);

-- not in spec Appendix D: the journal mirror; the Body keeps its own copy in the world.
CREATE TABLE mcp_journal (
  id BIGSERIAL PRIMARY KEY,
  life_id TEXT NOT NULL REFERENCES agents,
  at TIMESTAMPTZ NOT NULL,
  text TEXT NOT NULL CHECK (char_length(text) <= 4000)
);

CREATE FUNCTION mcp_notify_token_revoked() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_notify('mcp_token_revoked',
    json_build_object('token_id', NEW.token_id, 'player_id', NEW.player_id)::text);
  RETURN NEW;
END
$fn$;

CREATE TRIGGER mcp_tokens_revoked
AFTER UPDATE OF revoked_at ON mcp_tokens
FOR EACH ROW
WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
EXECUTE FUNCTION mcp_notify_token_revoked();

-- The role the MCP server connects as. NOLOGIN here: the password is set by
-- `migrate --set-role-password geldar_mcp`, and the login is granted by that step.
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geldar_mcp') THEN
    CREATE ROLE geldar_mcp NOLOGIN;
  END IF;
END
$role$;

GRANT USAGE ON SCHEMA public TO geldar_mcp;
GRANT SELECT ON agents, mcp_owners, mcp_players, mcp_tokens TO geldar_mcp;
GRANT UPDATE (last_used_at) ON mcp_tokens TO geldar_mcp;
GRANT SELECT, UPDATE ON mcp_budget TO geldar_mcp;
GRANT SELECT, INSERT ON mcp_journal TO geldar_mcp;
GRANT USAGE ON SEQUENCE mcp_journal_id_seq TO geldar_mcp;
