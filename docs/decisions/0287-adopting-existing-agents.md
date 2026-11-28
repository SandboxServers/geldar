# 0287. Adopting the standard sheet for existing agents

- Status: Proposed (the operator records acceptance; no `--apply` has run against any agent).
- Date: 2026-11-28
- Spec: none. This is a contract record for the character-sheet campaign; `docs/spec.md` is not edited.
- Related: 0328 (the stage order and the held-live ruling this record carries out), 0186 (the immutable adopted baseline), migration 0050 (`agents_sheet_immutable`), migration 0051 (`character_sheet_adoptions`), 0282 (sheet erasure), sql `0057_character_sheet_adoptions_conversion.sql`, the `player adopt-sheets` verb (S12-04a planner, S12-04b apply).

## Context

Lives that existed before the character sheet have no adopted baseline: `agents.character_sheet` and `sheet_hash` are NULL. Decision 0186 makes the first adopted sheet of a life its immutable baseline. Decision 0328 says every existing agent adopts the standard sheet ("standard", the all-3 sheet) once the campaign is complete and has test-shard evidence, and that a named sheet is a later stage.

## Decision

1. **Stage 1 (this record).** Every existing life adopts `"standard"` (all-3). It is written by `player adopt-sheets --apply --operator-confirm`, which writes only the standard sheet, only a life whose baseline is NULL, and only a life that is not dead. A life with a different baseline is a conflict and is not written. A second run is a no-op. Each adoption is one transaction: one `sheet_adopted` events row with source_event_id `conversion:sheet_adopted:<life>`, the agents row, and one `character_sheet_adoptions` row with source `conversion` and result `adopted`.
2. **Stage 2 (not decided here).** A named sheet for a life that holds the all-3 baseline. The baseline is immutable (0186) and drift is off, so moving an adopted sheet has no mechanism yet. It needs its own record ("Moving an adopted standard sheet to a named sheet") with a number from the registry, before stage 2 can run. Each ranger's stage 2 needs the operator's recorded approval.
3. **Schema.** sql 0057 widens the `character_sheet_adoptions.source` CHECK to add `conversion`. It is a relaxation only: no row, column or table changes.
4. **Operator act.** Running `--apply` against a live agent is an operator act, never part of the code change. It is held until the held-live ruling in 0328 is lifted for that agent.

## Consequences

- Nothing in CI, and nothing in the default path of the verb, writes: the write needs both `--apply` and `--operator-confirm`, and neither has a default or an environment fallback.
- Before any `--apply`: the contract enum change is made with this record. The `sheet_adopted` event payload schema (`contract/schemas/sheet-adopted-event.schema.json`) now lists `source` as `config`, `roster`, `birth` or `conversion`, because the apply writes `conversion`. The generated types and validators are regenerated from it.
- Open: the constraint name in sql 0057 is the PostgreSQL default for the inline CHECK in 0051. It is confirmed by ops against a database migrated to 0066 before the migration runs there.
