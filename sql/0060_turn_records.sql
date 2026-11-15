-- Migration 0060 (GX-05a, decision 0185): the turn_records table for the per-turn record of a kit Mind. One row per
-- model call, with the prompt and the raw output the harness exposes, so it is operator-only. It is NOT thoughts (0005
-- gives geldar_glass a table-wide SELECT on thoughts) and it has no owner link: erasure (0171, GX-05b and GX-05c) removes
-- rows by life_id. Nothing writes this table yet: the sink writer (GX-05b) stays off unless GELDAR_TURN_RECORD=1.
--
-- Grants. The sink writes the table and the operator reads it. No separate sink role exists in this repository: eventsink
-- connects as POSTGRES_USER, which defaults to geldar (eventsink/src/config.ts), and 0034 names geldar the operator role
-- (tools/mcp-tokens and tools/admin connect as PGUSER). So both grants go to geldar, guarded like 0034 so a database
-- without that role still migrates. No other role is granted anything, PUBLIC included.
--
-- Additive only: IF NOT EXISTS everywhere, so a reapply of this file is a no-op. No trigger: the table is not
-- append-only, because erasure deletes rows. Like every migration, it inserts its own schema_migrations row.

CREATE TABLE IF NOT EXISTS turn_records (
  turn_id           TEXT PRIMARY KEY CHECK (turn_id ~ '^tn_[0-9A-HJKMNP-TV-Z]{26}$'),
  life_id           TEXT NOT NULL CHECK (life_id ~ '^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$'),
  harness           TEXT NOT NULL CHECK (harness ~ '^[a-z][a-z0-9-]{0,31}$'),
  model             TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 128),
  template_version  TEXT NOT NULL CHECK (template_version ~ '^[0-9a-f]{64}$'),
  wake_reason       TEXT NOT NULL CHECK (length(wake_reason) BETWEEN 1 AND 64),
  world_day         INTEGER NOT NULL CHECK (world_day >= 0),
  world_tick        INTEGER NOT NULL CHECK (world_tick >= 0),
  model_input       TEXT NOT NULL CHECK (length(model_input) <= 32768),
  raw_output        TEXT NOT NULL CHECK (length(raw_output) <= 32768),
  tokens_in         INTEGER NOT NULL CHECK (tokens_in >= 0),
  tokens_out        INTEGER NOT NULL CHECK (tokens_out >= 0),
  usage_source      TEXT NOT NULL CHECK (usage_source IN ('provider', 'estimated')),
  latency_ms        INTEGER NOT NULL CHECK (latency_ms >= 0),
  context_tokens    INTEGER NOT NULL CHECK (context_tokens >= 0),
  context_window    INTEGER NOT NULL CHECK (context_window > 0),
  credits           INTEGER CHECK (credits IS NULL OR credits >= 0),
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Erasure (GX-05c) deletes by life_id, so the column is indexed.
CREATE INDEX IF NOT EXISTS turn_records_life_id_idx ON turn_records (life_id);

REVOKE ALL ON turn_records FROM PUBLIC;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geldar') THEN
    GRANT INSERT, SELECT ON turn_records TO geldar;
  END IF;
END
$grant$;

INSERT INTO schema_migrations (version) VALUES ('0060') ON CONFLICT DO NOTHING;
