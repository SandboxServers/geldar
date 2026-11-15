-- Migration 0051 (AN-04b): the roll and decision projections, the adoption log, the export and retention
-- comments, the guard sheet_append_only, and sheet_erase_life (one life's rows, the only erase path).
-- Decisions 0171 (erasure and world history), 0186 (D-CS-03 and D-CS-05) and 0280 (proficiency is the writable XP).
-- Every statement may run again. Additive, except that xp_evidence_append_only (0050) is recreated on
-- sheet_append_only: same name, same refusal of UPDATE and DELETE, and TRUNCATE is refused as well.
-- Every row here has its events row (source_event_id REFERENCES events), so an audit row exists only with its event.
-- rolls, decisions and xp_evidence refuse UPDATE and TRUNCATE always, and DELETE unless the transaction names the
-- row's life in the setting geldar.erase_life (set by sheet_erase_life and by no other code).
-- Erase contract: sheet_erase_life is called only for a life that was alive when its owner deleted the account.
-- Rows of dead lives stay as world history with no owner link (decision 0171).
-- Nothing is granted to PUBLIC, geldar_mcp, geldar_glass, geldar_register or geldar_supervisor, except EXECUTE
-- on sheet_erase_life for geldar_register.

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

-- The guard. It is not a privilege boundary (any session can set the name); it stops an accidental UPDATE,
-- TRUNCATE or DELETE of audit rows. A DELETE passes only when the setting names the deleted row's life.
CREATE OR REPLACE FUNCTION sheet_append_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('geldar.erase_life', true) = OLD.life_id THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'append-only: % on % is refused', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation',
          HINT = 'these tables record evidence; only sheet_erase_life removes the rows of one life';
END
$fn$;

DROP TRIGGER IF EXISTS rolls_append_only ON rolls;
CREATE TRIGGER rolls_append_only
BEFORE UPDATE OR DELETE ON rolls
FOR EACH ROW EXECUTE FUNCTION sheet_append_only();

DROP TRIGGER IF EXISTS rolls_append_only_truncate ON rolls;
CREATE TRIGGER rolls_append_only_truncate
BEFORE TRUNCATE ON rolls
FOR EACH STATEMENT EXECUTE FUNCTION sheet_append_only();

DROP TRIGGER IF EXISTS decisions_append_only ON decisions;
CREATE TRIGGER decisions_append_only
BEFORE UPDATE OR DELETE ON decisions
FOR EACH ROW EXECUTE FUNCTION sheet_append_only();

DROP TRIGGER IF EXISTS decisions_append_only_truncate ON decisions;
CREATE TRIGGER decisions_append_only_truncate
BEFORE TRUNCATE ON decisions
FOR EACH STATEMENT EXECUTE FUNCTION sheet_append_only();

DROP TRIGGER IF EXISTS xp_evidence_append_only ON xp_evidence;
CREATE TRIGGER xp_evidence_append_only
BEFORE UPDATE OR DELETE ON xp_evidence
FOR EACH ROW EXECUTE FUNCTION sheet_append_only();

DROP TRIGGER IF EXISTS xp_evidence_append_only_truncate ON xp_evidence;
CREATE TRIGGER xp_evidence_append_only_truncate
BEFORE TRUNCATE ON xp_evidence
FOR EACH STATEMENT EXECUTE FUNCTION sheet_append_only();

REVOKE ALL ON character_sheet_adoptions, rolls, decisions
  FROM PUBLIC, geldar_mcp, geldar_glass, geldar_register, geldar_supervisor;

-- Export and retention map for the six life-keyed tables (0050 wrote the first comments on proficiency,
-- xp_evidence and proficiency_outbox; the texts here replace them, and the contract above is the single reading).
COMMENT ON TABLE character_sheet_adoptions IS 'export: included in the own-rows export of the owner (format to confirm with C7-09); retention: removed by sheet_erase_life for a life that is still alive when its owner deletes the account (owner to confirm); rows of dead lives stay as world history with no owner link (0171); the events rows stay';
COMMENT ON TABLE rolls IS 'export: included in the own-rows export of the owner (format to confirm with C7-09); retention: agent-internal audit like thoughts, removed by sheet_erase_life for a life that is still alive when its owner deletes the account (owner to confirm); rows of dead lives stay as world history with no owner link (0171); the events rows stay';
COMMENT ON TABLE decisions IS 'export: included in the own-rows export of the owner (format to confirm with C7-09); retention: agent-internal audit like thoughts, removed by sheet_erase_life for a life that is still alive when its owner deletes the account (owner to confirm); rows of dead lives stay as world history with no owner link (0171); the events rows stay';
COMMENT ON TABLE xp_evidence IS 'export: included in the own-rows export of the owner (format to confirm with C7-09); retention: removed by sheet_erase_life for a life that is still alive when its owner deletes the account (owner to confirm); rows of dead lives stay as world history with no owner link (0171); the events rows stay';
COMMENT ON TABLE proficiency IS 'export: included in the own-rows export of the owner (format to confirm with C7-09); retention: removed by sheet_erase_life for a life that is still alive when its owner deletes the account (owner to confirm); rows of dead lives stay as world history with no owner link (0171)';
COMMENT ON TABLE proficiency_outbox IS 'export: none, internal publication queue and not owner data; retention: removed only by sheet_erase_life, for a life that is still alive when its owner deletes the account; rows of dead lives stay (0171)';

-- Erases the rows of one life from the six life-keyed tables: rolls, decisions, xp_evidence,
-- character_sheet_adoptions, proficiency and proficiency_outbox. Nothing else: events, agents and the other lives
-- are untouched. The guard setting is transaction-local and names the life only around the deletes.
-- A failed call aborts the transaction, which also drops the setting. Logs nothing.
CREATE OR REPLACE FUNCTION sheet_erase_life(p_life_id TEXT) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '2s'
AS $fn$
BEGIN
  IF p_life_id IS NULL THEN
    RAISE EXCEPTION 'sheet_erase_life needs a life id' USING ERRCODE = 'null_value_not_allowed';
  END IF;
  PERFORM set_config('geldar.erase_life', p_life_id, true);
  DELETE FROM public.rolls WHERE life_id = p_life_id;
  DELETE FROM public.decisions WHERE life_id = p_life_id;
  DELETE FROM public.xp_evidence WHERE life_id = p_life_id;
  DELETE FROM public.character_sheet_adoptions WHERE life_id = p_life_id;
  DELETE FROM public.proficiency WHERE life_id = p_life_id;
  DELETE FROM public.proficiency_outbox WHERE life_id = p_life_id;
  PERFORM set_config('geldar.erase_life', '', true);
END
$fn$;

COMMENT ON FUNCTION sheet_erase_life(TEXT) IS 'Erases the rows of one life from rolls, decisions, xp_evidence, character_sheet_adoptions, proficiency and proficiency_outbox. Called only for a life that was alive when its owner deleted the account; rows of already dead lives stay as world history with no owner link (decision 0171). The events rows that match the erased rows stay (0171 open question for events of retired lives). Logs nothing.';

REVOKE ALL ON FUNCTION sheet_erase_life(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sheet_erase_life(TEXT) TO geldar_register;

INSERT INTO schema_migrations (version) VALUES ('0051') ON CONFLICT DO NOTHING;
