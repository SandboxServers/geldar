# BLD-13 worknotes: plan lane core

- `golem/src/building/lane.ts`: `PlanLane` steps a plan's cells in slices of `SLICE_TICKS` world ticks. The Body loop calls `step`; the lane has no timer.
- One plan at a time: `start` returns false while a plan is active. BLD-14 adds the queue.
- One cell in flight at a time. The in-flight cell gets its own AbortController, linked to the runtime signal.
- `pauseForReflex` sets `paused`, aborts the in-flight cell and resolves once that cell has ended. `resume` returns to `running` from the cursor. A cell that landed before the pause is read back as `done_already`.
- `endForDeath(revision)` matches the `DeathTarget` of `body/death-cancel.ts`: it drops the plan and aborts the in-flight cell.
- Retry rule: no cell is retried. Any code other than `placed`, `broken`, `done_already`, `missing_materials` or `cancelled` is recorded as skipped and the cursor moves on. `missing_materials` holds the cursor in `waiting_materials` with no cap; it ends when materials arrive, the plan is dropped, or the Body dies.
- `lane-state.ts`: `LANE_STATES` (`idle`, `running`, `paused`, `waiting_materials`) and `laneStateOf`.
- `createPlanLane(true)` now returns a lane; `resumePlanLane` stays a no-op until BLD-14.
- Not done here: KV plan and checkpoint writes (the lane has no KV handle), the restart hook, the create-body wiring (it discards the returned lane), `expand` (no `expand.ts` exists in `golem/src/building`).
