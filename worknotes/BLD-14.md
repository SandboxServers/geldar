# BLD-14 worknotes: plan queue, foreground pause and resume

- Queue (`golem/src/building/queue.ts`): one active plan per life, others wait in order. `add` joins chunks
  (`seq` 0.., `final` on the last; a single message is one chunk). A bad seq drops the upload and refuses;
  the Mind sends again from seq 0. No retry and no cap on chunks or plans.
- `replace` of the active plan drops its unexecuted cells and keeps the placed ones (cells before the lane
  cursor, matched by position). `replace` of a queued plan keeps its place. `cancel` takes one id or `all`.
- Contention (`golem/src/building/contention.ts`): a holder set. A reflex or a foreground intent holds the
  lane; the first hold pauses it, the last release resumes it. The queue will not run a slice while held.
- The lane has no `cancel()`; the queue drops the active plan through `endForDeath(0)`. A dedicated
  `PlanLane.cancel()` belongs in `lane.ts` (BLD-13's file, outside this packet).
- Not done here: the restart hook (`golem/src/body/restart.ts`) and the restart-mid-plan test; they need
  KV reads and the restart file, both outside this packet's file list.
- `planHandler(true)` with no queue still throws `not_implemented: plan` (create-body does not wire the
  queue yet).
