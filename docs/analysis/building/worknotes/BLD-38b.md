# BLD-38b worknote

Status: Done (wiring of the plan queue and lane into the Body tick, flag on only)
Branch: phase1/bld-38b-lane-wiring
Worktree: C:\Users\Steve\source\projects\geldar-wt-bld-38b
Base sha: df15d856
Commit: see git log (single squashed commit on top of the base)
Checks: vitest golem/src/body golem/src/building golem/src/actions (237 files, 2931 passed, 1 skipped); golem tsc --noEmit clean; biome check on touched files clean; check:repo exit 0; git diff --check clean
Revert checks: (1) lane not stepped (create-body.ts tick hook body) -> 3 tests fail; (2) death target without queue.cancel -> death test fails; (3) flag-off builds the lane (`if (true)`) -> flag-off test fails
Live: pending

Notes:
- runtime.ts: generic `tickHook(tick, reflexBusy)` option. It runs after the reflexes of a tick (reflexBusy is read right after onTick starts a reflex). A tick that finds a previous hook run pending skips the hook.
- wire-lane.ts: the queue and lane are built per Body; cells run through runtime.runAction, so they take the one action slot; ActionBusyError or a stopped runtime ends a cell as cancelled (cursor kept).
- wire-expand.ts: adapter over player-core expandPlan. Break and replace steps are refused (PlanNotRunnable) because the prior block is not known at submit time. Order defaults to bottom_up when the plan omits it.
- Not wired (BLD-38c/d): plan store, cursor checkpoint, plan_progress emit, restart resume, seen recorder/store, survey.
- No in-memory fallback was needed: PlanQueue and PlanLane take no store, checkpoint or progress interface.
