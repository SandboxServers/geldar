# 0194: swimming is a Body movement with an air budget; goto stops swimming at air 10

- Status: Decided (owner approval via geldar-93, 2026-11-14)
- Date: 2026-11-14
- Why: the lake box (x -320..-270, z 200..240) and the channel east of it caused 15 deaths in 30 h (3 drownings, 6 melee, 5 arrows, 1 creeper), and the drownings were in the channel and under its banks. The diagnosis (read-only, 2026-11-14) found that the Body's water code stops a drowning but cannot plan a way out: the pathfinder refuses a bank one block above the water (`getMoveJumpUp`), so a Body in the 12-deep channel has no plannable exit, and a goto whose goal is a water cell ends in the water. Decision 0184 fixed the reflex, the goal end and the tier-1 swim cost, and left item 8 open: a planner water exit, an air-aware swim, water facts in results, and a deliberate crossing. This record decides item 8. The owner's report also names "path search ran out of time" and salmon out of reach in open water; those reports are not in the diagnosis files and are not checked here.

## (a) A swim is a movement with an air budget

A `goto` may cross water on purpose. A surface swim is the cheap way across a lake (tier-1 `liquidCost` stays 3, so a dry route is still preferred). While the goto swims, a controller in `golem/src/actions/swim.ts` watches the Body's own air (`ownAir` from `body/air.ts`, decision body-air-own; never `bot.oxygenLevel`):

- Air counts down only while the head cell (floor of the feet y plus 1.62) is liquid. A surface swim with the head in air loses nothing and the controller does nothing.
- At air 12 or less with the head in liquid, the controller surfaces: it holds jump on every physics tick, as `swimUp` does. Twelve is above the reflex line of 8, so a normal swim does not trip the reflex.
- With a solid block over the head, the controller steers toward a breathing column (`findBreathingColumn`, the same search as the reflex, exported and shared) instead of holding jump into the roof.
- At air 10 or less, with no bank exit in reach, the controller stops the goto. The stop is a fact result (section d), not a retry.

## (b) Stop at 10, steer at 12, reflex unchanged at 8

- The controller's thresholds are: steer (surface) at air 12, stop the goto at air 10.
- `hazard_escape` is unchanged: it fires only at air 8 or less (`DROWNING_AIR`), with the same 40-tick quiet window and 200-tick give-up. It is the failsafe. The controller must not read the reflex's quiet window, and the reflex does not read the controller.
- A swim at air 9 to 20 is not a reflex event; a swim that reaches air 8 is caught by the reflex, which cancels the goto as it does today.

## (c) Planned exits and the re-entry cooldown

- Exit planning: `allowWaterExit` in `golem/src/actions/water-rules.ts` wraps `getMoveJumpUp` on the movements instance (the same style as `forbidCornerCutting` and `allowDoors`; no subclass). It applies to tier 1 (`ensurePathfinder`) and tier 2 (`digMovements`). A bank is accepted only when it is solid, has two free dry cells above it, has no solid head cell, no falling block above it and is not lava, magma or cactus. Banks two or more blocks above the surface stay with tier 2's digging and towers under decision 0164.
- Re-entry cooldown: after a `hazard_escape` give-up, the Body refuses to re-enter water for a cooldown, unless a deliberate swim is active. A deliberate swim is a goto whose planned path has wet nodes; the controller records it in a WeakMap set by `onPathUpdate` (`pathing.ts`). A deliberate swim may start only at air 18 or more, so a Mind that loops back into the lake at low air is still held.
- Only goto, travel and reach count as deliberate swims. A future fish action sets the same flag.

## (d) Swim facts only in result lines (0154)

- A completed goto that swam carries a fixed-form fact in its note: the count of blocks swum and of surfaces (for example "swam 12 blocks, came up for air twice"). The outcome reason enum does not change (contract `action-outcome-event.schema.json`).
- A goto stopped at air 10 fails with a fixed short text and an existing reason (`interrupted`), with the air value as a fact. No advice, no suggestion of what the Mind should do.
- A swim that ends with no bank exit reports the existing `BLOCKED_TEXT`; nothing new is added.
- No prompt change: a result line is a fact, not a rule.

## (e) Tests that must fail without the change

Each test below must fail on the code before its step. Revert-check: one line mutated back to the real previous code per test, the test runs and fails for the stated reason, and the file is restored from a backup.

1. `water-rules.test.ts`: a bank one block above water, with two water cells at its foot, gives a jump-up neighbour only with `allowWaterExit`. A solid head cell, gravel above, or a lava, magma or cactus bank each gives none; removing each guard flips its case.
2. `pathing.test.ts`: a goto across a 30-wide strip of water to a dry far bank returns ok with the wrapper and blocked without it.
3. `swim.test.ts`: head in liquid at air 12 or less holds jump on every physics tick; head in air does nothing (no spurious jumps).
4. `swim.test.ts`: a roof over the head selects the breathing column and sets forward; reverting the steer leaves forward unset.
5. `swim.test.ts`: air 10 or less with no exit stops the goto with the fact reason; reverting the stop lets the goto continue.
6. `goto.test.ts`: a completed swim note holds the swim count and surfaces, and the outcome stays inside the reason enum and under 160 characters.
7. `hazard-escape.test.ts`: `check()` is null in water at air 9 to 20 and fires at air 8 or less; a firing mid-swim still cancels the goto.
8. Cooldown test: the re-entry cooldown applies after a give-up without a swim intent, and not with an active swim goal; reverting the intent check flips it. A deliberate start at air 17 is refused, at 18 allowed.
9. Live (lake box, shard only, one at a time, geldar-93 window): perch to the far bank across the lake; record the position, the minimum air and the result line; plus one undercut-bank exit at x -258. Not run in this packet.

## Implementation plan (not coded by this record)

The packet that implements this record does these steps in order. Each step is a separate commit and each has its test from (e).

1. `water-rules.ts`: `allowWaterExit` wraps `getMoveJumpUp`, with the bank guards of (c). Wire it in `ensurePathfinder` and `digMovements`. Pin the getBlock-height trick to pathfinder 2.4.5 with a test. Tests 1 and 2.
2. `swim.ts`: the controller of (a) and (b): surface at air 12, breathing column, stop at air 10, counters. Start it inside `moveNear` beside `watchPathEvents(bot)` and tear it down in `cleanup()`. Export `findBreathingColumn` from `hazard-escape.ts`. Tests 3 to 5.
3. Cooldown skip: DROPPED (amendment below). The `swimIntent` WeakMap, the re-entry cooldown and its test 8 are not built.
4. Note lines: `MoveResult.message` carries the swim fact into `goto.ts` `note`; the stop text is fixed. Test 6.
5. Reflex: no code change; test 7 pins it.
6. `pathing.ts` stays under 700 lines. It is 670 lines after the move in this packet (Step A, commit 1).
7. Live lake-box run (test 9) only when geldar-93 gives a window.

## Not in this record

- No change to the reflex threshold (8), its quiet window or its give-up.
- No contract change, no prompt change, no world edit (the owner's terrain options are not decided here).
- The night skeleton and creeper deaths in the lake box are not a swimming question; cover and light are separate.
- The "path search ran out of time" reports are not reproduced here.

## Amendment: the re-entry cooldown skip is dropped (2026-11-14, swim step E)

- The "step 2 cooldown skip" of (c) and plan item 3 has nothing to skip: no re-entry cooldown exists in code after a `hazard_escape` give-up. `hazard-escape.ts` has only its 40-tick quiet window, which stops the reflex firing again and does not refuse water entry. Nothing in the planner or the walk refuses to re-enter water.
- So the `swimIntent` WeakMap, the deliberate-swim exception, the air 18 start for a deliberate swim, and test 8 are not built. They are not deferred to a later step; they are dropped with this amendment.
- Revisit if a re-entry cooldown is added: then the deliberate-swim exception and the air 18 start apply to it, and test 8 is written with it.
- Every other rule of this record stands: the air budget, the thresholds (surface at 12, stop at 10, reflex at 8), the bank exit guards, and the swim facts in result lines.
