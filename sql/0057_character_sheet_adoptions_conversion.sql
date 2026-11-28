-- Migration 0057 (S12-04b, decision 0287): the adoption of the standard sheet for existing lives
-- writes its audit row with source 'conversion'. The only change is the widened CHECK on
-- character_sheet_adoptions.source: the new value set is a strict superset of the old one, so no
-- existing row fails and no existing writer is refused. No row, column or table changes.
-- The constraint name is the one PostgreSQL gives the inline CHECK in 0051. The drop has no
-- IF EXISTS on purpose: a different name fails the migration loudly instead of leaving two checks.
BEGIN;

ALTER TABLE character_sheet_adoptions DROP CONSTRAINT character_sheet_adoptions_source_check;
ALTER TABLE character_sheet_adoptions ADD CONSTRAINT character_sheet_adoptions_source_check
  CHECK (source IN ('config', 'roster', 'birth', 'conversion'));

COMMIT;
