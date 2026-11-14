# 0196: idle_stuck reflex runs unstick for a ranger that cannot leave

- Status: Accepted
- Date: 2026-11-14
- Why: Zack has stood on a stone ledge at (-265.5, 35, 196.5) with 6.8 health for over five hours. Decision 0164 and #345 let `unstick` take no-damage drops and dig any non-owned block, but nothing called it: the unstick reflex needs two `goto` stalls in a row, Zack's Mind only waited, and dark shelter fired about every 200 ticks with "no suitable block".

## What fires and when

- **idle_stuck (B1).** The Body has not moved (less than 0.5 block from where it stood) for 60 s of game time (1200 ticks), no action is running, the Body is not asleep, not riding, and not in a burrow it dug. It is stuck in one of two ways. Enclosed: fires by day only. At night a sealed Body is in its shelter and is left alone. Ledge: no neighbour cell on the level, one up or one down, can take its next step (`canStepOff` is false). It runs the `unstick` action once.
- **Backoff.** After a run that does not free the Body the next run waits 60 s, then 120 s, 240 s, 480 s, and 600 s (the cap). The wait counts from the end of the run, and the Body's position is taken again when the run ends, so the run's own movement does not clear the backoff. A run that frees the Body clears the backoff. Movement of 0.5 block or more by the Mind's own moves clears it too.
- **Hourly cap.** One Body starts at most 6 unstick runs in any hour of world time (72000 ticks). A run refused by the cap logs `capped at 6 runs an hour` and starts nothing. A respawn forgets the count.
- **dark_shelter refusals (B2).** The third dark shelter refusal ("no suitable block") in a row at one spot (within 2 blocks) runs `unstick` once through the same backoff. B2 has the same guards as B1 (no Mind action, not asleep, not riding, not in a burrow) and also needs the Body to be stuck: `canStepOff` must be false. A different spot or any other shelter outcome starts the count again.
- **Priority.** idle_stuck has the lowest priority of the reflexes (10), so panic_burrow, hazard_escape, fall_stop, retreat, fight_or_flee and eat always run first. It is also checked only when the runner has no other reflex to run that tick.
- **Log.** One line per run, in the `reflex_fired` outcome detail: the source, the result, the backoff, and the position. No prompt or contract change.

## What it does not do

- It does not run while the Mind's action runs and does not cancel it. The B2 path also waits for no action to be running.
- It does not run in a burrow the Body dug (at any hour), while asleep, or while riding.
- It does not coach the agent. The reflex reports facts only (0154).
- It does not change unstick's ownership rules (0164): the action still digs only blocks the Body does not own.
- It does not read the world beyond the Body's own cells and their neighbours (12 neighbour cells and 4 floor cells for `canStepOff`). An unloaded neighbour counts as possibly standable, so an unknown read never fires it.

## Limits (honest, from review)

- A ledge is any drop of 2 or more blocks on the open sides, so a ranger that stands on a pillar or platform by choice reads as stuck after 60 s with no action. `unstick` then walks it down any drop it allows, with no check for hostiles nearby. This is an owner call, not decided here.
- The Mind's plan can start while a 30 s unstick still runs. The executor waits at most 10 s for a busy reflex.
- Zack's case: unstick frees the Body only from a 2-3 block drop on an open side, by walking off it. With a drop of 4 or more on every open side at low health (under 12), `dropAllowed` refuses the walk. Then stair_dig digs a notch one block lower, the run counts as completed, and the reflex clears the backoff and considers the Body free. From the notch `canStepOff` can be true, so idle_stuck stops. The Body is one block lower, not out. "freed the body" in the log means only that the run completed.
- The upward dig (A) is still deferred and may be needed for Zack's exact cell.

## Deferred

- (A) The upward hand-dig rung: when the ledge is one block up with no open path, dig upward toward open air. Not built here; unstick digs sideways and down only, and a ledge with no sideways or downward way out still ends in "no way out" with the backoff.
