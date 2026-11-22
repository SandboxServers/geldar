# BLD-fix2b worknote

Base 2a40c947 (building/integration). Branch phase1/bld-fix2b-facing.

## Done

- F2 facing convention. mineflayer 4.39.0 `physics.js:361` sets `yaw = atan2(-dx, -dz)`; the repo's
  `viewport.lookVector` is `(-sin yaw, sin pitch, -cos yaw)`. `cardinalOfYaw` and `stepsFromFacing`
  now use `dz = -cos(yaw)`. `yawForFacing(f)` and the new `yawToward(direction)` return the yaw that
  looks along the facing's offset. `clickedProperties` takes a stair/chest/door facing equal to the
  bot's look direction (the `OPPOSITE` mapping is removed). The old `yawForFacing` looked the right
  way for north and south only; east and west were reversed. Test: `place-state.test.ts` looks along
  each facing through `lookVector`. Live: `place.live.test.ts` places a stair facing east (written, not run).
- F11 `place.ts` 549 -> 482 lines. Moved `REPLACEABLE`, `NEIGHBOR_OFFSETS`, `CARDINALS`, `inBody`,
  `freeBeside`, `stepsFromFacing`, `isOpen`, `isFree` to `golem/src/actions/place-beside.ts`
  (`place.ts` re-exports `REPLACEABLE` for `body/programs/build.ts`).

## Not done (see report)

- F4 metrics spies, F5 restart stop flush spy, F6 `openRestartKv` flag test, F7 seed step, F8 adam-body plan_check test.

## Fix 2c (continuation of fix 2b)

- Merged building/integration (42358656) into the branch; the flag-off regression is fixed: adam-body.ts guards `restarted.body.seen` against undefined as well as null, so no plan_check or survey wiring is built with the flag off (revert-checked: 7 character tests fail with "reading 'map'").
- adam-body.test.ts: the served count is now 6 (snapshot, plan, view, survey, plan_check, image). The survey and plan_check subjects are served with the flag off and answer not_available by design (server.test.ts, plan-check-serve.test.ts, survey-serve.test.ts). The stale count was the test, not the code.
- F4: wire-lane.test.ts asserts planThrottleWait(true) for a 'tps' verdict, planThrottleWait(false) for a 'gap' verdict, and planSeconds(1.5) for 1500 ms. New wire-seen.test.ts asserts seenFlush(bytes) after a flush and no call without a store. Revert-checked: `/ 1000` removed and the seenFlush call removed; both tests fail.
- Open: F5 (restart stop flush awaited), F6 (main passes config.building to openRestartKv), F7 (seed step from main), F8 (adam-body plan_check answered with the flag on), and the facing per-kind check (see below).

## Facing per kind (superseded, stale)

~~The code applies one rule to stairs, doors, furnaces and chests: the placed facing is the bot's look direction (place-state.ts, FACING_BLOCK). From vanilla behaviour as recalled: stairs and doors take the player's look direction; chest, trapped chest, ender chest and furnace take the opposite direction. Fix to make: an opposite mapping for chest-like blocks and furnace in clickedProperties, with a test per kind.~~

Superseded: fix2d replaced the facing rule with a refusal. `FACING_VERIFIED` is empty, so a block ref with `facing` returns `state_unachievable` and nothing is placed. See `BLD-fix2d.md`. The F2 facing convention above is stale for placement: `clickedProperties` no longer writes a facing for any kind.