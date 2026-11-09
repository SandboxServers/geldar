# 0039. The Body's pathing forbids diagonal moves that cut a block corner

- Status: Accepted (found by the body benchmark; made autonomously overnight)
- Date: 2026-11-09
- Spec: section 5.2 (Body API, reflexes: path blocked more than 30 s); decision 0022 (stop-and-report rule); packets P0-07c (`moveNear`), P0-10c (`bed` scenario)

## Decision

`moveNear` (golem/src/actions/pathing.ts) wraps the pathfinder's `getMoveDiagonal` so that a diagonal step is dropped unless both orthogonal side cells are free at foot level and (at head level) not an overhanging solid block. A side cell blocks the diagonal when it is not safe (fence, wall, fire, lava, unloaded) or is physical and not a carpet. The 30-second stall rule is unchanged.

## Why

The `bed` benchmark scenario found it: with the crafting table two blocks from the bed, Mineflayer's pathfinder planned a diagonal step that cut the table's corner (the library accepts a diagonal when one side cell is free). The bot walked flush against the table and Paper rejected the pose on every tick (SRVPOS teleports back), so the bot jittered in place until the stall watchdog fired after 600 ticks and `sleep` failed with `blocked`. This reproduced in 3 of 3 runs. With the corner-cutting diagonal removed the path is two orthogonal steps, `bed` passed 3 of 3 runs, and a full live lane of 58 tests passed. A first attempt moved the bed in the scenario; that hid the weakness and was reverted (the moved layout survives as the hidden control scenario `bed-clear`).

## Consequences

- Paths around built structures can be slightly longer.
- The benchmark did what it is for: it exposed a Body weakness before the model layer relied on the Body.
- The rule is foot-level and head-level only; an orthogonal turn around a corner can still clip it slightly (the pathfinder's arrival tolerance is 0.35).
