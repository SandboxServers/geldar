# BLD-b8-lazy worknote

Packet: lazy plan expansion by layer (B8). Branch phase1/b8-lazy-layers.

## Done (steps 1 and 2)
- Step 1, `player-core/src/building/layers.ts`: `lazyBottomUp` yields the cells of a plan in the eager
  bottom-up order, one layer at a time, tested equal to the eager reference.
- Step 1, `golem/src/building/cell-source.ts`: `lazyCellSource(make)` reads a generator's cells by index.
  The generator starts on the first read, the cursor only moves forward, and a read behind the cursor
  throws. A numeric cursor from an old checkpoint resumes by pulling the cells before it, one layer at
  a time. `arrayCellSource` is the eager form it must match. `cellsOf` reads a source to an array.
  `filteredCellSource` drops the cells a keep-predicate refuses (used by replace).
- Step 1, `golem/src/building/wire-expand.ts`: `createPlanSource(feet)(body)` returns a new `CellSource`
  per call over `lazyBottomUp` (bottom-up) or the step-order expansion (`given`), with the same lane
  cells as `createPlanExpand`. `countPlanCells(source, slice = 512)` is the streamed total (decision D1):
  it reads a source to its end and yields to the event loop every `slice` cells.
- Step 2, `golem/src/building/lane.ts`: `LanePlan` holds `source: CellSource` and an exact `total`. The
  lane reads `plan.source.at(cursor)`; `snapshot().total` and the completion check use `total`. No
  `.length` and no array index remain in the lane.
- Step 2, `golem/src/building/queue.ts`: `PlanExpand` returns a fresh `CellSource` per call. `apply`
  counts the source with `countPlanCells` (the refusal path for a bad palette key is the count) and
  the queued reply takes that total. `replace` of the active plan builds the placed-key set from a
  fresh source of the old plan (its first `cursor` cells) and makes the new plan a `filteredCellSource`
  with a fresh factory. `restore` (from the store, arrays) wraps its cells with `arrayCellSource`.
  `body/create-body.ts` now passes `createPlanSource(feet)` as the expander.
- Tests: `wire-expand-source.test.ts` (5), `cell-source.test.ts` (7), and `lane-source.test.ts` (box,
  sphere and overlapping sequences equal to the array source, with the count equal to the eager length;
  a reflex pause keeps cursor 5 on a lazy source; slice length; queue replace of an active lazy plan
  places only the rest; a refused replace keeps the active plan running; cancel drops it). Existing
  lane, queue, throttle, materials-wake, wire-lane, executor-foreground and wire-plan-store tests are
  adapted by wrapping their arrays with `arrayCellSource`; their assertions are unchanged.

## Not done (next passes)
1. Plan store (`wire-plan-store.ts`): `stored(planId, cells)` still takes an array and the queue reads
   the whole plan into one (`cellsOf`) when a store is wired. Add still materializes the plan there.
   Chunked, per-layer storage (decision 0423) is the next pass; it is the blocker for requirement 3.
2. Yielding: the lane's slice does not yield between layer slices. Only the count yields (every 512
   cells). The replace of an active plan reads the placed prefix synchronously (O(cursor)).
3. TPS-aware slice size for the count: not written (fixed 512).
4. Flag-off: not written. `createPlanLane(false)` returns null already, but no lazy path is switched by
   a flag yet.
5. Resume from a (layer, index) pair: not written. The numeric cursor is the only checkpoint key.
