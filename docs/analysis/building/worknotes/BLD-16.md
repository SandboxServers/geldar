# BLD-16 worknotes: plan progress events and the materials wake

- `golem/src/building/progress.ts` builds the `plan_progress` payload from the lane's counts. It
  validates against the generated `validatePlanProgressPayload` (exported from `contract/src/index.ts`
  for this packet).
- Cadence: an event is due at 25 cells or 30 s (`progressDue`).
- `progressSentence` is the bounded `wait` sentence (240 characters). It names the plan, counts, phase
  and wanted item only.
- `MaterialsWait` wakes the Mind once per wait for a shortage; `resumed()` ends the wait.
- `completedWake` raises `goal_completed` with the counts.

Deviations from the packet, with reasons:
- The schema has no sample-index field (`additionalProperties: false`), so no sample indexes are emitted.
- The packet says to reuse `precondition_failed` for the materials wake. The brief says to use the
  reserved name in `names.ts`, `PLAN_WAKE_REASON` (`plan_stopped`). `WakeReason` in `body/wake.ts` does
  not list it, so the wake is a `PlanWake` object; the wiring in `body/wake.ts` is for a later packet.
- `programs/build.ts` does not exist in this tree, so the shortage wording is written here.
