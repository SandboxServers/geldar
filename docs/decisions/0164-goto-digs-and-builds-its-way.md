# 0164. goto digs and builds its own way, and never digs through someone else's work

- Status: Accepted
- Date: 2026-11-13
- Supersedes: 0141 (soft-dig pathing only), and the P0-07c rule in `docs/analysis/phase0/work-packets.md` that `goto` never digs and never builds towers (`canDig=false`, `allow1by1towers=false`, no scaffolding)
- Packet: body-goto-dig (phase 1)

## Owner rulings (2026-11-13)

- "Pathfinding shouldn't be this hard and needs to be native functionality of the harness."
- "goto may dig and pillar/scaffold."
- "Should never dig through someone else's work. Natural placed blocks can be broken. This needs to cover all player constructs not just shelters."
- `mine` stays free. The rule above applies only to the digging `goto` does on its own.
- Village structures are world-generated; their built materials stay protected by type.
- The ownership record comes later from the plugin, not in this decision.

## Context

The pit saga: a body that stands in a pit with stone around it cannot walk out. With `canDig=false` and no towers, the library finds no path, `goto` reports `blocked`, and the Mind is woken with "the way was blocked". Soft-dig (0141) covered leaves and plant cover only. The Mindcraft comparison (scratchpad, sections 3 and 7) showed that its `goToGoal` tries a plain walk first and then a walk that digs and towers. Both of its tiers can dig, which we will not copy: it has no protection of other players' work.

## Decision

`goto` walks in two tiers.

1. Tier 1 is today's walk: soft digs only (0141), no towers, doors as before, corner rules, the stall watchdog, the replan limit and the escape ladder.
2. Tier 2 starts when tier 1 finds no path (`NoPath`) or a walk stalls for the first recovery. It uses library Movements with:
   - `canDig=true`, `digCost=4`;
   - `allow1by1towers=true`, scaffolding `dirt`, `cobblestone`, `cobbled_deepslate`, `netherrack` (the library uses only the held ones);
   - `placeCost=2`, `maxDropDown=3`, `liquidCost=3`;
   - parkour and sprinting at the library default; `dontCreateFlow` and `dontMineUnderFallingBlock` on.

The escape ladder stays as the last fallback. The door handling, the hitbox and feet-cell fixes and the search budget are unchanged.

When a tier-2 walk completes, its result says in plain words what it dug and placed, for example "dug through two blocks and placed one dirt block to climb". Scaffold is placed from the ranger's own throwaway blocks and the text names the type.

## Safety rules (never dig)

Digging by tier 2 is refused for a block when any of these holds:

- Its name is a block entity or a utility block: chests and other storage, furnaces, hoppers, droppers, dispensers, signs, banners, beds, shulker boxes, lecterns, spawners, campfires, decorated pots, crafting and enchanting tables, anvils, ladders, torches, rails, glass and glass panes, doors, trapdoors and fence gates, obsidian, bedrock and command blocks.
- It is protected (below).
- Liquid touches it on any face.
- A block that falls (sand, gravel, concrete powder, anvil) sits in one of the three cells above it, or an entity does.
- The dig takes more than 3 s with the best held tool.
- It is the floor under the bot and the drop below would be more than three blocks, or liquid lies in the way.

A block whose dig time the bot cannot read is not refused for that reason alone (test fakes have no timer).

## Protection rules (`golem/src/actions/protected-blocks.ts`)

- Built materials by type are protected whoever placed them: planks, slabs, stairs, walls, fences, doors, carpets, wool, concrete and concrete powder, terracotta (plain terracotta generates in badlands and is natural, so only dyed and glazed terracotta is built), stained glass, beds, banners, candles, shulker boxes, bricks, tiles, wood and stripped wood, signs, lanterns, cobblestone and mossy cobblestone, cobbled deepslate, glass, bookshelves, quartz blocks, hay bales, and the polished, smooth, cut, chiseled and waxed variants. Natural logs and leaves are not built.
- A natural block on any face of a built block is protected. This covers a dirt floor under a planked room, and a stone block in a cobblestone wall.
- Owned blocks: the ownership record is pluggable (`setOwnerLookup`). It is read only when `OWNERSHIP_RULE` is true, which it is not in this decision. The record's subject will be `geldar.<shard>.blockowner.query` and `geldar.<shard>.blockowner.changed`, from the plugin in a later packet.
- "Part of an enclosed space" is not checked yet. No cheap local check was found; it is a TODO in `isProtected`.

## Consequences

- A body can leave a pit, climb a canopy and cross a stone wall, where before it reported `blocked`.
- Natural placed blocks that are not on a built block and not owned can still be dug. A natural cobblestone or dirt pile built by a player is protected only when it touches a built block (see above). Until the ownership record exists, a player's natural-material work (a dirt mound, a stone path) can be dug by a `goto` in tier 2. This risk stays until the record is in.
- Tier 2 digs more often in the world. The bench must show it before and after: the pit cases, the blocked-path recovery cases, and a shelter case where the protection must hold. The bench run is required before this decision is accepted for release; this packet only adds the code and its tests.
- The library's `safeToBreak` is replaced in tier 2 by `digAllowed`. It keeps the library's liquid, falling-block and entity checks and adds the block-entity, protection, dig-time and drop rules.
- Result text carries counts as words (no digits). The count of placed blocks comes from wrapping `bot.placeBlock` while the walk runs; it is restored when the walk ends.
- `mine` is unchanged. `place` is unchanged.
