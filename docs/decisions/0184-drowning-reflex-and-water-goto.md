# 0184: The drowning reflex, the water exit and goto on water

- Status: Accepted (recorded with the PR #345 review fixes, 2026-11-14; no separate owner ruling)
- Date: 2026-11-14
- Amends: the hazard-escape reflex in `golem/src/body/reflexes/hazard-escape.ts`, the escape ladder in `golem/src/actions/escape-ladder.ts`, and the movement settings in `golem/src/actions/pathing.ts`.
- Keeps: decision 0164 (the tier 2 dig rules and the ownership rule) and decision 0183 (unstick's hand digs).

## Context

A Body in deep water, or on a shore, could drown, and a `goto` could end with its feet in water. Plain water was refused as an end cell, but seagrass, kelp and bubble columns were not, so a walk could still stop in them. The reflex and the ladder also had no rule for how long to swim before walking out, and no rule for a hop that left the Body in water. This record fixes those rules in the code as it stands.

## Decision

1. Quiet window. After the hazard-escape reflex gives up, it stays quiet for 40 ticks (`COOLDOWN_TICKS`). The window opens on the tick of the give-up, so the Mind's next action can run.
2. Swim share. Drowning always swims up first. The limit is `ESCAPE_LIMIT_TICKS` (200). With a safe block in reach the swim gets 120 ticks (`SWIM_TICKS`). With none it gets the whole limit, so a Body with no stand block in range keeps the full time to surface.
3. Ledge swim-out. When a solid block is over the head (an undercut bank), the swim steers to the nearest breathing column within 4 blocks (`BREATH_RADIUS`) and rises there. Without a ceiling it swims straight up with jump held.
4. Walk-to-land share. When a safe block is in reach, the walk to it gets the ticks the swim did not use. A give-up follows if the Body is still in the hazard when the limit ends.
5. Goto never ends on water. The end cell of a `moveNear` goal refuses a feet cell that is water, bubble column, seagrass, tall seagrass, kelp or kelp plant. When no dry cell is in range, the goto ends `blocked` or `timeout` after its search; it does not swim to the target. Waterlogged blocks are not detected (their water is not in the block name), and that is not covered here.
6. Escape-ladder hop. The `jump` and `sprint_jump` rungs count as working only when the Body moved and is out of the water. A hop that moved the Body but left it in water does not free it, and the next rung runs.
7. Tier 1 liquid cost. The tier 1 movements (the plain walk `goto` starts with) use `liquidCost` 3, so a path through water is taken only when no dry route is much longer. Tier 2 (decision 0164) is unchanged.
8. Not done. A pathfinder water-exit planner (a route out of the water planned and walked by the pathfinder) is not built. The swim-up in rule 3 and the walk in rule 4 stand in for it.

## Consequences

- A drowning Body with no safe block in reach keeps the whole 200 ticks to swim up; before this record it was given only the swim share, and the reflex gave up early.
- A `goto` ends short of the target when the target lies in water with no dry cell in range; the Mind sees `blocked` or `timeout`, not a swim.
- The quiet window is shared by the lava and fire hazards. It is 40 ticks for every hazard.
- Tests: `hazard-escape.test.ts` and `hazard-escape.movers.test.ts` (swim share, north steering, quiet window), `pathing.test.ts` (goal never ends on water or a water plant), `pathing-corners.test.ts` (liquidCost 3), `escape-ladder.test.ts` (hop rung).
