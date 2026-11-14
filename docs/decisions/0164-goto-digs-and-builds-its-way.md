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
2. Tier 2 starts when tier 1 finds no path (`NoPath`), when tier 1 resolves without reaching the goal (the library resolves an empty route, as in a sealed pit, as success without moving), when tier 1's search ends in a fruitless `Timeout` with no partial walk behind it (a sealed area exhausts the 4 s budget without a `NoPath`; the bench's sealed `blocked-path` run timed out this way at about 4.5 s), or when a walk stalls for the first recovery. A tier 2 that a stall started is left as soon as the bot is 3 blocks from the spot it stalled at: the rest of the walk plans on tier 1 again. A tier 2 that `NoPath` started stays for the walk (it has no walking route at all). A tier 2 that a fruitless `Timeout` started is also kept for the walk. It uses library Movements with:
   - `canDig=true`, `digCost=4`;
   - `allow1by1towers=true`, scaffolding `dirt`, `cobblestone`, `cobbled_deepslate`, `netherrack` (the library uses only the held ones);
   - `placeCost=2`, `maxDropDown=3`, `liquidCost=3`;
   - parkour and sprinting at the library default; `dontCreateFlow` and `dontMineUnderFallingBlock` on.
   - A search budget of 1.5 s (`TIER_TWO_BUDGET_MS`), not the tier-1 4 s, so an unreachable goal costs little.
3. If tier 2 finds no path or runs out of its search, tier 1's movements come back and the plain walk's partial route stands (0142). The reason is `blocked` with the fixed text whenever tier 2 fails, including after a tier-1 fruitless `Timeout`: both tiers searched and found no way, so `blocked` is the true fact, and the bench's sealed `blocked-path` verdict counts `blocked` as a pass. The escape ladder then runs as it does after a tier-2 `NoPath`. A plain tier-1 `Timeout` with no tier 2 (reflex walks, `digTier: false`) keeps `timeout`. A tier-1 `Timeout` after a partial walk does not start tier 2 (the partial walk is the progress). The walk's total search time is at most 4 s + 1.5 s, well inside the bench's 150 s blocked-path budget, so the tier-1 budget is unchanged.
4. A tier-1 walk that is started again (the next `moveNear`) begins on tier 1 movements, so a tier-2 walk never leaks into the next one. `planReach` plans with the tier-1 movements unless it is asked for digging.

The escape ladder stays as the last fallback: it also runs when tier 2 finds no path (a blocked walk in water, or stalled 60 ticks or more, runs the ladder as before). The door handling, the hitbox and feet-cell fixes and the search budget are unchanged.

When a tier-2 walk completes, its result says in plain words what it dug and placed, for example "dug through two blocks and placed one dirt block to climb". Scaffold is placed from the ranger's own throwaway blocks and the text names each type ("placed two dirt blocks and one cobblestone block"). Digs and placements are counted by wrapping `bot.dig` and `bot.placeBlock` while the walk runs, because the library clears `diggingCompleted` listeners itself.

## Safety rules (never dig)

Digging by tier 2 is refused for a block when any of these holds:

- Its name is a block entity or a utility block: chests and other storage, furnaces, hoppers, droppers, dispensers, signs, banners, beds, shulker boxes, lecterns, spawners, campfires, decorated pots, crafting and enchanting tables, anvils, ladders, torches, rails, glass and glass panes, doors, trapdoors and fence gates, obsidian, bedrock and command blocks, end portal frames, barriers, structure blocks, jigsaws and reinforced deepslate. Player redstone (levers, buttons, pressure plates, redstone dust, repeaters, comparators, sculk sensors), lights, slime and honey blocks and the decor on the by-type list are built material and are never dug by goto.
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
- Blocks another player placed, per the ownership record (decision 0165, CoreProtect). The record is pluggable (`setOwnerLookup`). Its subjects are `geldar.<shard>.blockowner.query` and `geldar.<shard>.blockowner.changed`, served by the CoreProtect bridge. CoreProtect records exist from 2026-11-13 16:30Z; work placed before that has no record.
- The ownership switch is ON (`OWNERSHIP_RULE = true`, 2026-11-13), set once the plugin owner reported live lookup timings and correct answers. A `truncated: true` reply, a failed query or a missing reply means unknown, and unknown is protected. The Body's client (`golem/src/body/block-owners.ts`) asks per 16 x 16 chunk over its own NATS connection, with a 300 ms request timeout, a 256-chunk LRU and a 10 min refresh; a tier-2 walk waits at most 300 ms for the 3 x 3 chunks around the bot and the goal before it plans. Verification (2026-11-13, the plugin owner's probes): 0 missing, 0 wrong and 0 extra owners on the probed chunks; cold lookups 0.7 to 11 ms, cached 0.2 to 0.6 ms. CoreProtect records exist from 2026-11-13 16:30Z.
- The ownership query names the Bukkit world, not the mineflayer dimension: `overworld` is `world`, `the_nether` is `world_nether`, `the_end` is `world_the_end` (the namespace is stripped first). A dimension with no Bukkit world sends no query, so its blocks are unknown and protected. Every ranger host (Adam's Body and the player hosts) runs the ownership client on its own NATS connection. A change that arrives while a chunk's query is in flight is applied on top of its reply.
- "Part of an enclosed space" is dropped by owner decision (2026-11-13). It cannot tell another ranger's shelter from a natural sealed cave, so it would re-trap rangers underground.
- `mine` is unchanged: a deliberate mine action may break any block it could before (owner ruling 2026-11-13); only the Body's automatic digging (goto tier 2, escape ladder, stairs, pillar, unstick, dig reflexes) follows the protection rules.

## Consequences

- Every tier-2 walk ends on tier 1: success, cancel, failure or a throw puts the plain movements and the 4 s search budget back, so a later plain walk is never planned with the 1.5 s tier-2 budget (review 2, N1).
- The panic-burrow reflex digs (`dig-cell`) go through the same protection as goto: a player's cobblestone or any other protected block is refused, and the reflex returns ok:false with the protection reason (review 2, N8).
- The own-placement record holds at most 4096 cells per bot (the oldest is dropped) and clears on respawn or dimension change. A chunk unload does not clear it, so a cell a player changed while the chunk was unloaded can read as the bot's own until the next block update there (review 2, N6, accepted).

- A body can leave a pit, climb a canopy and cross a stone wall, where before it reported `blocked`. A pit whose walls are all stone is now left by tier 2 even when the library resolves the empty route.
- Remaining risk: natural-material work placed by others before CoreProtect started recording (2026-11-13 16:30Z), that does not touch built material, can be dug by goto's automatic digging (a dirt mound, a stone path). Such work is protected only when it touches a built block, or when the ownership switch is on and the record holds it. This risk stays until the switch is enabled and that old work is gone or recorded.
- A stall of 3 s in tier 1 also starts tier 2, so a body inside a building whose walls are natural material (dirt, stone) that touches no built block can dig out after a plain stall, until the ownership record exists.
- The escape ladder is covered by the protection rules (decided 2026-11-13, orchestrator, consistent with the owner's ruling). Its digs (the stairs, the pillar's headroom and side cells, the dig rung) refuse any block that `isProtected` refuses, through `protectedReason`, with the own-work exception below. The ladder never digs someone else's work on the way out. `unstick` is covered too: every dig in it (the dig-down, the stair steps, the sideways digs) goes through `protectedReason` first, so it refuses what the ladder refuses. A block this Body placed itself (`own-placements.ts`) is its own work and is not an adjacency source: dirt beside the bot's own cobblestone stays diggable, while dirt beside someone else's built block stays protected.
- Own work is not protected (decided 2026-11-13). A block the Body placed itself is its own work whatever its type, so `goto` and the ladder may dig it (a ranger's own cobblestone or dirt tower). The record is in memory per bot (`own-placements.ts`): each place action (`placeAgainst`), each tier-2 scaffold block, and nothing else. A record ends when the block at its cell changes to another block (`blockUpdate`). The build program has no placement path in golem yet, so none is recorded. The ownership record from the plugin will later say `owner == self` for the same cells; this decision does not change that.
- Tier 2 digs more often in the world. The bench must show it before and after: the pit cases, the blocked-path recovery cases, and a shelter case where the protection must hold. The bench run is required before this decision is accepted for release; this packet only adds the code and its tests.
- The library's `safeToBreak` is replaced in tier 2 by `digAllowed`. It keeps the library's liquid, falling-block and entity checks and adds the block-entity, protection, blocks-cant-break, health, dig-time and drop rules. The library's `exclusionBreak` is not read.
- Result text carries counts as words (no digits). `mine`, `place` (except the approach walk) and the reflexes are unchanged in their tier-1 behaviour.

## 2026-11-13 owner ruling: escape through unowned built blocks

Owner ruling: a trapped ranger may escape through a built block that has no ownership record, but only as a last resort.

- Scope: only `unstick` may do this, and only in its last-resort pass, which runs after walk, dig_down, stair_dig and dig_sideways have all failed. `goto` is unchanged: `goto` and `goto-dig` never reach the relaxed rule, because the rule is passed as an explicit `relaxed` option from unstick only.
- Rule: a block protected only by type or only by touching built material (this decision, above) may be dug in that pass if its ownership is KNOWN to be unowned. Known means a complete owner answer (`truncated: false`) with no owner for that block. A truncated, failed or timed-out answer counts as unknown, and unknown stays protected.
- Owned by another player: never dug. Owned by the bot itself: diggable, as before.
- Still refused in that pass: block entities, doors, beds, chests, crafting tables and the other refused names; unbreakable blocks; a block with a liquid beside it; a block with sand, gravel or concrete powder above it; and the drop rule of the escape ladder (`dropAllowed`, `digDownAllowed`).
- Before the pass, ownership is prefetched around the bot (feet, head and the eight neighbours), within the 300 ms wait of the block-owners client.
- Every block the pass breaks is logged as an `unstick_breach` line with the block name and position. Success keeps the completed outcome with method `dig_unowned`, and `dig_unowned` is added to the tried list (in the failure text too).
- Why: CoreProtect has recorded only since 2026-11-13 16:30Z. Village blocks and player builds from before then have no record, so both can be breached by unstick's last-resort pass only, which lets a trapped ranger breach a village wall to get free. `goto` never breaks them.