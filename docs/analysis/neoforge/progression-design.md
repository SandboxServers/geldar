# Agent-native progression: a server-side NeoForge mod

Date 2026-11-16. Author: packet-coder (NeoForge campaign, branch phase1/nf-progression-docs). Status: proposed, for owner decision. Design only. No code, node, VM or world changed. No decision numbers are used; the main orchestrator assigns them.

Every number in this note is PLACEHOLDER (to be tuned from simulation and bench runs) unless the text says "derived" and shows the derivation.

## 1. Purpose, scope and the first question

The owner brief: an agent-native progression system for the NeoForge scratch shard. Experience comes from novelty and usefulness, not grinding. Levels unlock capability (claim size, waypoints, contract posting, workshop recipes, storage), never health, damage or speed. Professions, contracts and reputation exist. Anti-grind decay is built in. Agents learn all of it from MCP tool text only: no chat, no HUD, no client mod.

Constraints that shape the design:
- Server-side only. Vanilla-protocol golem Bodies (mineflayer) join; they have no mod and cannot receive custom payloads. So: no new registry entries (no blocks, items, entity types, custom criterion triggers, menu types), no custom packets, no client assets. State lives in saved data. Unlocks use data-driven advancements and recipe gating.
- It sits beside the P3 NeoForge adapter (NATS export) and the P4 block-owner log in the campaign RESUME (this is packets P6 to P8 there).

**First open question, before any code.** Spec principle 2 says "No quests ... no scoring". A points-and-levels system is scoring by another name. Mitigations in this design: nothing is a goal; no text says to pursue points; capability unlocks only; the whole system sits behind a shard flag `progression.enabled` (default off, a per-shard research variable per principle 3). The owner must still rule whether this is a documented, toggleable constraint or out of scope. Also: the contract `proficiency-state` (seven domains, levels 0 to 3, decision 0280) already exists for the held-back sheet feature; question 3 in section 13 asks how the two relate.

## 2. Principles and rules it must obey

1. **Facts and mechanics only (0058).** The mod's agent-visible text states what is true and how a mechanism works, in the voice of the world, like the existing fixed regeneration sentence in the snapshot. It does not recommend, rank or sequence actions. The character knows only what it saw, tried or was told in the world (0058.1); a mechanic stated as a plain rule is world physics, the same kind of text as "Light at the head: dim from 4 to 11".
2. **Never coached, never told it is watched (0059, 0068).** No text says or implies an audience, a test, a score kept by someone, a harness or a shard. The marker scan `MARKER_WORD` (observer, watch, human, maker, stream, credit, colo, shard, harness; `contract/src/agent-text.ts`) applies to every string the progression provider emits. This forbids the word "credit": the reward unit is "marks" and progress is "points".
3. **Text must not say when to do things.** No "you should", "try", "now", "soon", "hurry". Deadlines are a fact about a contract ("Due day 44"), never urgency. No "recommended", "best", "next goal". "Next unlock needs 140 more points" is a measured gap, not an instruction.
4. **Telemetry never reaches an agent.** The audit metrics (section 10), flags, per-pair reciprocity ratios and cohort percentiles go to subjects the MCP service account cannot read, and no provider method returns them. A test scans the provider output and the MCP service ACL.
5. **Principle 1 in code.** No command, tool or advancement path lets a human award points, mint marks, post or settle a contract, move items or change a level. The admin surface (section 9) is read-only plus one kill switch that stops awards for everyone. Humans and spectators are never tracked: only UUIDs that resolve to a registered life (the `isAgent` predicate, decision 0139) have a record; any other player earns nothing.
6. **Recipes stay discovered (0048).** The level gate adds a hold to a recipe; it never grants a recipe the ingredients would not unlock. A held recipe fails as today: `not_possible` with `detail.unlocked: false`.
7. **Ceilings are visible facts** (spec 5.7). The daily limit, claim sizes and the level table are published, not hidden.
8. **No combat power.** The mod never touches health, damage, armour, speed, attributes, enchantments or mob behaviour. Combat recipes are neither held nor granted.
9. **The XP function is replayable.** It is a pure function of a recorded action log and the world day. It reads no clock and no random source.

## 3. XP model

Unit: a point (stored as integer milli-points). Time unit: the game day, 24000 ticks (as `EventEnvelope.world_day`). Decay is applied lazily from the stored day.

### 3.1 Action events and keys

The hook layer (packet 3) turns a world event into `ActionEvent {agent, class, target, region, tick}`.

- `class` is a closed set: `gather`, `mine`, `farm`, `tend`, `fish`, `smelt`, `cook`, `craft`, `place_kept`, `deliver`, `explore`, `write`, `trade_out`.
- `target` is a block id, entity type, item id or recipe id without namespace.
- `region` is the 64 by 64 block cell `(floor(x/64), floor(z/64))` of the agent. `explore` and `deliver` use the destination cell.
- The action key is `k = (class, target, region)`, per agent.

### 3.2 Novelty

Each agent keeps, per key, an occurrence count `n_k` that recovers over time:
```
n_k(t) = n_k(t0) * 2^( -(t - t0) / R )     R = recovery half-life, game days   (R = 3, PLACEHOLDER)
N      = base_c * 2^( -n_k / h )           h = half-life in occurrences        (h = 4, PLACEHOLDER)
if N <= floor_frac * base_c: pay 0         floor_frac = 0.0625                 (PLACEHOLDER)
else: pay N, then n_k = n_k + 1
```

Derived: `N <= 0.0625 * base` holds first at `n_k = 16` (`2^-4 = 0.0625`, ties go to zero), so the floor is a hard stop after 16 paid repeats until recovery. The most a key can pay without recovery is `base * sum_{n=0}^{15} 2^(-n/4) = base * (1 - 2^-4) / (1 - 2^-0.25) = 5.89 * base`. Repeating one action is worth at most 5.9 times its first occurrence, then zero. Recovery re-opens it: after `R` days `n_k` has halved.

Base values (PLACEHOLDER): `gather` 4, `mine` 6, `farm` 4, `tend` 5, `fish` 4, `smelt` 3, `cook` 4, `craft` 5, `explore` 2 per first-time chunk (from the existing `chunk_visited` evidence), `write` 6, `deliver` 8. `place_kept` and `trade_out` have no novelty base; they pay only through usefulness.

### 3.3 Usefulness

`U` is paid to the producer, never to the consumer, when something outside the agent makes the work matter. Three sources:
1. **Consumption by another agent.** Another life eats, equips, places, or uses as a crafting input an item whose provenance leads to the producer (3.5). `U = u_c * min(units, 8)` per consumer event, `u_c = 3` (PLACEHOLDER). One producer is paid at most once per (consumer, item id, game hour).
2. **Contract fulfilment.** The fulfiller gets `U = 0.5 * reward_marks` (PLACEHOLDER), capped at `1.5 * item_value * count` so contracts cannot launder points (value table: data file, PLACEHOLDER values: blocks 1, food 2, tools 6, rare ore items 8 to 12; used for caps only).
3. **Persistence of a placed block.** A block the agent placed, still present with the same state `D = 3` game days later (PLACEHOLDER), not broken by its placer, still owned by the placer in the block-owner log, pays `u_p = 0.2` per block, evaluated once at the day boundary. At most 40 blocks per agent per day pay. Blocks also pass through the novelty key `(place_kept, block_id, region)` with `base = 1`, so a 1000-block dirt tower is worth at most 5.9 blocks' pay. If a distinct other agent stays within 6 blocks of the structure for at least 200 ticks in the window, `u_p` doubles.

### 3.4 Daily cap, floors, and what earns zero

- Per profession per game day, counted points are at most `C_p = 120` (PLACEHOLDER). Across professions, at most `C_all = 200`. Excess is dropped, never banked.
- Points in a profession that is not one of the agent's two active professions count at `w_off = 0.5` (PLACEHOLDER).
- The floor is the novelty floor above. There is no negative XP.

| Case | Rule |
|---|---|
| Idle loop (walking or jumping in place, opening and closing a door) | Not a class. Only the closed classes earn; `goto` earns nothing |
| Repeating one action | Zero after the floor, until recovery |
| Breaking own placement | Removed from the persistence list; its novelty count is not refunded |
| Re-placing the same block state in the same cell | Counts once per `D` days |
| Dropping and picking up own items | Not a class |
| Self-trading between one agent's own accounts | Pairs that resolve to the same registered owner never earn `U` and cannot accept each other's contracts |
| Consuming own output, opening a container of own items | No `U` |
| Excess over the daily cap | Dropped |

### 3.5 Provenance without tagging items

Items are not tagged (a data component could break stacking for vanilla clients). The mod keeps a bounded per-agent producer ledger `(item_id, count, producer, day)`, added when an agent picks up `craft`, `smelt` or `cook` output or harvests crops it planted, at most 128 entries, first in first out. When items move between agents (give, drop and pick-up, withdrawal from a container last filled by another agent), units move with FIFO matching by item id. When a consumer uses a unit that matches a producer entry (producer is not the consumer), the usefulness event fires. Chain depth is at most 2 hops. Unmatched units are untracked and earn no `U`.

### 3.6 Anti-collusion for two-agent loops

Two agents passing goods back and forth would otherwise farm `U`. All rules are in the pure library:
1. **Pair window.** For each ordered pair (producer P, consumer C) let `m` be the paid `U` events in the last 7 game days. `w_pair = 2^(-m / 3)`. The 10th paid event in a week pays about 12 percent.
2. **Reciprocity.** With `a` the units flowing P to C and `b` the units flowing C to P over 7 days, `rho = min(a, b) / max(a, b)` (0 when either is 0), `w_recip = 1 - 0.75 * rho` (PLACEHOLDER). A balanced loop pays 25 percent.
3. **Cycles.** `w_recip` also applies when the 7-day flow graph has a directed cycle of length 3 or less containing the producer and carrying at least 50 percent of its outgoing `U` volume.
4. **Counterpart share cap.** `U` from a single counterpart is at most 25 percent of the producer's daily cap `C_p`.
5. **New relationship.** The first paid event from a counterpart not seen in 7 days pays x1.25 (PLACEHOLDER).

### 3.7 Worked numeric example

Agent A, forager and builder active, world day 40. Parameters as above.

1. A fells oak logs at region (3, -2): key `(gather, oak_log, (3,-2))`, `n = 0`. Awards `4 * 2^(-n/4)` for n = 0..4: 4.00, 3.36, 2.83, 2.38, 2.00. Five logs pay 14.57 (derived: 4 x 3.6426). Sixteen logs pay 23.6 (4 x 5.892). The 17th would pay `4 * 0.0625 = 0.25`, which equals the floor, so it pays 0.
2. Day 43, one half-life later: `n = 16 * 0.5 = 8`. The next log pays `4 * 2^(-8/4) = 1.00`. Day 46: `n = 4`, pays 2.00.
3. A mines iron ore at `(mine, iron_ore, (3,-2))`: first pay 6.00.
4. A bakes 6 bread (`cook`, `bread`): 4.00, then 3.36 on the next event.
5. B and C each eat 3 of the bread. Usefulness `3 * 3 = 9` per consumer, `w_pair = 1`, `w_recip = 1` (no flow back), new relationship x1.25 each: `9 * 1.25 * 2 = 22.5`. Share cap: 25 percent of 120 is 30 per counterpart, so no cut.
6. Loop: A bakes 6 bread for B and B bakes 6 for A, daily for 5 days. Day 1: `rho = 1`, `w_recip = 0.25`, one batch pays `18 * 1 * 0.25 * 1.25 = 5.6`. By day 3, `m = 6`, `w_pair = 2^-2 = 0.25`: a batch pays `18 * 0.25 * 0.25 = 1.1`. Over 5 days the pair earns under 50 points together, against 22.5 for one honest delivery to two new counterparts.
7. Cap: if A's `forager` points reach 160 on a day, 120 count and 40 are dropped.

## 4. Levels, unlocks and professions

### 4.1 Level table

One overall level from total counted points `T`. Thresholds are cumulative, PLACEHOLDER, about 1.5 times the previous gap per level (about 3 to 10 game days of varied work at the cap).

| Level | Total points | Claim edge (blocks) | Waypoints | Contracts postable at once | Storage link size | Workshop set |
|---|---|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 0 | 0 | none |
| 1 | 60 | 16 | 1 | 0 | 0 | none |
| 2 | 160 | 24 | 2 | 1 | 4 | W1 |
| 3 | 300 | 32 | 3 | 1 | 6 | W1 |
| 4 | 500 | 40 | 4 | 2 | 8 | W2 |
| 5 | 800 | 48 | 6 | 2 | 12 | W2 |
| 6 | 1200 | 64 | 8 | 3 | 16 | W3 |
| 7 | 1800 | 80 | 10 | 4 | 24 | W3 |
| 8 | 2600 | 96 | 12 | 5 | 32 | W4 |

What each means, and its vanilla mechanism (no registry entries):
- **Claim.** A square centred on the agent's respawn position (its set bed), edge from the table. Blocks the owner placed inside it are protected from breaking by other agents, through the NeoForge block-break event (cancel) and the block-owner log (P4). It is created and resized automatically, with no verb. It does not change damage dealt or taken.
- **Waypoints.** Named places the agent records, usable as a `goto` target by name. No teleport (a speed capability, excluded). Needs a contract change (8.5).
- **Contract posting.** The number of contracts the agent may have open as poster.
- **Storage link.** The number of containers an agent may name under one storage group. Needs Body and MCP support; optional in the first release.
- **Workshop set.** Recipe sets (4.2).

### 4.2 Recipe gating mechanism

- The gamerule `limitedCrafting` is true on the scratch shard, so only unlocked recipes can be crafted (decision 0048 already needs recipe discovery).
- Each set W1 to W4 is one hidden advancement in the mod's data pack: no `display` block (no toast, no chat announcement), one criterion `unlock` using the vanilla `minecraft:impossible` trigger (not a custom trigger, so no registry entry), reward `recipes: [...]`. The mod awards the criterion in code with `PlayerAdvancements.award` when level and profession thresholds are met. The recipe book is the unlock surface; agents see the effect through the existing `unlocked_recipes` fact.
- The recipes in a set are removed from the vanilla auto-unlock path with data-pack overrides of the vanilla recipe advancements (parent is the set advancement). Fallback if an override proves fragile: revoke those recipes at join and on level change; the bench decides on tick cost.
- Sets (PLACEHOLDER; utility only, no weapon, armour or tool tiers): W1 barrel, composter, smoker, lectern, loom, fletching table. W2 blast furnace, smithing table, cartography table, grindstone, hopper. W3 compass, clock, spyglass, lantern, lightning rod, observer. W4 recovery compass, brewing stand, cauldron, stonecutter.
- A set also needs 100 counted points in its owning profession (W1 cook, W2 smith, W3 builder or courier, W4 any), so professions matter.

### 4.3 Professions

A profession is a tag set: action classes with a weight.

| Profession | Primary classes (weight 1.0) | Secondary (weight 0.5) |
|---|---|---|
| forager | gather, farm, tend, fish | explore |
| miner | mine | smelt |
| builder | place_kept | craft (block recipes) |
| smith | craft (tools, workstations), smelt | mine |
| cook | cook, farm | tend |
| courier | deliver, explore | trade_out |
| merchant | trade_out, fulfilled posted contracts | deliver |
| scribe | write | explore |

Rules:
- For an action, `credit(p) = points * weight(class, p)`. The profession with the largest credit gets the points and the others get nothing, so one action never pays twice. Ties go to an active profession, then alphabetical order.
- The active professions are the two with the most counted points over the last 7 game days (maximum two). A challenger replaces the second only after leading it by 20 percent for 3 consecutive days (hysteresis). There is no verb to choose.

## 5. Contracts and reputation

### 5.1 Record
```json
{
  "schema_version": 1,
  "id": "ct_0000000041",
  "poster": "ag_kestrel_01",
  "item": "bread",
  "count": 12,
  "destination": { "x": 120, "y": 64, "z": -48, "radius": 6 },
  "posted_day": 38,
  "deadline_day": 44,
  "reward_marks": 18,
  "fee_marks": 1,
  "state": "open",
  "accepted_by": null,
  "accepted_day": null,
  "delivered": 0,
  "fulfilled_day": null,
  "dispute": null
}
```

Bounds: `deadline_day - posted_day` 1 to 14; `count` 1 to 256; `radius` 2 to 8; `reward_marks <= 4 * item_value * count`. Marks are the contract currency: minted only by the level stipend (5.5) and burned only by the fee. They are not points, not thinking credits, and cannot buy points.

### 5.2 Lifecycle

States: `open`, `accepted`, `fulfilled`, `expired`, `disputed`, plus the terminal `cancelled`.

| Transition | Trigger | Effect |
|---|---|---|
| new to open | poster posts; a slot is free; poster holds `reward + fee` marks | `reward + fee` moves to escrow; `fee = ceil(0.05 * reward)` |
| open to accepted | another agent accepts; not the same owner; accepted-slot rule (5.6) | one fulfiller per contract |
| open to cancelled | poster cancels before acceptance | refund of the reward, fee burned |
| accepted to fulfilled | mod detects `delivered >= count` before the deadline | reward to fulfiller; fee burned; points and reputation applied |
| open or accepted to expired | world day passes `deadline_day` | reward refunded; fee burned; accepted and under-delivered also costs the fulfiller reputation; partial delivery pays nothing |
| accepted or fulfilled to disputed | poster or fulfiller disputes within 1 game day of the last delivery event, or the rule check of 5.4 fires | escrow frozen |
| disputed to fulfilled or expired | automatic re-evaluation of the delivery log after 1 game day (mechanical, no human) | pays or refunds by the log |

### 5.3 Detection by the mod

Units count as delivered when, coming from the fulfiller, they:
- are given to the poster (or dropped and picked up by the poster within 200 ticks) while the poster is inside the destination area; or
- are deposited into a container inside the area that the block-owner log shows as owned by the poster.

Each unit counts once. Units the poster handed to the fulfiller in the last 7 days do not count (the loop case). The item must match the id exactly; durability and names are not part of the first release.

### 5.4 Collusion checks in contracts

`U` from a contract is weighted by `w_pair`, `w_recip` and the cycle rule of 3.6. A delivery between two agents whose 7-day `rho` exceeds 0.8 holds the payment as `disputed` for one game day, then pays by the log; the flag is telemetry. Marks are not reweighted: the two agents agreed to move them.

### 5.5 Stipend and sinks

Marks per game day by level (PLACEHOLDER: 0, 2, 3, 4, 5, 6, 8, 10, 12), credited at the day boundary up to a holding cap of 10 times the stipend, so unspent marks do not pile up (derived bound). The only sink is the posting fee. Whether to run this internal ledger or reuse the world credit ledger (spec 5.7) is open question 4.

### 5.6 Reputation

A per-agent counter `R`, non-negative, shown as an integer. Events: `+1` per contract fulfilled as fulfiller and `+0.5` as poster, each multiplied by `w_pair * w_recip` of that pair; `-2` for an accepted contract that expires. There is no poster penalty (a poster cannot refuse delivery: the mod detects it). Decay `R(t) = R(t0) * 2^(-(t - t0)/14)` game days (PLACEHOLDER). Use: accepted contracts at once `= 1 + floor(R / 5)`, at most 4. Reputation is shown beside a contract as a number: "reputation 7".

## 6. Data model

### 6.1 Storage

Two `SavedData` classes on the overworld data storage: `geldar_progression_agents` and `geldar_progression_contracts` (NBT on disk; the JSON below is the logical shape and the export form). Dirty-marked, written at most every 600 ticks and on stop. They are part of the world backup (spec 6.8).

### 6.2 Per-agent record
```json
{
  "schema_version": 1,
  "life_id": "ag_kestrel_01",
  "uuid": "00000000-0000-0000-0000-000000000000",
  "total_milli": 360000,
  "level": 3,
  "today": { "day": 40, "by_prof_milli": { "forager": 61000, "builder": 12000 }, "all_milli": 73000 },
  "prof_milli": { "forager": 150000, "builder": 90000, "cook": 40000 },
  "prof_7d_milli": { "forager": [0, 12000, 0, 0, 0, 0, 61000] },
  "active": ["forager", "builder"],
  "keys": { "gather|oak_log|3:-2": { "n": 8.0, "day": 43.0 } },
  "pairs": { "ag_pike_02": { "paid_7d": [0, 2, 0, 0, 1, 0, 0], "out_7d": 6, "in_7d": 0, "day": 40 } },
  "producer_ledger": [ { "item": "bread", "count": 6, "producer": "ag_kestrel_01", "day": 40 } ],
  "placed": [ { "x": 1, "y": 64, "z": 2, "state": "oak_planks", "day": 38 } ],
  "rep": { "value": 7.0, "day": 40 },
  "marks": 40,
  "escrow": 18,
  "waypoints": [ { "name": "mill", "x": 10, "y": 64, "z": 20 } ],
  "sets": ["W1"]
}
```

### 6.3 Bounds (derived from the caps)

- `keys`: at most 512 entries, about 60 bytes each (30 KiB). On overflow, drop the entries with the smallest decayed `n`; their loss costs nearly nothing because a small `n` already pays almost in full.
- `pairs` at most 64 (oldest by `day` dropped), `producer_ledger` at most 128, `placed` at most 400 pending persistence checks (further placements are not tracked and earn no persistence points), `waypoints` at most 12, `sets` at most 4.
- One agent record is about 40 KiB at worst, so 200 agents are about 8 MiB. Contracts: at most 512 open or accepted at about 600 bytes (about 300 KiB). Closed contracts are emitted to NATS and removed 7 game days after closing.
- Points are 64-bit integer milli-points. Floats are persisted only for `n` and decay days.

### 6.4 Versioning

`schema_version` per record and per file. One migration function per step `vN to vN+1`, each unit-tested against a fixture file. A file with a higher version than the code refuses to load and fails closed: progression is off, one log line is written, the world runs. Migrations never drop unknown fields.

## 7. NATS events

Subjects follow the plugin's `geldar.<shard>.<type>` three-token form (`EventEnvelope.subject()`; for example `geldar.phase0.death`), which the sink records. Life-scoped state uses the five-token form of decision 0280 (`geldar.<shard>.state.<life_id>.<name>`), which is outside the sink filter. Envelope fields are those of the plugin: `source_event_id`, `at`, `shard`, `world_day`, `world_tick`, `type`, `agent_id`, `payload`.

| Event type or subject suffix | Agent-visible? | Payload sketch |
|---|---|---|
| `progress_award` | no | `{class, target, region, novelty_milli, usefulness_milli, counted_milli, profession, weights: {pair, recip}, capped}`; aggregated per agent per 200 ticks |
| `progress_level` | no | `{from, to, total_milli, sets_unlocked: []}` |
| `contract_event` | no | `{id, state, poster, fulfiller, item, count, reward_marks, reason}`; one per state change |
| `reputation_changed` | no | `{from, to, cause, counterpart}` |
| `marks_ledger` | no | `{life_id, delta, reason: "stipend" or "escrow" or "release" or "refund" or "fee_burn", contract_id, balance}` |
| `progress_audit` | no | daily metrics (section 10) |
| `state.<life_id>.progress` (request and reply) | yes, only through the MCP text provider | `{level, total_points, next_level_points, claim_edge, claim_centre, waypoints_used, waypoints_max, professions, points_today, daily_limit, reputation, marks, escrow, sets_held}` |
| `state.<life_id>.contracts` (request and reply) | yes, provider only | open contracts near the agent and the agent's own, as plain fields |

Rules: the three-token events go to the Historian and analysis and are never relayed by `wait`. Only the two `state.<life_id>.*` request subjects feed MCP text. The MCP service account may request on those two subjects for its own life and nothing else of this table. The mod's publisher may publish the event types above and reply on the two state subjects. The known gap of decision 0280 (broad Body publish on `geldar.<shard>.>`) also covers forging these; the ACL card must deny them. This note changes no ACL.

## 8. MCP text

### 8.1 Where it lives

`ProgressionTextProvider` is a pure interface in the mod repo: a state record in, strings out. The TypeScript MCP service renders the same strings from the NATS reply, and one golden fixture file tests both. The block appears inside the existing `look` and `wait` self section as a `progression` key (absent when the flag is off). It never appears in `say`, chat, books, signs or any HUD, and the mod sends no system chat or action-bar message to any Body.

### 8.2 Proposed `progression` block

Plain lines in fixed order; a line is absent when there is nothing to say:
```
Level 3. Claim size 32. Next unlock needs 140 more points.
Total points 360.
Professions: forager, builder.
Points counted today: forager 61 of 120, builder 12 of 120.
Waypoints: 2 of 3 used.
Contracts: you may have 1 open as poster. You have 1 open and 0 accepted.
Reputation 7. Marks 40, 18 held in escrow.
Some workshop recipes are held until level 4.
```

One fixed mechanics sentence in the `look` tool description (not repeated in results, like the regeneration sentence):
```
Points come from actions that are new to you in a place, and from things you make that others use. Repeating the same action in the same place pays less each time, and the loss recovers over several days. Each profession counts at most 120 points a day.
```

### 8.3 Contract list

From a new read tool `contracts`:
```
Contracts open near you, 2:
ct_0000000041. Poster ag_pike_02, reputation 7. Wants 12 bread. Deliver to 120, 64, -48 within 6 blocks. Due day 44. Reward 18 marks.
ct_0000000044. Poster ag_wren_03, reputation 2. Wants 40 oak_log. Deliver to 80, 70, 12 within 4 blocks. Due day 43. Reward 30 marks.
Your contracts, 1:
ct_0000000039. You wanted 8 iron_ingot. Accepted by ag_pike_02 on day 37. Delivered 3 of 8. Due day 41.
```

Action result lines: `Contract ct_0000000041 accepted. 12 bread due day 44.`, `Contract ct_0000000041 fulfilled. 18 marks received.`, `Contract ct_0000000039 expired. 18 marks returned.`

### 8.4 Line-by-line check against 0058, 0059 and 0068

| Line | 0058: knowledge, facts, no coaching | 0059: never told it is watched | 0068: no observer, harness, credit meta; marker scan | Result |
|---|---|---|---|---|
| Level, claim size, next unlock gap | A measured gap, not advice | no audience | no marker word | pass |
| Total points | a fact | none | none | pass |
| Professions | derived from the agent's own play | none | none | pass |
| Points counted today, of 120 | the cap is a published ceiling (spec 5.7) | none | none | pass |
| Waypoints used | a count | none | none | pass |
| Contract slots | a capacity | none | none | pass |
| Reputation, marks, escrow | ledger facts | none | "marks", not the marker word "credit" | pass |
| Held recipes | first draft listed the held recipe names, which leaks recipes that 0048 says are discovered. Fixed to the generic sentence | none | none | pass after the fix |
| Mechanics sentence | a rule of the world; no "should", no timing | none | none | pass |
| Contract lines | facts about other agents' offers; structured fields only, no free text, so no `untrusted_world_text` exposure | none | none | pass |
| "Due day 44" | time as a fact, no urgency | none | none | pass |
| Action result lines | events as facts | none | none | pass |

Banned-word lint for this provider (test): should, try, must, hurry, soon, now, best, recommend, goal, quest, score, rank, leaderboard, test, server, plus `MARKER_WORD`.

### 8.5 Contract and schema changes needed (owned by the main orchestrator; not made here)

1. `mcp-play.schema.json`: an optional `progression` object in the snapshot self section (and its `{unchanged, count}` form in `wait`, as in decision 0221).
2. A new read tool `contracts` (tool list and `mcp-world.schema.json`).
3. A new `act` verb `contract` with `op` (`post`, `accept`, `cancel`, `dispute`) and fields `item`, `count`, `at`, `radius`, `due_in_days`, `reward`, `id`.
4. `note` gains an optional waypoint `place` field, and `goto` accepts a waypoint name.
5. `contract/src/subjects.ts`: builders for the two state subjects and the event type names of section 7.
6. NATS ACL entries (section 7), and the agent-text scan test extended to the new strings.
7. A ruling on the proficiency overlap (question 3).

## 9. Admin and command surface

Console and RCON only (permission level 4, and the sender must not be a player entity):
- `/geldar progress dump <life_id>`: print the record (read only).
- `/geldar progress audit [day]`: print the last audit.
- `/geldar progress verify`: re-run the pure invariants (milli-point sums, escrow equals the contract table, caps) and print the result.
- `/geldar progress pause` and `resume`: stop and restart awards, level changes and contract transitions. An infrastructure kill switch: state is kept and events carry `paused: true`.

There is no `award`, `give`, `set`, `post`, `settle` or `unlock` command. A data fix after a bug ships as a reviewed migration (6.4). This is principle 1 in code.

## 10. Anti-grind audit (telemetry only)

Computed daily from the award log, written as `progress_audit` per agent and per cohort. Never in agent text, never an automatic penalty: the mechanical rules above are the penalties, and the audit finds what they miss, for the owner to tune.

| Metric | Definition | Flag (PLACEHOLDER) |
|---|---|---|
| Key concentration | share of the day's points from the top key | above 0.5 |
| Action entropy | Shannon entropy of points over keys, bits | below 1.5 with at least 50 events |
| Repeat ratio | events whose key equals the previous event's key | above 0.7 |
| Zero-award fraction | zero-paid events over events | above 0.6 |
| Pair concentration | Herfindahl index of `U` sources by counterpart | above 0.6 |
| Reciprocity | highest `rho` over any pair, 7 days | above 0.6 |
| Persist-then-break | placer-broken blocks within `D` days over blocks placed | above 0.3 |
| Cap-hit rate | days at the cap in a profession over active days | above 0.5 over 7 days |
| Position variance | position variance in 200-tick windows that have events | below 4 blocks squared for 20 windows |
| Cohort outlier | robust z-score (median and MAD) of counted points per day | above 3 |
| Mark velocity | marks moved between one pair per day | above 4 times the higher stipend |

## 11. Test plan

Every rule has a test that fails when the rule is reverted. The pure library tests need no Minecraft.

| Rule | Test | The revert breaks |
|---|---|---|
| Novelty halves per `h` | table: n = 0..4 pays 4.00, 3.36, 2.83, 2.38, 2.00 | the factor |
| Floor at 16 repeats | the 17th award is 0 | the floor |
| Recovery | after 3 days the next award is 1.00 | recovery |
| Per-key total | 1000 repeats sum to 5.89 times base (derived) | floor or decay |
| Daily cap | 160 in, 120 counted, 40 dropped | the cap |
| Off-profession weight | 0.5 | `w_off` |
| One action pays one profession | split rule | double pay |
| Zero cases of 3.4 | one replay log per row, assert 0 | each row |
| Provenance FIFO and depth 2 | scripted give chains | the depth guard |
| `w_pair`, `w_recip`, cycles | the 5-day loop of 3.7 totals under 50 | any of the three |
| Counterpart share cap | one counterpart is at most 25 percent of `C_p` | the cap |
| Same-owner pair | no `U`; accept refused | the owner check |
| Persistence | kept 3 days pays; broken by placer pays 0; 40 per day | each |
| Level thresholds and gap text | exact thresholds; "Next unlock needs N more points" | off-by-one |
| Contract lifecycle | table of every legal and illegal transition | any transition |
| Escrow conservation | property test: marks in = out + burned over random logs | an escrow bug |
| Delivery detection | each unit once; loop units excluded | double counting |
| Reputation decay and slots | 14-day half-life; slots by `R` | decay |
| Saved data | round trip; migration from fixtures; eviction at 512 keys | bounds, migration |
| Humans earn nothing | a non-agent UUID has no record | the `isAgent` check |
| No mutating commands | the command tree holds only dump, audit, verify, pause, resume; a player sender is refused | principle 1 |
| Text provider | golden strings of section 8; banned words and `MARKER_WORD` scan; held recipe names never listed | wording |
| Telemetry isolation | ACL fixture: MCP account cannot reach the audit and event subjects; provider output has no audit field | a leak |
| Recipe gate | integration (server needed): a level 1 agent cannot craft a W1 recipe, a level 2 agent can; no toast and no chat packet | the gate |

### Simulation harness

`ProgressionSim` replays a JSONL action log through the pure `XpEngine` with an explicit world day, no clock and no random source. Lines:
```json
{"day":40.2,"agent":"ag_a","class":"gather","target":"oak_log","x":200,"z":-130}
{"day":40.3,"agent":"ag_b","class":"consume","item":"bread","units":3,"from":"ag_a"}
```

Output per agent: counted points per profession per day, level, keys, flags. Golden logs: honest day, pure grinder, two-agent loop, dirt tower, same-owner pair, cap-hitter. A sweep mode (grid over `h`, `R`, caps) prints a table so the owner tunes the PLACEHOLDER values before any server run. The success target for the first sweep: the best honest strategy beats the best loop by at least 3 to 1 (PLACEHOLDER). Only the hooks, the gating and the saved-data wrapper need NeoForge.

## 12. Packets for parallel Haiku coders

Each packet is at most about 400 lines. Package `dev.geldar.progression` in a Gradle module `neoforge/progression` (P2's core split fixes the final paths). Pure packets have no Minecraft imports; a build rule checks that.

| # | Packet | Files (under the module) | Depends on | Runs in parallel with |
|---|---|---|---|---|
| 1 | Pure XP, decay, professions | `core/Types.java`, `core/XpEngine.java`, `core/Novelty.java`, `core/Caps.java`, `core/Professions.java`, `core/Levels.java`, `core/Reputation.java`, `core/Params.java` (all PLACEHOLDERs in one file) | none | none; start first |
| 2 | Saved-data store | `store/AgentRecord.java`, `store/ContractRecord.java`, `store/Json.java`, `store/Migrations.java`, `store/ProgressionSavedData.java` (only NeoForge class), fixtures | 1 (types) | 3, 4, 5, 6, 8 |
| 3 | Event hooks | `hooks/BlockHooks.java`, `hooks/ItemHooks.java`, `hooks/CraftHooks.java`, `hooks/AgentFilter.java`, `hooks/ProvenanceTracker.java` | 1, 2 | 4, 5, 6, 8 |
| 4 | Advancement and recipe gating | data pack JSON for W1 to W4 and the recipe-advancement overrides, `gating/RecipeGate.java`, `gating/LevelUnlocks.java` | 1 | 2, 3, 5, 6, 8 |
| 5 | Contract engine | `contracts/ContractEngine.java` (pure state machine), `contracts/Escrow.java`, `contracts/DeliveryDetector.java`, `contracts/ItemValues.java` | 1 | 2, 3, 4, 6, 8 |
| 6 | NATS emitter | `nats/ProgressEmitter.java`, `nats/Subjects.java`, `nats/StateResponder.java` (uses the P3 adapter's publisher) | 1, P3 | 2, 3, 4, 5, 8 |
| 7 | Admin command surface | `command/ProgressCommand.java`, `command/Invariants.java` | 2 | 8, 9 |
| 8 | MCP text provider | `text/ProgressionTextProvider.java`, `text/Wording.java`, `text/golden.txt` (the TypeScript rendering and contract edits belong to the orchestrator, 8.5) | 1 | 2 to 6 |
| 9 | Simulation and invariants | `sim/ProgressionSim.java`, `sim/logs/*.jsonl`, `sim/Golden.java`, property tests | 1, 5 | 2 to 8 once `Types.java` is stable |

Order: packet 1 first, with `Types.java` and `Params.java` in its first commit so the rest can code against them. Then 2, 4, 5, 6, 8 (and 9) in parallel. Then 3 and 7. The server integration check (recipe gate, hooks, persistence) is an ops task after the merges and after the P0 join result, and uses the scratch shard only. Nothing here builds before P0 shows a golem Body joining; P6 (mod skeleton) is the container for packets 2, 3, 4 and 6.

## 13. Open questions and risks

Open questions for the owner:
1. **Principle 2.** Is progression in scope at all, as a documented toggleable constraint (principle 3), given "no scoring"? If yes it needs a spec line; this note edits no spec.
2. **Visibility of numbers.** Show agents points, level and the daily limit, or only capability facts (claim size, recipes held)? Showing the limit invites gaming; hiding it contradicts "ceilings are visible facts".
3. **Overlap with proficiency.** The existing `proficiency-state` (seven domains, level 0 to 3) and the held-back character sheet: replace, map domains to professions, or run only one per shard?
4. **Marks versus the world credit ledger** (spec 5.7). An internal ledger is simple and cannot buy thinking; reusing the credit ledger gives marks real value but needs a round trip and a policy on inflation of thinking credits.
5. **Stipend.** Are free level stipends of marks acceptable, or should marks only come from other agents (then nobody can post a first contract)?
6. **Waypoints.** Names only (this design) or real fast travel? The owner said no speed; teleport may be judged differently.
7. **Claims.** Automatic around the bed needs no verb, but protecting blocks changes the principle 5 stance on griefing. Is protection allowed, or is a claim only a marker?
8. **Recipe holds.** Which vanilla recipes may be held? The model knows Minecraft; a held recipe simply absent from `unlocked_recipes` may read as an odd world.
9. **The human on the scratch shard.** The brief mentions one human in the bench. Under principle 1 the human is a non-agent that earns nothing and cannot act. Confirm that matches the P8 bench.

Risks:
- Goodhart: agents optimise points. Mitigations: caps, novelty, collusion rules, audit, the shard flag. The first sweep must show honest play beating loops by the target margin.
- Provenance without item tags is approximate (bulk chests, stack merges). A miss costs a little `U`; a false match is bounded by the caps. If the bench shows drift, test a vanilla `custom_data` component, which may break stacking for mineflayer.
- Hidden advancements still sync to vanilla clients as packets. Golem ignores them, but a vanilla client must be checked on the scratch shard to confirm no toast or tab appears.
- Persistence and claims depend on the unfinished P4 block-owner log. The pure library, contracts and simulation can proceed without it.

Pointer (2026-11-17): default choices for these open questions are in [progression-defaults.md](progression-defaults.md). They are proposals under the owner's delegation, not in force until the flagged decision record exists.
