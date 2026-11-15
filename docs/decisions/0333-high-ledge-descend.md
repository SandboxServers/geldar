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

## Not yet done (this branch)

- The `dig_descend` rung (dig the floor block, fall one block, re-check before every dig, stop at a drop of three or less, one operator log line per descend step and per refusal reason: lava, water, void, unloaded, ownership, hostile, with facts-only agent text) is designed (0183, 0196, 0164 apply) but not implemented in this change. Until it lands, a `high_ledge` run has no rung that digs down, so the 12-run cap alone does not free a Body.

## Consequences

- A `high_ledge` Body is run up to 12 times an hour, not 6. The cap is the only bound on digging in the rung's absence; the rung itself must check every dig.
- Ownership, liquid and falling-block checks for the rung are the 0164, 0183 and 0196 rules: they are not relaxed by this decision.
