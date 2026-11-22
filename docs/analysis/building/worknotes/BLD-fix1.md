# BLD-fix1 worknote

Review fixes 1 on building/integration (review-code-1). Base 727109a3.

## Done

- Materials wake reason is `precondition_failed` (the contract reason); `plan_stopped` was rejected by the validator.
- Survey box cap (`SURVEY_MAX_CELLS` = 32768), refused as `box_too_large` before the map is asked.
- Seen change in view only: a changed seen cell is recorded only when `cellInView` is true. `cellInView` now casts the same cone rays as `recordSeen`, so a cell is in view exactly when a sampled ray records it. An out-of-view change leaves the cell as the Body last saw it.
- Seen buckets: `seedBuildingBuckets` in the seed script creates `geldar-plans` and `geldar-seen`.
- `openRestartKv(natsUrl, building = false)` opens `geldar-plans` and `geldar-seen` only when `building` is on. adam/main.ts passes `config.building`. Players mains keep the default (they read no building flag).
- `restartBody().stop()` stops the seen wiring (timer), flushes its queued cells once, and flushes the plan writer (`PlanPersistence.flush()`).

- Metrics wired (no new subject or schema, existing `GolemMetrics` only). `createLaneWiring` takes `metrics`: `planCell(code)` per counted cell (a new `onCell` hook in `LaneDeps`, lane.ts), `planThrottleWait(paused)` per tick a cell is held (verdict `gap` or `tps`), `planQueueDepth` after each tick (new `PlanQueue.depth()`), `planSeconds` for the wall time between ticks while a plan is open. `createSeenWiring` takes `metrics` and calls `seenFlush(bytes)` per store flush (`FlushResult` gained `bytes`). Plumbed: adam-body -> restartBody -> createBody -> lane and seen. Revert-checks: removing the `onCell` hook makes the `planCell` test fail; removing `lane.fail()` makes the throw test fail.
- Test for an unexpected `queue.step` throw through `createLaneWiring`: the plan fails, one `failed` progress event, the error rethrows.

## Not done

- Tests for the throttle wait, plan seconds and seen flush metrics are not written (wiring only; the one metrics test covers planCell and queue depth).
- Plan writer flush in stop() has no direct test; restart-stop.test.ts covers the seen side only.
- Not checked: whether a tick after the throw rethrows again while the queue still holds the plan.

## Open findings from review-code-1 (unchanged)

- Finding 1 (plan_stopped wake), 4 (predecessor/inheritance flag), 7 (seen map eviction), 8 (survey and plan_check listed with the flag off), 9 (waiting_materials has no cap), 10 (abort signal, TPS estimate), 11, 12, 13, 14.
