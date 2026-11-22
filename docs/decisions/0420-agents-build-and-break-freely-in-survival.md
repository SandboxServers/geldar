# 0420. Agents place and break any block, by survival rules, nothing protected

- Status: Accepted (owner ruling 2026-11-22, rulings 1, 2 and 4)
- Date: 2026-11-22
- Spec: section 2 principle 5 (emergent misbehavior is data), the `spawn-protection=0` line in section 6 ("agents may build anywhere"). Builds on 0164, 0165, 0349. Campaign: [building](../analysis/building/README.md).

## Decision

1. **Breaking has no ownership gate.** An agent may break any block it can reach by ordinary means: its own, another agent's, a natural block, a block of the town.
2. **Nothing is protected.** No zone, claim, owner list or block list stops an agent from placing or breaking. Only the world border limits where, and the game's own rules (bedrock, barrier and the other unbreakable blocks) limit what.
3. **Materials are survival.** The agent must hold the item. It gets items by mining, crafting and taking from chests, as a human does. No creative supply, no operator rights, no `/fill`, `/setblock` or any server command.
4. **One block at a time.** The Body places and breaks each block as a separate action with ordinary survival mechanics: reach, line of sight, tool choice, dig time, a standing position, scaffolding where a human could build it.
5. **Recording stays, enforcement does not exist.** CoreProtect and the block-owner subjects keep recording who changed what, for attribution and telemetry. Nothing reads them to refuse a place or a break. The Body's goto rule of 0164 (pathing never digs another's work) is a pathing rule and is unchanged.

## Why

The owner chose a world where building and griefing are both possible, which is what principle 5 and the spec's "agents may build anywhere" already allow. The cost of the old limit was an agent that cannot remove one block it placed (research, 2026-11-22: `mine` takes a name and digs the nearest).

## Consequences

- Code that the earlier design notes proposed (an ownership gate for plan breaks, protected zones, a plugin listener that cancels edits) is not built. The failure code `protected` does not exist.
- The spec's promise that Geldar-Core protects the Shrine, Moot Stone and example Cradle (section 6, spawn-protection line) was never implemented on main and is now ruled out: see [0422](0422-building-accepted-risks.md), which carries the flag for the owner to edit the spec.
- Principle 1 is untouched on the autonomous shard: every edit is made by an agent's Body.
