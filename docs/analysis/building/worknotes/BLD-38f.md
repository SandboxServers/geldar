# BLD-38f worknote

Base `ca74edb8` (building/integration). Branch `phase1/bld-38f-progress-throttle`.

Done (BLD-38f2 pass):

- Throttle is tick-based (throttle.ts). `TickThrottle.before(now)` returns `go`, `gap` or `tps`. Gaps are tick counts (4 at healthy TPS, 8 from 12 up to 18). Below 12 TPS it returns `tps`: no cell runs and the lane's phase is `waiting_tps` until TPS recovers. A throw from the TPS source cancels the cell and keeps the cursor. No timer is used anywhere in the throttle. Tests: `throttle.test.ts` and `lane-throttle.test.ts`.
- Restored counts: `PlanLane.start(plan, saved)`, covered by `lane-throttle.test.ts` ("restored plan counts").
- Progress cadence: `progress-emitter.ts` (`PlanProgressEmitter`) is called from `wire-lane.ts` after each lane step with `PlanLane.snapshot()`. It sends `planProgress` on a phase change, every 25 cells or 30 s (`progressDue`), and sends one `goal_completed` wake per completed plan through `sink.wake`. Tests: `progress-emitter.test.ts`.
- `LaneSnapshot` and `PlanLane.snapshot()` added; `waiting_tps` added to `LANE_STATES`.

Done (BLD-38f3 pass):

- TPS clock: `createBody` takes an optional `wallClock` (default `Date.now`), passed to `createLaneWiring` and used by `TpsEstimator` and the progress cadence. The building fixture (`create-body-building.test.ts`) injects a clock that advances 50 ms per world tick (20 TPS). The earlier failure was the wall-clock estimate reading about 3 TPS under the fixture's `setTimeout` flush.
- Materials wake: `PlanLane.materialsShortfall()` returns `{ block, have, need }` while the cursor waits on missing materials (`need` is 1, the cell's block, `have` is the held count). `PlanProgressEmitter.observeShortfall` routes the wake (`MaterialsWait`, once per wait) through `sink.wake`. `WakeReason` gains the placeholder `plan_stopped` (`names.ts`, BLD-14 confirms).
- Failed phase: `PlanLane.fail()` ends the plan with snapshot phase `failed`. `wire-lane.ts` calls it when `queue.step` throws, emits the `failed` progress event once, then rethrows. Tests: `materials-wake.test.ts`.
- Revert-checks run for: tick gap, progress cadence, completion wake once, planProgress sink, materials wake once per wait, restored counts, failed phase, wall clock injected (each one-line mutation fails its named tests).

Not done:

- Seen predecessor: `restart.ts` `restartBody` does not pass `seen` to `createBody`. Missing sources: `RestartBodyOptions` has no `agentId` (the seen bucket key needs one), and no code in restart.ts yields the predecessor life (`seen.predecessor`). Seen keys are `<lifeId>.<section>`. Left unwired; `kv.seen` is already on `RestartBodyOptions.kv`.
- The materials wake is wired in `wire-lane.ts` but no test drives it through `createLaneWiring`; the unit tests cover the lane accessor and the emitter.
- The unexpected-throw path (`lane.fail()` in `wire-lane.ts`) has no test.
- `tools/repo-checks`: `nats-human-grants-nf.test.ts` (5 failures) and `scratch-human.test.ts` (1 failure) also fail on base `geldar-wt-building-int`. Not ours; not fixed.

Checks: golem typecheck clean. `biome check --write` on the touched files. vitest `golem/src/body golem/src/building`: 137 files, 1457 passed, 1 skipped.

Live: pending (not run).
