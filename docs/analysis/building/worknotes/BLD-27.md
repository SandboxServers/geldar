# BLD-27 worknote

Status: Checks running
Branch: phase1/bld-27-metrics
Worktree: C:\Users\Steve\source\projects\geldar-wt-bld-27
Base sha: 35fa52073270de2a9c174c1ae45eb17a94447c9f
Commit:
Checks:
Revert check (test that failed):
Live: none (no live lane in this packet)
Notes:
- Added the plan metric surface on `GolemMetrics` (cells by code, plan seconds, throttle waits by pause, seen flushes
  and bytes, queue depth gauge) with closed label sets (`code`, `paused`).
- The eventsink labels `plan_progress` as its own event type (it was counted as `other`).
- The plan lane has no progress emitter, throttle caller or seen-map flusher in this branch yet, so the new methods
  have no call sites. They are for the lane and seen flush to call when they land.
- `plan_progress` events are stored by the generic `events` path (not projected); no new table.
