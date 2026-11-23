# BLD-28: Paper integration test for break and plan

- File: `golem/test/live/building.live.test.ts`. A `*.live.test.ts`, so the root config excludes it and only `pnpm --filter @geldar/golem test:live` picks it up.
- Gate: `describe.skipIf(!buildingLiveEnabled)` with `GELDAR_IT=1`. Without it the file is skipped (5 skipped, 0 failed).
- Status: written, not run (needs shard). The shard has `body_actions.building` on.
- Survival only: the Body's break, place and plan lane make the edits. The server `setblock` sets up a cell or perturbs one cell (the changed-cell case). No `/fill`, no creative supply.
- Slot 5 (no other live file uses it).

Cases written: break a stone block (drop in inventory); break then place in one cell; a 5x5 floor with a 3-high wall from one plan; a changed cell is left alone; cancel of an unknown plan is refused with `not_possible`.

Not written yet (the packet lists them): the door in a wall (the wall-with-gap step is not expressible as written), stairs with facing, the plan interrupted by a hostile mob and resumed, Body restart mid-plan, the `changed` skip reported in plan progress, 20 and 10 TPS, `survey` absence behind a wall, and the server-log check for `/fill` and `/setblock`.

Finding for the orchestrator: `golem/src/body/create-body.ts` registers `planHandler(options.building)` with no queue and never builds a `PlanQueue`, so with the flag on, `plan` throws `not_implemented: plan` on the real path. The plan cases fail until the queue is wired (BLD-14's wiring is not in `building/integration`).
