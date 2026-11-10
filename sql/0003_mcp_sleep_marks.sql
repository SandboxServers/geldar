-- Migration 0003: review fixes for the sovereign MCP tables (decision 0026, wave M review R2).
-- 0002 is applied and is not edited; this file changes its grants and adds the tables and
-- triggers the review needed. Like every migration, it inserts its own schema_migrations row.

INSERT INTO schema_migrations (version) VALUES ('0003') ON CONFLICT DO NOTHING;

-- not in spec Appendix D: the sovereign sleep mark. The MCP may not write agents, so the mark
-- lives here, keyed by the same life id as mcp_players. With no row the mark is born_day.
CREATE TABLE mcp_sleep_marks (
  life_id TEXT PRIMARY KEY REFERENCES agents,
  last_sleep_day INT NOT NULL,
  sleep_cursor BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The journal read is `WHERE life_id = $1 ORDER BY id DESC LIMIT n` (pg-journal.ts).
CREATE INDEX mcp_journal_life_id_idx ON mcp_journal (life_id, id);

-- A player that leaves 'active' (paused or retired) ends its sessions. It sends the same payload
-- as mcp_notify_token_revoked for each of the player's tokens, so the listener in
-- threshold/mcp/src/store/pg-tokens.ts needs no change.
CREATE FUNCTION mcp_notify_player_ended() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_notify('mcp_token_revoked',
    json_build_object('token_id', t.token_id, 'player_id', t.player_id)::text)
  FROM mcp_tokens t WHERE t.player_id = NEW.player_id;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER mcp_players_ended
AFTER UPDATE OF status ON mcp_players
FOR EACH ROW
WHEN (OLD.status = 'active' AND NEW.status <> 'active')
EXECUTE FUNCTION mcp_notify_player_ended();

-- Least privilege: 0002 granted every agents column, including last_sleep_day. The MCP reads
-- only these six (the stores' SELECTs: pg-agents.ts, pg-players.ts).
REVOKE SELECT ON agents FROM geldar_mcp;
GRANT SELECT (agent_id, name, game_account, personality_seed, born_day, died_at)
  ON agents TO geldar_mcp;
GRANT SELECT, INSERT, UPDATE ON mcp_sleep_marks TO geldar_mcp;
-- Retention: the journal store deletes a life's rows past the newest 1000 (pg-journal.ts).
GRANT DELETE ON mcp_journal TO geldar_mcp;
