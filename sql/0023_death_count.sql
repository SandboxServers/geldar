-- Migration 0023: the durable death count of each life (phase 1, PX-0b1). The MCP may not write
-- agents, so the count lives here, keyed by the same life id as mcp_sleep_marks (0003). A life with
-- no row has no death yet: life 1, and its days alive are counted from born_day.
-- mcp_death_events holds one row per death event id, so a redelivered or retried death event counts
-- once: the write in threshold/mcp/src/store/pg-deaths.ts inserts the event id and bumps the count in
-- one statement. Idempotent: IF NOT EXISTS and re-run-safe grants.

CREATE TABLE IF NOT EXISTS mcp_life_deaths (
  life_id TEXT PRIMARY KEY REFERENCES agents,
  death_count INT NOT NULL DEFAULT 0 CHECK (death_count >= 0),
  last_death_day INT,
  last_death_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mcp_death_events (
  event_id TEXT PRIMARY KEY,
  life_id TEXT NOT NULL REFERENCES agents,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON mcp_life_deaths TO geldar_mcp;
GRANT SELECT, INSERT ON mcp_death_events TO geldar_mcp;

INSERT INTO schema_migrations (version) VALUES ('0023') ON CONFLICT DO NOTHING;
