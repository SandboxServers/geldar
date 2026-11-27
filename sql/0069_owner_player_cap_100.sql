-- Migration 0069 (decision 0447): raises the per-owner sovereign player cap from 50 to 100.
-- 0002 sets mcp_owners.player_cap with an unnamed column CHECK (0 to 50). That migration is
-- applied and is not edited. Postgres names the constraint mcp_owners_player_cap_check, so this
-- drops it by that name and adds it back at 0 to 100. The trigger (0006, 0011) reads the column
-- and needs no change. Dropping IF EXISTS and adding again keeps a re-run safe.

ALTER TABLE mcp_owners DROP CONSTRAINT IF EXISTS mcp_owners_player_cap_check;
ALTER TABLE mcp_owners ADD CONSTRAINT mcp_owners_player_cap_check CHECK (player_cap BETWEEN 0 AND 100);

INSERT INTO schema_migrations (version) VALUES ('0069') ON CONFLICT DO NOTHING;
