-- Migration 0024: the roster of Minecraft names an owner may run sovereign agents as (C3-04s,
-- decision 0108). Before this the roster was the shard file's sovereign.players list. The table
-- keeps one row per name, so a name has one owner; max_agents is how many agents may run as that
-- name at once. The owner cap stays with mcp_owners and trigger 0006. Like every migration, it
-- inserts its own schema_migrations row. Names are stored lower-cased (the CHECK), so 'Ranger' is
-- refused and 'ranger' is the only row; the index on lower(player_name) keeps that unique too.
CREATE TABLE mcp_roster (
  player_name TEXT PRIMARY KEY CHECK (player_name = lower(player_name)),
  owner_id TEXT NOT NULL REFERENCES mcp_owners (owner_id),
  max_agents INT NOT NULL DEFAULT 1 CHECK (max_agents BETWEEN 1 AND 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX mcp_roster_name_lower ON mcp_roster (lower(player_name));

INSERT INTO schema_migrations (version) VALUES ('0024') ON CONFLICT DO NOTHING;
