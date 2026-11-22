# BLD-fix2d worknote: placed facing, restart and wiring tests

## Done

- **Placed facing per kind (golem/src/actions/place-state.ts).** No facing rule is verified in the repo:
  minecraft-data gives state values only, mineflayer 4.39.0 has no placement facing rule, and the earlier
  notes (BLD-08 says stairs and doors face back toward the bot; BLD-fix2b says they face the look)
  conflict. `FACING_VERIFIED` is therefore an empty list. A facing request is refused with
  `state_unachievable` for every kind, and nothing is placed.
- **Stair half.** A stair placed with `half` only (no facing) is still placed.
- **Restart flush (golem/src/body/restart.ts).** `restart` awaits the plan writer flush before `stop()`
  resolves; golem/src/body/restart-stop.test.ts asserts the flush.
- **Adam main (golem/src/adam/main.ts).** `restartKvFor(config, natsUrl)` passes `config.building` to
  `openRestartKv`. With the flag off, the plan and seen buckets are not opened
  (golem/src/adam/main-restart-kv.test.ts).
- **Seed step (golem/src/seed-buckets.ts).** `seedAllBuckets` creates the identity buckets and then the
  building buckets; `main` calls it (golem/src/seed-buckets-all.test.ts).
- **plan_check through the Body link (golem/src/adam/adam-body-plan-check.test.ts).** With the flag on
  the request is answered from the seen map; with it off it is refused `not_available`.
- **Throttle wait verdict (golem/src/building/wire-lane.ts).** The existing tests in
  golem/src/building/wire-lane.test.ts fail when the `tps` argument is inverted.

## Which kinds refuse a placed facing

| Kind | Facing | Half (stairs) |
|---|---|---|
| oak_stairs (and stairs) | refused, state_unachievable | placed |
| oak_door (doors) | refused | n/a |
| furnace | refused | n/a |
| chest, trapped_chest, ender_chest | refused | n/a |

Every kind listed is refused, so no facing is placed for any of them.

## Why

Refusing is the conservative choice. Placing a block with the wrong facing silently breaks a build, and
a refusal is visible to the Mind. Vanilla's look-versus-opposite rules for stairs, doors and chests are
not verified in this repo, so no kind is marked verified.

## Owner decision (open)

- Whether a verified facing rule for a kind should be added to `FACING_VERIFIED`, with the vanilla
  source or a live probe as the evidence.
- The refusal carries the generic `state_unachievable` reason. A per-kind reason text is not added.
- golem/test/live/place.live.test.ts "refuses a stair facing" asserts the refusal. It was written and
  not run in this packet (live: pending).
