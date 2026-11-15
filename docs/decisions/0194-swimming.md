# 0194: swimming is a Body movement with an air budget; goto stops swimming at air 10

- Status: Decided (owner approval via geldar-93, 2026-11-14)
- Date: 2026-11-14
- Why: the lake box (x -320..-270, z 200..240) and the channel east of it caused 15 deaths in 30 h (3 drownings, 6 melee, 5 arrows, 1 creeper), and the drownings were in the channel and under its banks. The diagnosis (read-only, 2026-11-14) found that the Body's water code stops a drowning but cannot plan a way out: the pathfinder refuses a bank one block above the water (`getMoveJumpUp`), so a Body in the 12-deep channel has no plannable exit, and a goto whose goal is a water cell ends in the water. Decision 0184 fixed the reflex, the goal end and the tier-1 swim cost, and left item 8 open: a planner water exit, an air-aware swim, water facts in results, and a deliberate crossing. This record decides item 8. The owner's report also names "path search ran out of time" and salmon out of reach in open water; those reports are not in the diagnosis files and are not checked here.

## (a) A swim is a movement with an air budget

A `goto` may cross water on purpose. A surface swim is the cheap way across a lake (tier-1 `liquidCost` stays 3, so a dry route is still preferred). While the goto swims, a controller in `golem/src/actions/swim.ts` watches the Body's own air (`ownAir` from `body/air.ts`, decision body-air-own; never `bot.oxygenLevel`):

- Air counts down only while the head cell (floor of the feet y plus 1.62) is liquid. A surface swim with the head in air loses nothing and the controller does nothing.
- At air 12 or less with the head in liquid, the controller surfaces: it holds jump on every physics tick, as `swimUp` does. Twelve is also the reflex line (amended by 0337: the reflex starts at DROWNING_START_AIR = 12, was 8), so a swim that reaches 12 is handed to the reflex.
- With a solid block over the head, the controller steers toward a breathing column (`findBreathingColumn`, the same search as the reflex, exported and shared) instead of holding jump into the roof.
- At air 10 or less, with no bank exit in reach, the controller stops the goto. The stop is a fact result (section d), not a retry.

## (b) Stop at 10, steer at 12, reflex unchanged at 8

- The controller's thresholds are: steer (surface) at air 12, stop the goto at air 10.
- `hazard_escape` fires at air 12 or less (`DROWNING_START_AIR`, amended by 0337; was 8 as `DROWNING_AIR`), with the same 40-tick quiet window and 200-tick give-up. It is the failsafe. The controller must not read the reflex's quiet window, and the reflex does not read the controller.
- A swim at air 13 to 20 is not a reflex event; a swim that reaches air 12 is caught by the reflex, which cancels the goto as it does today.
- Amended by 0337 (2026-11-15): the reflex starts at DROWNING_START_AIR = 12, not 8. The swim abort at 10 is dead while swim is off (the reflex fires first); the reflex at 12 is live. Lines 12, 19 and 20 above now read as amended.

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

## Amendment 2026-11-15: facts reach the Mind

- The "no contract changes" rule of this record (section (d) and "Not in this record") is amended. The reason enum and the schema shape stay as they are, but the swim facts need two additive allow-list entries before the Mind reads them.
- `goto` joins `PLAIN_FACT_VERBS` in `contract/src/outcome-words.ts`, so a completed goto's swim note is sent as its plain fact.
- `interrupted` joins `DETAIL_REASONS` in the same file, so a goto stopped at air 10 sends its fixed failure text as detail.
- Both entries are additive allow-list changes, owner-approved via geldar-93 (2026-11-15). They ship in the contract PR phase1/swim-facts-contract, not in the phase1/swim-0194 commits.
- The Body sends the text: `golem/src/body/executor-outcome.ts` reads a goto's note as its ok detail, and sends the swim stop text as the detail of an `interrupted` goto. Both are fixed text with the air value and no advice.
- Until the contract PR is merged, the Body still sends the interrupted goto's text, because it is set before the `outcomeDetailText` gate, and the outcome handler keeps the detail of any failure. The ok note is held back by the handler's `PLAIN_FACT_VERBS` gate until the contract PR is merged.

## Amendment 2026-11-15 (0337): the reflex starts at 12, not 8

- Dated amendment; the text above is kept as written. Where it says the reflex is at 8, read 12: `DROWNING_START_AIR` = 12 (0337), the trigger, the "recovered" test (air above 12) and the `hazard_escape` run.
- Test 7 of the plan reads: `check()` is null in water at air 13 to 20 and fires at air 12 or less. It is not "9 to 20" and "8 or less".
- The threshold line of "Not in this record" (the reflex threshold, "(8)") and the threshold list of the cooldown amendment ("reflex at 8") now read 12 for the reflex. The quiet window (40 ticks) and the give-up (200 ticks) do not change.
- The swim controller keeps its own hand-over line, `SWIM_HAND_OVER_AIR` = 8 (`golem/src/actions/swim.ts`). The swim abort at `ABORT_AIR` = 10 is dead while swim is off, because the reflex fires at 12 first.
