# BLD-b8-wire worknotes: stand, scaffold and hazard wiring into the cell executor

- `golem/src/building/cell-stand.ts` is the call-site adapter. `doCellAt` runs one plan cell: with no
  `stand` port on the handlers it is `doCell` alone; with one it asks `pickStand` for the stand cell
  (the BLD-09 solver, from the bot's feet), walks there with `goto` when the stand is not the feet
  cell, and runs `doCell`.
- `pickStand` skips a stand that touches lava or source water, or has falling sand in or above it
  (hazards.ts `hazardAt`), by re-running the solver with that cell read as solid. At most 8 skips.
  The solver itself is not changed. Side effect: a skipped cell also blocks sight rays through it.
- No stand: `withScaffold` calls the BLD-10 `scaffoldFor` with the agent's held blocks. It places the
  pillar or bridge cells, works the cell, then breaks the scaffold cells that sit on a plan cell.
  `missing_materials` when the held block is too few; nothing is placed.
- `wire-lane.ts` adds the `goto` handler and `standPortOf(bot)` to the handlers. Only `createLaneWiring`
  builds them, and create-body calls it only with body_actions.building on.
- Not wired: the retaining block for a cell touching lava (hazards.ts `retainBlock`) and the
  sand/gravel top-down ordering (hazards.ts `orderCells`). The spec does not say where the retaining
  block goes, so the owner should decide that first.
- Resolved: `create-body-building.test.ts` (2 tests) now use a fixture world with a stone floor at y 63
  (`floorWorld`), so the solver finds a stand and the direct place path runs. Their assertions are unchanged.
  The intent test's plan also gets `expiresTick` 1000000, because the fixture's world reads advance the view
  tick past the default expiry. The fake bot has no registry, so the place action itself still fails in the
  lane there; the tests do not assert on that place's outcome.
- Flag-off test: `create-body-building.test.ts` now spies on `createLaneWiring` (wire-lane) and `doCellAt`
  (cell-stand) through `vi.mock` wrappers that keep the real code. The spies cannot see calls made inside a
  module, so `standPortOf` and `pickStand` are covered only through their callers and the `blockAt` check.
