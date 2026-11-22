# BLD-fix4b: review fixes 4b, account erasure removes seen maps and saved plans

Base for this pass: 6fe2448b (building/integration, merge of bld-fix3b).

## What changed

`tools/players-cli/src/erase-owner.ts` (the operator erasure) now also erases the building data of each erased life:

- `geldar-seen`: every key `<life_id>.<sx>.<sy>.<sz>` (the seen-map sections, BLD-18).
- `geldar-plans`: every key `<life_id>.<plan_id>.<seq>` (the plan chunks, BLD-05).
- `geldar-checkpoints`: the exact key `<life_id>.plan` (the plan checkpoint).

The new module `tools/players-cli/src/erase-building.ts` holds the logic. The key formats are copied from golem
(`seen/store.ts` sectionKey, `plan-store.ts` chunkKey, `plan-checkpoint.ts` checkpointKey), not imported. The tool
keeps no dependency on golem, and the seen and plan-activity fences do not scan `tools/`.

- Seen and plan keys are matched by the prefix `<life_id>.`. Life ids hold no dot (LIFE_ID in erase-owner.ts), so
  life `life-a1` never matches the keys of `life-a10`.
- The checkpoint bucket also holds the body checkpoint, keyed by the bare life id (golem/src/body/checkpoint.ts).
  Only `<life_id>.plan` is erased there.
- A bucket that does not exist (the building flag was never on) is absent: it counts as empty and the erase goes on.
  Existence is read from the JetStream stream names (`KV_<bucket>`). A bucket that exists but fails to open still
  fails the run.
- Reads come first (candidate keys, then a get per key). Purges run only after every read succeeded. A purge error
  stops the run and reports `failed`; a second run finds what is left and purges it.
- The erase outcome has a `building` list (per bucket: candidates, found, purged, absent). The output shows counts only.

## Not done here (findings)

- The body checkpoint `<life_id>` in `geldar-checkpoints` is not erased. The packet names the plan checkpoint only.
  Whether a dead life's body checkpoint should go is a separate decision.
- NATS: the operator connection (GELDAR_NATS_URL) needs `$KV.geldar-seen.>`, `$KV.geldar-plans.>` and
  `$KV.geldar-checkpoints.>` (purge and read), and `$JS.API.STREAM.NAMES`. This was not verified against a live
  server. The Body role's missing `geldar-plans` and `geldar-seen` grants (nats-auth-inplace.md) are a different
  connection and are not changed here.
- `docs/runbooks/account-deletion.md` step 5 still lists only `geldar-skins` and the registry key. It needs the
  building buckets added. That file is outside this packet.
- BLD-18's "not wired" line about erase-owner is now answered by this packet (it uses a local copy of the key
  logic, not `eraseLife`).

## Checks

- Test: `tools/players-cli/src/erase-building.test.ts` (6 cases): two lives of the target owner (plus a prefix
  neighbour and another owner's life) are erased from the three buckets and nothing else; a second run finds
  nothing; a missing bucket is tolerated; a dry run changes nothing; a purge error fails the run with partial
  counts; a failed read changes nothing.
- Revert-check: `await purgeBuilding(building);` in `erase-owner.ts` commented out. Three cases fail (keys remain,
  and the purge-error case reports `purged` not `failed`). The file was restored from a backup; diff empty.
