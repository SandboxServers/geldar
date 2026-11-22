# 0423. The Body runs a background plan queue of block edits; no size cap, tick-budgeted

- Status: Proposed (design). The behavior is Accepted: owner ruling 2026-11-22, rulings 5, 6 and 9.
- Date: 2026-11-22
- Spec: section 5 (durable intents, reflexes), decisions 0344 (program shapes) and 0349. It does not follow the 2026-11-22 research design that made a plan "the intent": the owner wants the Mind to keep thinking and acting while the plan runs.

## Decision

1. **A plan lane, not an intent.** A new Body component, the plan lane, holds one queue of block-edit plans per life. It steps in slices when the action slot is free: no reflex is running and no foreground intent step is in flight. Foreground intents and immediate actions keep their precedence; the lane pauses and resumes around them. Reflexes (hunger, danger, sleep) pause it and it resumes by itself.
2. **Mind verbs.** The Mind adds, replaces or cancels plans through one `plan` action (`op: add | replace | cancel`) and reads status through `status`, `survey` and `plan_check`. Large plans go up in chunks (`plan_id`, `final`), so no plan is limited by the 32 KiB output cap of one thought.
3. **Geometry helpers are authoring sugar.** `box`, `hollow_box`, `line`, `wall`, `circle`, `sphere` and an explicit `list` expand in the Body into single cells. The Body still places or breaks each cell as its own survival action (0420). There is no region clone; copying means the Mind writes a plan from what it saw (0424).
4. **Stale cells (ruling 9).** At execution the Body reads each cell. A cell that already matches is `done_already`. A cell whose block changed since planned is skipped and reported as `changed`. The plan keeps running and never overwrites blindly.
5. **No caps; a health throttle.** No limit on cells, volume or per-day edits. The lane keeps a minimum gap between block operations and widens it, then pauses, as the server's reported TPS falls (the `server_tps` world event). This is a throttle for server health.
6. **Storage under the 1 MB value limit.** A NATS KV value is limited by the server's `max_payload`, 1 MB by default (the repo sets none; unverified on the node). The plan is stored as chunks of at most 64 KiB under `geldar-plans/<life_id>.<plan_id>.<n>`; the checkpoint in `geldar-checkpoints` holds only a cursor, counts and a short skipped summary, under 4 KiB. A test builds a million-cell plan and asserts no value exceeds 64 KiB.
7. **Progress.** The lane emits `plan_progress` events (counts by failure code, next material need) and a bounded sentence for `wait`; `status` shows the active plan. Missing materials wake the Mind with the shortage.

## Why

An intent is replaced by any new intent, so a plan-as-intent would stop whenever the Mind queued a gather or a trip. The lane lets building and living overlap, which is the point of ruling 5.

## Consequences

- New Body code under `golem/src/building/`; executor and reflex code reused, not rewritten. The contention rule between lane and foreground intent is the riskiest piece (packet BLD-14) and is tested for starvation.
- A plan is not an action list: it is not counted by `max_block_operations` of an intent (that limit stays for ordinary intents).
