# BLD-11 worknotes

- Base for this pass: `d5e95181` (building/integration at session start).
- `doCell` (golem/src/building/cell-do.ts): reads the live cell first; `done_already` on target, `not_loaded` on null,
  `changed` when neither prior nor target (ruling 9); preflight `missing_materials` (a replace counts the item its
  break yields) and `no_tool` before any dig; then dig (prior) and place (target) through the BLD-06..08 handlers
  passed in as `CellHandlers`; verify the cell after each handler; `recordOwnPlacement` after a verified placement.
- Handler failure codes are mapped by reason and message; unknown failures are `refused`.
- `place.ts` does not call `recordOwnPlacement`; BLD-11 records from `cell-do.ts` and leaves `place.ts` unchanged.
- Not composed in `doCell`: stand, scaffold and hazard advice are batch-level and belong to the lane (BLD-13).
- Flag gating for `break` stays with the caller: `doCell` receives the handler it is given.
