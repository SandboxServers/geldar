# BLD-fix6: lazy plan expansion (review F4), NOT implemented

Status: NOT implemented. No code change at base `d87221c4`. The eager expansion is still in place: `createPlanExpand`
builds every cell of a plan before the lane runs, and the plan action has no size bound. The packet asked for a lazy,
bounded expansion with the same cell order as today. The order rule needs every cell before the first one can be
emitted, so a bounded-memory lazy source cannot reproduce it without a new design (see "Owner decision"). Decision 0423
(no cap) is respected: nothing refuses a plan.

## Facts (read from the code at base d87221c4)

- `createPlanExpand` (golem/src/building/wire-expand.ts) builds every cell with `steps.flatMap`
  and then calls `orderPlanCells(shifted, order)` with no anchor. The result is a plain array that
  `PlanQueue.add` stores in `cells` and the lane indexes by cursor.
- `orderPlanCells` (player-core/src/building/order.ts) returns, in this order:
  1. break cells (`pal === null`), sorted by `y` descending, then `x`, then `z`;
  2. solid placed cells (`falling` not true), sorted by `y` ascending, then horizontal distance to
     the anchor, then `x`, `z`, and input index;
  3. falling placed cells, sorted like (2).
  With no anchor the horizontal distance is 0 for every cell, so (2) and (3) are sorted by
  `(y, x, z, input index)`. The input index is the step order, then the expansion order within a step.
- Consequence: the first cell the lane may run is the minimum over all cells of the plan. A single
  forward pass over the steps cannot emit it, because a cell at `y = 0` can come from the last step.
- Cost of the eager path (from review F4, measured by the reviewer): sphere r=60 is 904,089 cells
  and 347 MB; r=120 is 7,236,577 cells, 5.9 s synchronous and 2.1 GB heap.
- `PlanPersistence.stored` (wire-plan-store.ts) does `JSON.stringify(cells)` in one call and
  `writePlan` splits the string into 64 KiB chunks. The same full array is needed.

## Options considered (none implemented)

1. Per-layer rescan. For each distinct `y` (ascending), expand all steps and keep the cells at that
   `y`, sorted by `(x, z, index)`. Memory is one layer, but the scan costs (number of layers) x
   (total cells). For a sphere of radius 120 that is about 240 x 7.2 M generator steps, which is
   minutes of CPU. Not acceptable without a per-shape y-restricted expansion in player-core.
2. External sort. Expand in slices of N cells, sort each slice by the key, write sorted runs to the
   plan bucket, then k-way merge the runs as the lane pulls cells. Memory is bounded by N and the
   number of runs. It needs a new module, KV reads during the lane's pull, a checkpoint cursor that
   indexes the merged stream, and restart that re-merges the runs. This is a new subsystem of several
   hundred lines.
3. Time slicing only (yield with setImmediate between slices). The synchronous `sort` still needs the
   whole array, so the event loop is still blocked by the sort and memory is still about 2 GB. It does
   not meet the goal.
4. Change the order rule. Emitting per step (or per layer of the first step) would be a streaming
   order, but it changes the behaviour of every plan and needs an owner decision.

## Owner decision needed

- Choose one: (2) an external sorted-run store with a merge cursor; (3') a y-restricted expansion in
  player-core per shape (time per layer bounded by the layer size); or (4) a new order rule, which
  changes what the Mind sees for the same plan.
- Separately, decide whether a health bound is still wanted. Decision 0423 says no cap; this note
  does not add one.
- The persistence side can be streamed on its own once the order is settled: write chunks as slices
  with a yield every N cells, so `JSON.stringify` never sees all cells.
