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

## Step 3 (B8-lazy6a): the plan store persists steps and cursor (format 2)
- `queue.ts`: `StoredPlan` is format 2 `{format: 2, body}` (palette, steps, origin, order) or format 1
  (the cell array). An add and a replace of a waiting plan store format 2. An add stores no cells, so a
  radius-120 sphere add is a few hundred bytes of steps (test: under 64 KiB). `restore` takes a stored
  plan: format 2 is expanded again with `expand(body)` and its total is a streamed count; format 1 keeps
  `arrayCellSource`. `restore` is now async (it counts), and a body that does not expand throws.
- `pin` (queue option, set from `body/create-body.ts` through `wire-lane.ts`): `pinOrigin` in
  `wire-expand.ts` replaces `origin: "here"` with the feet at add time before the body is stored or
  expanded, so a restart does not resolve `here` against the new position.
- `wire-plan-store.ts`: `encodePlan` and `decodePlan`. A JSON list is format 1; `{format: 2, body}` with a
  palette and a steps list is format 2; anything else is refused on read. `readRecord` replaces
  `readCells`. `resumePlanLane` awaits `restore`.
- Known gap (open, bounded): a replace of the ACTIVE plan still stores format 1 cells (the not-yet-placed
  cells, filtered by the placed-key set). The placed set is O(cursor) and the record is O(remaining)
  cells, so a big active plan still stores big. Fixing it needs a placed-key filter stored with the
  steps, which is not designed here.
- Tests (wire-plan-store.test.ts): steps stored in chunks; radius-120 sphere under 64 KiB; replace of a
  waiting plan stores steps; active replace stores format 1; death ends with no record; format 1 loads
  and runs; box and sphere persisted and resumed from new feet place the same remaining cells as an
  uninterrupted run (checked at the source the lane is started with, not a live lane run).
- Not done here: the lane is not run in the resume test (the source is checked); scaffold removal on a
  restored plan still has no `fresh` source (as before this pass).

## Step 4 (B8-lazy6b): yielding, TPS slice, flag-off, radius-120 bounds
- The add-time count (`countPlanCells`, wire-expand.ts) yields to the event loop after each slice. The
  slice comes from `countSliceFor(tps)`: 512 (`COUNT_SLICE`) at the base gap (18 TPS and up, or unknown),
  256 when the lane's gap is doubled (12 to 18 TPS), and 256 below 12 TPS (paused: the count still runs,
  it only yields more often). The reading is the Body's own TPS estimate, the one `TickThrottle` uses
  (throttle.ts `gapTicksFor`). No new cap. A slice is never below 1 cell, so a count always progresses.
- The queue takes `sliceFor` (queue.ts option, default 512); `wire-lane.ts` passes `countSliceFor(tps.tps())`.
- Layer boundaries are not yield points. The count yields per slice of cells; the lane places one cell per
  throttle gap on its own ticks, so it never holds the loop. A layer of a radius-120 sphere is at most a disc
  (about pi * 120^2 cells), which the layer spy below checks.
- Flag-off (create-body-building.test.ts): with `body_actions.building` off, the plan verb is refused with
  BUILDING_REFUSAL (the existing `not_possible` reply; the brief's `not_available` is the plan_check and
  survey reply, and the plan verb keeps its reply), no lane, no queue, and the plan store is never called.
  Revert-check: `planHandler(true, ...)` in create-body.ts fails both flag-off tests.
- Radius-120 (wire-expand-count.test.ts): a layer spy on `lazyBottomUp` shows the peak layer is at most
  pi * 120^2 + 1 and under 1/100 of the total; the add completes, yields exactly floor(cells / 512) times
  (more than 0), and stores a record under 64 KiB. Timeouts set to 60 s.
- Revert-checks run: `countSliceFor` returning 512 (fails the 18-to-12 TPS test and the slower-yield
  test); the yield removed from `countPlanCells` (fails the yield tests and the add yield test).
- Still open: a replace of the ACTIVE plan still stores format 1 cells (step 3 known gap).

## Not done (next passes)
1. Active-plan replace still stores format 1 cells (step 3 known gap): needs a stored placed-key filter,
   not designed yet. Its placed-key set is O(cursor) in memory.
2. Resume from a (layer, index) pair: not written. The numeric cursor is the only checkpoint key.
3. A restored plan has no `fresh` source, so scaffold removal does nothing on it (unchanged).
4. The `sliceFor` wiring in wire-lane.ts has no test of its own (its revert is not checked).
5. Live: no live lane run in this pass (flag on, real Bot). Live lane pending.
