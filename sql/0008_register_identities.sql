-- Migration 0008: self-registration (decision 0135). The identities table and the role the register
-- service connects as. 0002 to 0007 are applied and are not edited. Like every migration, it inserts
-- its own schema_migrations row.

-- not in spec Appendix D: one row per person who registered. identity_hash =
-- HMAC-SHA256(pepper, provider || ':' || provider id). There is no column for an email, a raw
-- provider id or a provider token: the handle is stored only as mcp_owners.display.
CREATE TABLE mcp_identities (
  identity_hash BYTEA PRIMARY KEY CHECK (octet_length(identity_hash) = 32),
  provider TEXT NOT NULL CHECK (provider IN ('github', 'discord')),
  owner_id TEXT NOT NULL UNIQUE REFERENCES mcp_owners,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  banned_at TIMESTAMPTZ
);

-- NOLOGIN here: the deploy grants the login and sets the password, the way it does for geldar_mcp
-- (`migrate --set-role-password`). The role creates owners, players and tokens and nothing else:
-- no thoughts, events, receipts or journal, and no token_hash read.
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geldar_register') THEN
    CREATE ROLE geldar_register NOLOGIN;
  END IF;
EXCEPTION
  -- Two runs in one cluster can both pass the check above; the loser sees one of these two errors. The role exists then.
  WHEN duplicate_object OR unique_violation THEN NULL;
END
$role$;

GRANT USAGE ON SCHEMA public TO geldar_register;
GRANT SELECT, INSERT ON mcp_identities, mcp_owners, mcp_players TO geldar_register;

-- The owner cap trigger (0006) runs as the inserting role and does SELECT ... FOR UPDATE on the
-- owner row, which Postgres allows only with UPDATE on some column of mcp_owners. The grant is on
-- display, the harmless one: player_cap stays unwritable, so the role cannot raise its own cap.
GRANT UPDATE (display) ON mcp_owners TO geldar_register;

-- Retire a player (decision 0135 item 4): status only; owner_id, life_id and player_id stay fixed.
GRANT UPDATE (status) ON mcp_players TO geldar_register;

-- agents: the columns tools/mcp-tokens addPlayer inserts (never a grant on the other columns), and a
-- read of the six identifying ones. personality_seed is not readable.
GRANT INSERT (agent_id, name, life_seq, game_account, shard, mode, owner, harness, declared_model,
              model_config, tier, personality_seed)
  ON agents TO geldar_register;
GRANT SELECT (agent_id, name, life_seq, shard, mode, owner) ON agents TO geldar_register;

-- mcp_tokens: insert, and revoke by revoked_at only. The WHERE of a revoke needs to read the row, so
-- the read covers every column except token_hash.
GRANT INSERT ON mcp_tokens TO geldar_register;
GRANT UPDATE (revoked_at) ON mcp_tokens TO geldar_register;
GRANT SELECT (token_id, player_id, label, created_at, expires_at, revoked_at, last_used_at)
  ON mcp_tokens TO geldar_register;

-- addPlayer also writes the first budget row in the same transaction (differs from the card, which
-- does not list mcp_budget; without it player creation cannot finish).
GRANT INSERT ON mcp_budget TO geldar_register;

INSERT INTO schema_migrations (version) VALUES ('0008') ON CONFLICT DO NOTHING;
