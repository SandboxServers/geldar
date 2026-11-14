# 0196: idle_stuck reflex runs unstick for a ranger that cannot leave

- Status: Accepted
- Date: 2026-11-14
- Why: Zack has stood on a stone ledge at (-265.5, 35, 196.5) with 6.8 health for over five hours. Decision 0164 and #345 let `unstick` take no-damage drops and dig any non-owned block, but nothing called it: the unstick reflex needs two `goto` stalls in a row, Zack's Mind only waited, and dark shelter fired about every 200 ticks with "no suitable block".

## What fires and when

- **idle_stuck (B1).** The Body has not moved (less than 0.5 block from where it stood) for 60 s of game time (1200 ticks), no action is running, the Body is not asleep, not riding, and not in a burrow it dug. It is stuck in one of two ways. Enclosed: fires by day only. At night a sealed Body is in its shelter and is left alone. Ledge: no neighbour cell on the level, one up or one down, can take its next step (`canStepOff` is false). It runs the `unstick` action once. It does not fire while the block under its feet is one it placed itself: that is its own work, not a ledge (owner ruling 2026-11-14).
- **Backoff.** After a run that does not free the Body the next run waits 60 s, then 120 s, 240 s, 480 s, and 600 s (the cap). The wait counts from the end of the run, and the Body's position is taken again when the run ends, so the run's own movement does not clear the backoff. A run that frees the Body clears the backoff. Movement of 0.5 block or more by the Mind's own moves clears it too.
- **Hourly cap.** One Body starts at most 6 unstick runs in any hour of world time (72000 ticks). A run refused by the cap logs `capped at 6 runs an hour` and starts nothing. A respawn forgets the count.
- **dark_shelter refusals (B2).** The third dark shelter refusal ("no suitable block") in a row at one spot (within 2 blocks) runs `unstick` once through the same backoff. B2 has the same guards as B1 (no Mind action, not asleep, not riding, not in a burrow, not on its own placement) and also needs the Body to be stuck: `canStepOff` must be false. A different spot or any other shelter outcome starts the count again.
- **Priority.** idle_stuck has the lowest priority of the reflexes (10), so panic_burrow, hazard_escape, fall_stop, retreat, fight_or_flee and eat always run first. It is also checked only when the runner has no other reflex to run that tick.
- **Log.** One line per run, in the `reflex_fired` outcome detail: the source, the result, the backoff, and the position. No prompt or contract change.

## What it does not do

- It does not run while the Mind's action runs and does not cancel it. The B2 path also waits for no action to be running. Once it starts it holds the action slot until its run ends (item 3), so a Mind action requested meanwhile is refused as busy, not started.
- It does not run in a burrow the Body dug (at any hour), while asleep, or while riding.
- It does not coach the agent. The reflex reports facts only (0154).
- It does not change unstick's ownership rules (0164): the action still digs only blocks the Body does not own.
- It does not read the world beyond the Body's own cells and their neighbours (12 neighbour cells and 4 floor cells for `canStepOff`). An unloaded neighbour counts as possibly standable, so an unknown read never fires it.

## Limits (honest, from review)

- A ledge is any drop of 2 or more blocks on the open sides, so a ranger that stands on a natural platform or ledge by choice reads as stuck after 60 s with no action. A block the Body placed itself does not count. `unstick` then walks it down any drop it allows, with no check for hostiles nearby. This is an owner call, not decided here.
- Owner ruling (2026-11-14, as given to the coder): idle_stuck must NOT fire when the Body stands on blocks it placed itself (its own recorded work). Zack's natural stone ledge still counts. Implemented as `BodyView.onOwnPlacement` (the block under the feet, read from the in-memory own-placement record); `mayUnstick` checks it, so B1 and B2 both skip an own placement. Tests: a natural stone underfoot fires, an own-placed block underfoot does not.
- A Mind action cannot start mid-dig (item 3, 2026-11-14). The reflex holds the runtime's one action slot for its whole `unstick` run (`ReflexContext.holdSlot` in `reflex.ts`, honoured by `runtime.ts`, called by `idle-stuck.ts`). A Mind action requested meanwhile is refused as `busy` (`ActionBusyError`, facts only, 0154). The executor waits at most 10 s for the reflex (`waitForReflexIdle`, unchanged), then its action is refused as busy, not started. The slot is released when the run ends, on abort and on a throw.
- Zack's case (fixed in part, 2026-11-14): unstick frees the Body only from a 2-3 block drop on an open side, by walking off it. With a drop of 4 or more on every open side at low health (under 12), `dropAllowed` refuses the walk. stair_dig then digs a notch one block lower and the run completes. This used to clear the backoff and count as "freed". Now a completed run counts as freed only when `canStepOff` is true afterwards. A completed run that leaves the Body on a ledge is a failed run ("unstick left the body on a ledge"), it backs off like any other failed run, and idle_stuck stays armed. A ledge with no sideways or downward way out is left to the upward dig (A, below).
- Known limit, restart (item 4, 2026-11-14): `onOwnPlacement` checks the in-memory own-placement record first, then the ownership lookup (`ownerRecordAt`, after `prefetchOwners`), which names the Body's own blocks under its username. So a pillar the Body chose before a restart still counts as own once the record answers. The first read of a cold chunk is unknown, and unknown is not own: until the chunk answers, idle_stuck may fire on that pillar. Another player's record, or no record, is not own.
- Known limit: the hostile-nearby rule is not in place. idle_stuck does not check for a hostile near the Body before it runs `unstick`, and `unstick` walks and digs without that check. Not verified in this revision whether unstick refuses near hostiles on any path; treat it as open.
- The upward dig (A) is built (2026-11-14, see Deferred). Zack's exact cell (feet -265.5, 35, 196.5, 6.8 health, stone W and S, air N and E, drops of 4 or more) The unit fixture is modelled on that cell and climbs it. No live run has been made, so the live result is open.

## Deferred

- (A) The upward hand-dig rung (new `actions/unstick-up.ts`, reusing `escape-stairs.ts` `stairs()`): dig up or diagonally up through unprotected, hand-breakable blocks toward the nearest standable ledge or surface, within the 25 s hand-dig budget, never into liquid, with gravel/sand and lava/water hazards respected. Built 2026-11-14 (`actions/unstick-up.ts`, not `stairs()`, which has no budget). It climbs a pit wall one block at a time: it digs the two cells above a solid wall beside the Body and hops onto it, within the 25 s hand-dig budget and 4 steps. It refuses lava or water in a cell to dig, gravel or sand above a wall cell, and another player's block (`protectedReason`), and it stops on a cell `canStepOff` accepts. Unstick's order: walk, dig_down (elevated), stair_dig, dig_sideways, dig_down (flat), dig_up, dig_unowned (last resort).
- (3) Built 2026-11-14: idle_stuck holds the runtime's action slot for its whole run (see Limits).
- (4) Built 2026-11-14: own-placement persistence, through the ownership lookup (see Limits).
