# BLD-38c worknote

Base `abcd4f62`. Implemented on `phase1/bld-38c-plan-store` after the coordinator rulings.

- TPS: Body-side estimate from this Body's tick times (`building/tps-estimate.ts`), exposed as `LaneWiring.tps`. Not `server_tps`. Not yet read by the lane (see below).
- Plan store: `PlanQueueStore` hook in `queue.ts` (optional; `stored`, `dropped`, `progressed`), `PlanPersistence` in `building/wire-plan-store.ts` (cells as chunks in `geldar-plans`, cursor in the checkpoint bucket).
- Resume: `resumePlanLane` in `building/wire-plan-store.ts`, called from `restartBody` after start. The no_plan wake is skipped when a plan resumed.
- Buckets: `openRestartKv` opens `geldar-plans` and `geldar-seen`.
- MANUAL: NATS role for both buckets, and the bucket seed (`docs/runbooks/nats-auth-inplace.md`, `golem/src/seed-buckets.ts`). Not done here.

Not done:
- Throttle (`throttleWait`) is not applied in the lane; the TPS estimate is not yet read.
- Progress emission (`plan_progress`, progress wakes) is not wired.
- The seen store is opened but not passed to the seen wiring on restart.
- Restored plans keep no counts or skipped summary (the lane restarts them empty).
