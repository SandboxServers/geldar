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
- Scope (orchestrator, consistent with the rulings): tier 2 applies to `goto`, `travel` and the approach walks of `place`, `mine`, `give`, `craft`, `smelt`, `deposit`, `withdraw`, `open` and `sleep`. It does not apply to a flee, a fight-or-flee sidestep or flee, an attack approach, a retreat or a hazard escape (a panic-burrow reflex): those walks pass `digTier: false` to `moveNear`.

## Context

The pit saga: a body that stands in a pit with stone around it cannot walk out. With `canDig=false` and no towers, the library finds no path, `goto` reports `blocked`, and the Mind is woken with "the way was blocked". Soft-dig (0141) covered leaves and plant cover only. The Mindcraft comparison (scratchpad, sections 3 and 7) showed that its `goToGoal` tries a plain walk first and then a walk that digs and towers. Both of its tiers can dig, which we will not copy: it has no protection of other players' work.

## Decision

`moveNear` walks in two tiers.

1. Tier 1 is today's walk: soft digs only (0141), no towers, doors as before, corner rules, the stall watchdog, the replan limit and the escape ladder.
2. Tier 2 starts when tier 1 finds no path (`NoPath`), when tier 1 resolves without reaching the goal (the library resolves an empty route, as in a sealed pit, as success without moving), or when a walk stalls for the first recovery. It uses library Movements with:
   - `canDig=true`, `digCost=4`;
   - `allow1by1towers=true`, scaffolding `dirt`, `cobblestone`, `cobbled_deepslate`, `netherrack` (the library uses only the held ones);
   - `placeCost=2`, `maxDropDown=3`, `liquidCost=3`;
   - parkour and sprinting at the library default; `dontCreateFlow` and `dontMineUnderFallingBlock` on.
   - A search budget of 1.5 s (`TIER_TWO_BUDGET_MS`), not the tier-1 4 s, so an unreachable goal costs little.
3. If tier 2 finds no path or runs out of its search, tier 1's movements come back and the plain walk's partial route stands (0142). The reason stays `blocked` with the fixed text, never `timeout`.
4. A tier-1 walk that is started again (the next `moveNear`) begins on tier 1 movements, so a tier-2 walk never leaks into the next one. `planReach` plans with the tier-1 movements unless it is asked for digging.

The escape ladder stays as the last fallback. The door handling, the hitbox and feet-cell fixes and the search budget are unchanged.

When a tier-2 walk completes, its result says in plain words what it dug and placed, for example "dug through two blocks and placed one dirt block to climb". Scaffold is placed from the ranger's own throwaway blocks and the text names each type ("placed two dirt blocks and one cobblestone block"). Digs and placements are counted by wrapping `bot.dig` and `bot.placeBlock` while the walk runs, because the library clears `diggingCompleted` listeners itself.

## Safety rules (never dig)

Digging by tier 2 is refused for a block when any of these holds:

- Its name is a block entity or a utility block: chests and other storage, furnaces, hoppers, droppers, dispensers, signs, banners, beds, shulker boxes, lecterns, spawners, campfires, decorated pots, crafting and enchanting tables, anvils, ladders, torches, rails, glass and glass panes, doors, trapdoors and fence gates, obsidian, bedrock and command blocks.
- It is protected (below).
- The library never breaks it (`blocksCantBreak`).
- Liquid touches it on any face.
- A block that falls (sand, red sand, gravel, suspicious sand and gravel, anvils, dragon egg, pointed dripstone, concrete powder) sits in one of the three cells above it, or an entity does.
- The dig takes more than 3 s with the best tool the bot carries (the library's own choice, not the held one).
- The bot's health is under `MIN_DIG_HEALTH` (8, as in tier 1).
- It is the floor under the bot and the drop below would be more than three blocks (a solid block three cells down is allowed; four is refused), or liquid lies in the way.

A block whose dig time the bot cannot read is not refused for that reason alone (test fakes have no timer).

## Protection rules (`golem/src/actions/protected-blocks.ts`)

- Built materials by type are protected whoever placed them: planks, slabs, stairs, walls, fences, doors, carpets, wool, concrete and concrete powder, glazed terracotta, stained glass, beds, banners, candles, shulker boxes, bricks, tiles, wood and stripped wood, signs, lanterns, cobblestone and mossy cobblestone, cobbled deepslate, glass, bookshelves, quartz blocks, hay bales, and the polished, smooth, cut, chiseled and waxed variants. Metal and gem storage blocks (iron, gold, diamond, emerald, lapis, redstone, coal, netherite, copper blocks), and the crafted workstations, mechanisms and fixtures (smithing, loom, grindstone, stonecutter, cartography and fletching tables, composter, cauldron, bell, lodestone, beacon, pistons, observer, note block, redstone lamp, TNT, iron bars, sea lantern, purpur and bone blocks, infested cobblestone) are built too. Natural logs and leaves are not built.
- Natural material is not built by type: plain and dyed terracotta (badlands bands) and `smooth_basalt` (amethyst geodes) are natural. A natural block on a face of a built block is protected only through that face (see the next rule).
- A natural block on any face of a built block is protected. This covers a dirt floor under a planked room, and a stone block in a cobblestone wall.
- Owned blocks: the ownership record is pluggable (`setOwnerLookup`). It is read only when `OWNERSHIP_RULE` is true, which it is not in this decision. The record's subject will be `geldar.<shard>.blockowner.query` and `geldar.<shard>.blockowner.changed`, from the plugin in a later packet.
- "Part of an enclosed space" is not checked yet. No cheap local check was found; it is a TODO in `isProtected`.

## Consequences

- A body can leave a pit, climb a canopy and cross a stone wall, where before it reported `blocked`. A pit whose walls are all stone is now left by tier 2 even when the library resolves the empty route.
- Natural placed blocks that are not on a built block and not owned can still be dug. A natural cobblestone or dirt pile built by a player is protected only when it touches a built block (see above). Until the ownership record exists, a player's natural-material work (a dirt mound, a stone path) can be dug by a `goto` in tier 2. This risk stays until the record is in.
- A stall of 3 s in tier 1 also starts tier 2, so a body inside a building whose walls are natural material (dirt, stone) that touches no built block can dig out after a plain stall, until the ownership record exists.
- The ladder is not covered by the protection rules yet: `escape-stairs.ts` and `pillar.ts` keep their own lists and can dig a protected wall when the body is in a pit. This is an owner decision still open; it is not changed by this decision.
- The scaffold the walk places is built material by type where it is cobblestone or cobbled deepslate, so a tower the ranger built is protected from its own later walks. Dirt and netherrack towers are not. This inconsistency is open (the walk's own placements are not yet recorded).
- Tier 2 digs more often in the world. The bench must show it before and after: the pit cases, the blocked-path recovery cases, and a shelter case where the protection must hold. The bench run is required before this decision is accepted for release; this packet only adds the code and its tests.
- The library's `safeToBreak` is replaced in tier 2 by `digAllowed`. It keeps the library's liquid, falling-block and entity checks and adds the block-entity, protection, blocks-cant-break, health, dig-time and drop rules. The library's `exclusionBreak` is not read.
- Result text carries counts as words (no digits). `mine`, `place` (except the approach walk) and the reflexes are unchanged in their tier-1 behaviour.
