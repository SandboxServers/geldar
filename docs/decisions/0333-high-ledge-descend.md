# 0333: A Body on a high ledge with no safe exit is stuck, and unstick may dig down through natural blocks

- Status: Decided (owner-side rulings via geldar-93)
- Date: 2026-11-15
- Cites: 0183 (the safe-drop rule: three blocks or fewer onto solid ground or into water, at any health), 0196 (idle_stuck B1 and B2, the backoff and the hourly cap), 0164 (ownership: never dig another player's recorded block), 0330 (the 120 s own-placement clock), 0332 (pillar top as stuck, the `no_path` rule)
- Why: the GreenRanger case (diagnosis of 2026-11-15) stood on a stone ledge about ten blocks above the ground. Its unstick order had no rung that digs down out of a plateau: `dig_down` refuses a plateau top, `stair_dig` needs a solid neighbour column, and the walk refuses a drop of ten. idle_stuck did not fire either, because `canStepOff` answers "a neighbour cell can take a step", not "a safe move exists". The Body stood still and the rules called it free.

## Rulings

Two rulings from the owner, relayed by geldar-93:

1. Dig down by hand through natural blocks as an unstick rung. Never through another player's builds (the 0164 ownership check runs before every dig), never into lava, water, void or unloaded chunks, never undercutting a block next to lava, and stop as soon as a drop of three blocks or less exists.
2. The hourly cap is waived for `high_ledge` runs up to 12 per hour. Every other unstick reason keeps 6 per hour.

## What this decision adds

1. A view signal `noSafeExit`: true when the unstick planner finds no move from the Body's feet (decision 0183's rule), null when a cell it reads is not loaded or health is unknown. An unread cell is never a dead end.
2. An idle_stuck reason `high_ledge`: not enclosed, `noSafeExit` true, not in water. It runs on the 120 s own-placement clock (decision 0330) whatever the block under the feet is, and goes through the shared backoff. A Body in the open with a safe move available does not fire it.
3. The `high_ledge` run is freed only when `noSafeExit` is false as well as `canStepOff` true, so a run that dug one block lower from a deep drop is not called free.
4. The hourly cap for a `high_ledge` run is 12 (`HIGH_LEDGE_RUNS_PER_HOUR`). The refusal line says `capped at N runs an hour (cap reached)`. Other reasons keep 6.

## The `dig_descend` rung (implemented)

- The rung is the last unstick rung. It runs only after every other rung failed, for a `high_ledge` run or a Body with no safe move. Each step digs the block under the feet (with the 0164 ownership check) and the Body falls through the dug cell.
- The landing rule, checked before every dig from the Body's current feet: the fall is the depth of the first block that is not air below the dug floor (1 when the block directly under the floor is solid). The dig goes ahead only when that landing is within 3 blocks (a fall of 3 or less), is solid, is not on the unsafe list (lava, water, magma block, cactus, fire, soul fire, sweet berry bush, campfire, soul campfire, powder snow, cobweb, slime, honey, hay), and the fall leaves the health margin of 2. A landing deeper than 3 blocks, or no landing within 3, is refused.
- The column is also checked: lava or water beside the feet or beside any cell of the fall, a void, and an unloaded cell.
- Refusals, each logged once by reason on the operator log and reported to the agent as facts: `lava`, `water`, `void`, `unloaded`, `ownership`, `hostile` (a hostile mob within 8 blocks), `gravel` (gravel or sand above the head), `undiggable`, `fall`, `landing`, `cap reached` (12 digs in one call). Each dig step and each refusal is one operator log line.
- The rung stops as soon as a walk of 3 blocks or less is open, at the time budget, when a dig does not complete, or when the Body did not fall.
- The rung is covered by `golem/src/actions/unstick-descend.test.ts` and `unstick-descend-wiring.test.ts`.

## Consequences

- A `high_ledge` Body is run up to 12 times an hour, not 6. Each call is bounded by the rung's own 12-dig cap and the time budget; the rung checks every dig before it is made, and a fall that would land on an unsafe block or more than 3 blocks down is refused.
- Ownership, liquid and falling-block checks for the rung are the 0164, 0183 and 0196 rules: they are not relaxed by this decision.
