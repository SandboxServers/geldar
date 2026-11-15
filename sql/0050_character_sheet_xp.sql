-- Migration 0050 (AN-04a): the adopted character sheet, the proficiency projection, unique XP evidence and
-- the proficiency publication outbox. Decision 0186 (D-CS-03): each life has one immutable adopted baseline.
-- Decision 0280: proficiency is the only writable copy of XP; the sheet carries no proficiency key.
-- Additive only: no existing table, column or row changes meaning. Every statement may run again.
--
-- agents.character_sheet is NULL until the first adoption. The first non-NULL write sets it; a later write
-- that changes the sheet, the hash or the adoption time raises (agents_sheet_immutable). The shape is checked
-- by character_sheet_valid: exact key sets, version 1, and every score a JSON number whose text is 1 to 5.
-- proficiency holds xp and level per domain; both never decrease (proficiency_monotonic).
-- xp_evidence is the exactly-once key of an XP award and is append-only (journal_append_only, 0007).
-- proficiency_outbox queues level changes for publication; the publisher sets published_at and no row is deleted here.
-- Sheet data is operator-readable only: nothing is granted to PUBLIC, geldar_mcp, geldar_glass, geldar_register
-- or geldar_supervisor. The thoughts table is not used: it is glass-readable (0005, 0020) and append-only.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS character_sheet JSONB,
  ADD COLUMN IF NOT EXISTS sheet_hash TEXT,
  ADD COLUMN IF NOT EXISTS sheet_adopted_at TIMESTAMPTZ;

-- One score group: exactly the keys in keys (sorted in the caller's array order), each a number 1 to 5.
CREATE OR REPLACE FUNCTION character_sheet_group_valid(g JSONB, keys TEXT[]) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $fn$
BEGIN
  IF jsonb_typeof(g) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF ARRAY(SELECT k FROM jsonb_object_keys(g) AS k ORDER BY k)
     IS DISTINCT FROM ARRAY(SELECT x FROM unnest(keys) AS x ORDER BY x) THEN RETURN false; END IF;
  RETURN NOT EXISTS (SELECT 1 FROM jsonb_each(g) AS e
                     WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'number' OR e.value::text !~ '^[1-5]$');
END
$fn$;

-- The whole sheet: exact top-level keys, version 1, and the three score groups (the CharacterSheet shape of
-- docs/analysis/harness/work-packets-geldar-a.md, card AN-02a).
CREATE OR REPLACE FUNCTION character_sheet_valid(s JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $fn$
BEGIN
  IF jsonb_typeof(s) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF ARRAY(SELECT k FROM jsonb_object_keys(s) AS k ORDER BY k)
     IS DISTINCT FROM ARRAY['alignment', 'attributes', 'op_modes', 'version'] THEN RETURN false; END IF;
  IF jsonb_typeof(s->'version') IS DISTINCT FROM 'number' OR (s->>'version') <> '1' THEN RETURN false; END IF;
  RETURN character_sheet_group_valid(s->'attributes', ARRAY['aggression', 'cleverness', 'common_sense', 'curiosity'])
     AND character_sheet_group_valid(s->'alignment', ARRAY['good', 'law'])
     AND character_sheet_group_valid(s->'op_modes', ARRAY['builder', 'crafter', 'explorer', 'farmer', 'miner', 'nitwit', 'warrior']);
END
$fn$;

DO $sheet_shape$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'agents'::regclass AND conname = 'agents_sheet_shape') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_sheet_shape CHECK (character_sheet IS NULL OR
      (character_sheet_valid(character_sheet) AND sheet_hash IS NOT NULL
       AND sheet_hash ~ '^[0-9a-f]{64}$' AND sheet_adopted_at IS NOT NULL));
  END IF;
END
$sheet_shape$;

CREATE OR REPLACE FUNCTION agents_sheet_immutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.character_sheet IS NOT NULL AND (
       NEW.character_sheet IS DISTINCT FROM OLD.character_sheet
    OR NEW.sheet_hash IS DISTINCT FROM OLD.sheet_hash
    OR NEW.sheet_adopted_at IS DISTINCT FROM OLD.sheet_adopted_at) THEN
    RAISE EXCEPTION 'the adopted sheet of life % is immutable (decision 0186)', OLD.agent_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS agents_sheet_immutable ON agents;
CREATE TRIGGER agents_sheet_immutable
BEFORE UPDATE OF character_sheet, sheet_hash, sheet_adopted_at ON agents
FOR EACH ROW EXECUTE FUNCTION agents_sheet_immutable();

CREATE TABLE IF NOT EXISTS proficiency (
  life_id TEXT NOT NULL REFERENCES agents (agent_id),
  domain TEXT NOT NULL CHECK (domain IN ('combat', 'farming', 'mining', 'building', 'crafting', 'exploring', 'social')),
  xp INT NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level SMALLINT NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 3),
  updated_tick BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (life_id, domain)
);

CREATE OR REPLACE FUNCTION proficiency_monotonic() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.xp < OLD.xp OR NEW.level < OLD.level THEN
    RAISE EXCEPTION 'proficiency is monotonic: xp and level of % % cannot decrease', OLD.life_id, OLD.domain
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS proficiency_monotonic ON proficiency;
CREATE TRIGGER proficiency_monotonic
BEFORE UPDATE ON proficiency
FOR EACH ROW EXECUTE FUNCTION proficiency_monotonic();

CREATE TABLE IF NOT EXISTS xp_evidence (
  life_id TEXT NOT NULL REFERENCES agents (agent_id),
  domain TEXT NOT NULL CHECK (domain IN ('combat', 'farming', 'mining', 'building', 'crafting', 'exploring', 'social')),
  evidence_key TEXT NOT NULL CHECK (length(evidence_key) BETWEEN 1 AND 200),
  source_event_id TEXT NOT NULL,
  world_tick BIGINT NOT NULL,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (life_id, domain, evidence_key)
);

DROP TRIGGER IF EXISTS xp_evidence_append_only ON xp_evidence;
CREATE TRIGGER xp_evidence_append_only
BEFORE UPDATE OR DELETE ON xp_evidence
FOR EACH ROW EXECUTE FUNCTION journal_append_only();

CREATE TABLE IF NOT EXISTS proficiency_outbox (
  outbox_id BIGSERIAL PRIMARY KEY,
  life_id TEXT NOT NULL REFERENCES agents (agent_id),
  domain TEXT NOT NULL,
  level SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 3),
  xp INT NOT NULL,
  version BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  UNIQUE (life_id, domain, level)
);

CREATE INDEX IF NOT EXISTS proficiency_outbox_unpublished
  ON proficiency_outbox (outbox_id) WHERE published_at IS NULL;

REVOKE ALL ON proficiency, xp_evidence, proficiency_outbox
  FROM PUBLIC, geldar_mcp, geldar_glass, geldar_register, geldar_supervisor;

COMMENT ON TABLE proficiency IS 'export: included in the own-rows export of the owner (format to confirm with C7-09); retention: world history keyed by life_id, owner link removed when the owner deletes the account (AN-04b completes the map)';
COMMENT ON TABLE xp_evidence IS 'export: included in the own-rows export of the owner (format to confirm with C7-09); retention: world history keyed by life_id, owner link removed when the owner deletes the account (AN-04b completes the map)';
COMMENT ON TABLE proficiency_outbox IS 'export: none, internal publication queue and not owner data; retention: to confirm in the AN-04b map';

INSERT INTO schema_migrations (version) VALUES ('0050') ON CONFLICT DO NOTHING;
