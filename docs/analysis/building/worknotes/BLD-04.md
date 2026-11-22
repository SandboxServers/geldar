# BLD-04 worknote

Status: Done (coder pass 1)
Branch: phase1/bld-04-expand
Worktree: C:\Users\Steve\source\projects\geldar-wt-bld-04
Base sha: eedba681 (building/integration at session start)
Commit: the single BLD-04 commit on phase1/bld-04-expand (`git log -1`)
Checks: biome check on player-core/src/building clean; player-core typecheck clean; vitest player-core/src/building 50/50
Revert check (test that failed): boxCells hollow branch disabled; "a hollow 3x3x3 box has 26 cells and leaves the centre out" failed (27 cells)
Live: pending
Notes:
- Expansion is in step order and lazy; `order` and `origin` are not applied by expandPlan (orderPlanCells orders a plan; origin is resolved when a plan is added).
- orderPlanCells: breaks first (top-down), then placements bottom-up, falling blocks last.
- Wall: `height` added; circle is the midpoint outline (12 cells at radius 2); sphere `hollow` added.
- index.ts and index.test.ts (S2 files) changed: barrel exports orderPlanCells; stub-throw test replaced by a smoke test.
