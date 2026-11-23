# BLD-05 worknote

- Plan store (`plan-store.ts`): `PlanKv` (put, get, delete), chunks of at most 64 KiB UTF-8 under `<life>.<plan>.<n>`, `writePlan` / `readPlan` / `deletePlan` with a chunk count the caller keeps. A missing or failed chunk is `PlanStoreError` code `store`; an oversize chunk is `too_large`.
- Plan checkpoint (`plan-checkpoint.ts`): stored at `<life>.plan` in `geldar-checkpoints` (the intent entry uses `<life>`, so the keys do not collide). `encodeCheckpoint` keeps the first skipped entries that fit 4 KiB and counts the rest in `skipped_dropped`. `PlanCheckpointWriter` saves in the background, coalesces, retries puts with backoff and logs after the last try.
- Not done here (MANUAL or other packets): NATS role and bucket seed for `geldar-plans`, `seed-buckets.ts`, `docs/runbooks/nats-auth-inplace.md`.
