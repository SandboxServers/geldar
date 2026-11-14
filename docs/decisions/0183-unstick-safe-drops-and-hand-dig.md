# 0183: unstick takes safe drops at any health, and hand-digs any breakable block

- Status: Accepted (owner ruling, 2026-11-14)
- Date: 2026-11-14
- Amends: the drop rule in `golem/src/actions/unstick.ts` (`dropAllowed`, which refused every drop below 12 health, spec C1-12), and the dig rule of the unstick dig strategies (`digsCell`, which dug only soft blocks by hand, and the last-resort pass, which refused natural stone).
- Keeps: decision 0164 (ownership) and decision 0165 (the ownership record). The ownership clause is unchanged: never dig another player's block; the bot's own placements and natural blocks are fine.

## Context

Zack (ag_zack_01) stood at (-266, 35, 196) on natural stone for hours, at health 6.8 with no pickaxe. West and south were rock; north and east were open air over a drop. Every unstick strategy failed in 0 to 9 ms: the walk refused a three-block drop because of the 12-health floor, and the dig strategies refused stone because only soft blocks could be dug by hand. Kimberly's unstick in open water failed in 1 ms for the same health floor.

Owner ruling, 2026-11-14, verbatim: "Allow drops that never hurt at any health and you should be able to hand dig any block, especially hand dig any blocks that drops its block afterwards."

## Decision

Owner ruling, 2026-11-14. The rules unstick applies:

1. Drops. A fall that cannot hurt is taken at any health: a fall of three blocks or fewer (vanilla: no fall damage at a fall distance of three or less) onto a solid landing, and a fall into water. The fall is measured from the feet down to the landing: `scanDrop` counts the empty cells the fall passes. A water landing is refused when lava or magma lies under the water. Lava, magma, fire, a cactus, a void or an unloaded column at the landing are always refused. A fall deeper than three blocks that does damage keeps the health rule (`MIN_HEALTH_TO_DROP` and the health margin) and `MAX_DROP`.
2. Hand-dig. The unstick dig strategies (dig down, stair dig, dig sideways and the last-resort pass) may dig any block a hand can break: any block whose hardness is zero or more and that is not `diggable: false`. Bedrock, barrier and other unbreakable blocks (hardness -1 or unknown) are never dug. A block that needs a tool to drop is dug by hand anyway, and drops nothing.
3. Order. When a strategy has a choice of direction, the directions whose cells a hand drops by hand (no harvest tool listed: dirt, logs, planks) come before those that need a tool (stone).
4. Unchanged safety rules. No digging a cell with a liquid or lava on a face, or with a falling block (sand, gravel, concrete powder) above it. No digging of refused names (block entities, doors, beds, chests, crafting tables). No digging that would drop the bot more than the drop rule allows. Ownership as in 0164: a protected block is dug only when the ownership record says it is unowned, and never when it belongs to another player.
5. Diagnostics. The `no_way_out` line also records the health and the drop depth (blocks and landing) in each of the eight directions. The agent text is unchanged.

The time limit is the action's own 20 s, which covers one hand-dug stone block (about 7.5 s). `goto`'s three-second dig cap (`MAX_DIG_TICKS`, `goto-dig.ts`) is not used by unstick and is unchanged.

## Consequences

- A Body at low health whose only way out is a three-block drop takes it.
- A Body boxed in by stone digs its way out with bare hands (it drops nothing) rather than stand.
- Tests superseded: in `golem/src/actions/unstick.test.ts`, "never drops at low health, however short the fall" now asserts a four-block drop at low health is refused and a water landing at health 4 is taken; "walks off a survivable ledge only with the health for it" now uses a four-block ledge; "does not dig down at low health, over lava, or through hard blocks" now asserts that bedrock, not stone, is never dug.
