# BLD-06 worknote: the break action

- Base for this pass: `eedba681` (building/integration at session start).
- `golem/src/actions/break.ts` replaces the S3a stub: flag off refuses with `BUILDING_REFUSAL`; flag on digs exactly the named cell.
- Own dig path, not `mineAction.run`: `mine.ts` still calls `digSafetyRefusal`, which 0428 removes for `break`. `break.ts` imports nothing from `dig-safety`. It reuses `cellOf`/`MINE_CELL_MESSAGE` (mine-cell.ts) and `inventoryDelta` (mine.ts).
- No ownership gate (0420): `protected-blocks.ts` is not imported.
- Tests: `golem/src/actions/break.test.ts`, 14 cases.
