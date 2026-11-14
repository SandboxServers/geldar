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

- It does not run while the Mind's action runs and does not cancel it. The B2 path also waits for no action to be running.
- It does not run in a burrow the Body dug (at any hour), while asleep, or while riding.
- It does not coach the agent. The reflex reports facts only (0154).
- It does not change unstick's ownership rules (0164): the action still digs only blocks the Body does not own.
- It does not read the world beyond the Body's own cells and their neighbours (12 neighbour cells and 4 floor cells for `canStepOff`). An unloaded neighbour counts as possibly standable, so an unknown read never fires it.

## Limits (honest, from review)

- A ledge is any drop of 2 or more blocks on the open sides, so a ranger that stands on a natural platform or ledge by choice reads as stuck after 60 s with no action. A block the Body placed itself does not count. `unstick` then walks it down any drop it allows, with no check for hostiles nearby. This is an owner call, not decided here.
- Owner ruling (2026-11-14, as given to the coder): idle_stuck must NOT fire when the Body stands on blocks it placed itself (its own recorded work). Zack's natural stone ledge still counts. Implemented as `BodyView.onOwnPlacement` (the block under the feet, read from the in-memory own-placement record); `mayUnstick` checks it, so B1 and B2 both skip an own placement. Tests: a natural stone underfoot fires, an own-placed block underfoot does not.
- The Mind's plan can start while a 30 s unstick still runs. The executor waits at most 10 s for a busy reflex (`waitForReflexIdle` in `executor-action.ts`), then the plan's action starts. Not fixed here (item 3, 2026-11-14): the reflex runs `unstick` through the action registry, not the runtime's one action slot, so the slot is free during the dig. Holding it needs a slot hook on `ReflexContext` (`reflex.ts`) that `runtime.ts` honours, so `runtime.runAction` throws `ActionBusyError` while the reflex runs. That is about 30 lines across `reflex.ts`, `runtime.ts` and `idle-stuck.ts`, more than the executor-only change the packet allowed, so it is deferred to a packet of its own.
- Zack's case: unstick frees the Body only from a 2-3 block drop on an open side, by walking off it. With a drop of 4 or more on every open side at low health (under 12), `dropAllowed` refuses the walk. Then stair_dig digs a notch one block lower, the run counts as completed, and the reflex clears the backoff and considers the Body free. From the notch `canStepOff` can be true, so idle_stuck stops. The Body is one block lower, not out. "freed the body" in the log means only that the run completed.
- The upward dig (A) is still deferred and may be needed for Zack's exact cell.

## Deferred

- (A) The upward hand-dig rung: when the ledge is one block up with no open path, dig upward toward open air. Not built here; unstick digs sideways and down only, and a ledge with no sideways or downward way out still ends in "no way out" with the backoff.
