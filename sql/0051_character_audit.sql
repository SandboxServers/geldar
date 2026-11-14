-- Migration 0051 (AN-04b): the roll and decision projections, the adoption log, the export and retention
-- comments, and sheet_erase_life (one life's rows, the only erase path for these tables).
-- Decisions 0171 (erasure and world history), 0186 (D-CS-03 and D-CS-05) and 0280 (proficiency is the writable XP).
-- Additive only: no existing table, column or row changes meaning. Every statement may run again.
-- Every row here has its events row (source_event_id REFERENCES events), so an audit row exists only with its event.
-- rolls and decisions are agent-internal audit: UPDATE and DELETE raise (journal_append_only, 0007).
-- Nothing is granted to PUBLIC, geldar_mcp, geldar_glass, geldar_register or geldar_supervisor.

CREATE TABLE IF NOT EXISTS character_sheet_adoptions (
  adoption_id BIGSERIAL PRIMARY KEY,
  source_event_id TEXT NOT NULL UNIQUE REFERENCES events (source_event_id),
  life_id TEXT NOT NULL REFERENCES agents (agent_id),
  sheet_hash TEXT NOT NULL CHECK (sheet_hash ~ '^[0-9a-f]{64}$'),
  sheet JSONB NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('config', 'roster', 'birth')),
  result TEXT NOT NULL CHECK (result IN ('adopted', 'same', 'conflict')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rolls (
  source_event_id TEXT PRIMARY KEY REFERENCES events (source_event_id),
  life_id TEXT NOT NULL REFERENCES agents (agent_id),
  world_tick BIGINT NOT NULL,
  decision_id TEXT NOT NULL,
  draw_index INT NOT NULL CHECK (draw_index >= 0),
  engine_version INT NOT NULL,
  producer TEXT NOT NULL CHECK (producer IN ('body', 'kit')),
  fx TEXT NOT NULL,
  score SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
  proficiency SMALLINT NOT NULL DEFAULT 0 CHECK (proficiency BETWEEN 0 AND 3),
  dc SMALLINT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('dis', 'flat', 'adv')),
  dice SMALLINT[] NOT NULL CHECK (cardinality(dice) BETWEEN 1 AND 2),
  kept SMALLINT NOT NULL,
  bonus SMALLINT NOT NULL,
  total SMALLINT NOT NULL,
  success BOOLEAN NOT NULL,
  inputs JSONB,
  UNIQUE (life_id, decision_id, draw_index)
);

CREATE TABLE IF NOT EXISTS decisions (
  source_event_id TEXT PRIMARY KEY REFERENCES events (source_event_id),
  life_id TEXT NOT NULL REFERENCES agents (agent_id),
  world_tick BIGINT NOT NULL,
  decision_id TEXT NOT NULL,
  engine_version INT NOT NULL,
  producer TEXT NOT NULL,
  fx TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('d20', 'uniform', 'deterministic', 'audit_gap')),
  policy TEXT,
  inputs JSONB,
  result JSONB,
  roll_event_ids TEXT[],
  thought_id TEXT,
  action_id TEXT,
  intent_id TEXT,
  dropped INT,
  since_tick BIGINT,
  UNIQUE (life_id, decision_id)
);

CREATE INDEX IF NOT EXISTS rolls_life_fx ON rolls (life_id, fx, world_tick);
CREATE INDEX IF NOT EXISTS decisions_life_fx ON decisions (life_id, fx, world_tick);

DROP TRIGGER IF EXISTS rolls_append_only ON rolls;
CREATE TRIGGER rolls_append_only
BEFORE UPDATE OR DELETE ON rolls
FOR EACH ROW EXECUTE FUNCTION journal_append_only();

DROP TRIGGER IF EXISTS decisions_append_only ON decisions;
CREATE TRIGGER decisions_append_only
BEFORE UPDATE OR DELETE ON decisions
FOR EACH ROW EXECUTE FUNCTION journal_append_only();

REVOKE ALL ON character_sheet_adoptions, rolls, decisions
  FROM PUBLIC, geldar_mcp, geldar_glass, geldar_register, geldar_supervisor;

-- Export and retention map (AN-04a tables carry their comments in 0050; proficiency_outbox is completed here).
COMMENT ON TABLE character_sheet_adoptions IS 'export: included in the own-rows export of the owner (format to confirm with C7-09); retention: world history keyed by life_id with the owner link removed; sheet_erase_life removes the rows of one life';
COMMENT ON TABLE rolls IS 'export: included in the own-rows export of the owner (format to confirm with C7-09); retention: agent-internal audit like thoughts, removed with a life that is still alive when its owner deletes the account (owner to confirm); sheet_erase_life removes the rows of one life';
COMMENT ON TABLE decisions IS 'export: included in the own-rows export of the owner (format to confirm with C7-09); retention: agent-internal audit like thoughts, removed with a life that is still alive when its owner deletes the account (owner to confirm); sheet_erase_life removes the rows of one life';
COMMENT ON TABLE proficiency_outbox IS 'export: none, internal publication queue and not owner data; retention: removed by sheet_erase_life with its life and by no other path';

-- Erases the rows of one life from every table keyed by life_id in 0050 and 0051. Nothing else: events, agents
-- and the other lives are untouched. Each append-only trigger is disabled only around the DELETE on its own table,
-- in this transaction: a failed call rolls the DDL back too, so the triggers stay enabled. Returns nothing and logs
-- nothing, so no personal data reaches the server log. Repeating the call for an erased life deletes nothing.
CREATE OR REPLACE FUNCTION sheet_erase_life(p_life_id TEXT) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '2s'
AS $fn$
BEGIN
  IF p_life_id IS NULL THEN
    RAISE EXCEPTION 'sheet_erase_life needs a life id' USING ERRCODE = 'null_value_not_allowed';
  END IF;
  ALTER TABLE rolls DISABLE TRIGGER rolls_append_only;
  DELETE FROM rolls WHERE life_id = p_life_id;
  ALTER TABLE rolls ENABLE TRIGGER rolls_append_only;
  ALTER TABLE decisions DISABLE TRIGGER decisions_append_only;
  DELETE FROM decisions WHERE life_id = p_life_id;
  ALTER TABLE decisions ENABLE TRIGGER decisions_append_only;
  ALTER TABLE xp_evidence DISABLE TRIGGER xp_evidence_append_only;
  DELETE FROM xp_evidence WHERE life_id = p_life_id;
  ALTER TABLE xp_evidence ENABLE TRIGGER xp_evidence_append_only;
  DELETE FROM character_sheet_adoptions WHERE life_id = p_life_id;
  DELETE FROM proficiency WHERE life_id = p_life_id;
  DELETE FROM proficiency_outbox WHERE life_id = p_life_id;
END
$fn$;

REVOKE ALL ON FUNCTION sheet_erase_life(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sheet_erase_life(TEXT) TO geldar_register;

INSERT INTO schema_migrations (version) VALUES ('0051') ON CONFLICT DO NOTHING;
