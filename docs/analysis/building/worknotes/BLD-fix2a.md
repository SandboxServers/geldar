# BLD-fix2a: review fixes 2a (plan_check bounds, view range pre-filter)

Base for this pass: 2a40c947 (building/integration). Source: review-code-2.md findings F1, F3, F9, F10, F12.

## What changed

- F1 (bounded work). `sphereCells` walks rows (dx, dy) and computes each row's z-range with an exact integer
  square root, so work follows the cells yielded (no cube scan). `wallCells` walks the floor line lazily per
  layer (no spread). `boxCells` skips the z-scan of a hollow box's interior column. `plan-check-reply.ts` refuses
  a step over `WORK_BOUND` (4 x PLAN_CHECK_CELL_CAP) before expansion with `plan_too_large`: box x-y columns,
  wall length x height, sphere face (2r+1)^2. Each refused shape has more than the cap's cells, so no valid answer
  changes; the sphere and wall outputs for small inputs are unchanged (geometry-reference.test.ts compares them
  with the pre-fix generators).
- F3 (cap and origin tests). Exactly PLAN_CHECK_CELL_CAP cells answered, CAP+1 refused; origin `here` at feet
  x 10.7, z -0.3 resolves to cell (10, -1) through planCheckFrom.
- F9 (view pre-filter). `cellInView` returns false before any ray when the cell centre is farther than the
  view range plus half a block diagonal (sqrt(3)/2). The half diagonal is needed so results stay identical: a
  ray sample inside the cell can be up to that far from the centre. Test counts `block()` calls: zero for a cell
  beyond range.
- F10 (lineCells tie). No code change. geometry-reference.test.ts checks that a line and its reverse cover the
  same cell set for every end point in [-4, 4]^3; it passes. The review's tie asymmetry was not reproduced in
  that range.
- F12 (invalid_steps). `dryRun` lists at most 256 invalid steps (the first by index). No contract change.

## Not done

- The `overWorkBound` pre-check is observably redundant with the cap for these shapes (the lazy generators
  stop at the cap after a few thousand yields); it bounds work before expansion as F1 asks.
