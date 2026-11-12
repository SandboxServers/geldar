# Wave PX packets: perception for body and mind

Written 2026-11-11. Decision: [0154](../../../decisions/0154-perception-owner-rulings.md) (owner rulings, Decided). Conventions: [packet-conventions.md](../packet-conventions.md). Evidence: the Jason play record (sessions 1 to 19), defects D1 to D11, cited below as "Dn". Design source: the perception requirements note (gaps #1 to #15, the same numbering is used here). Rules in the wave: an agent gets what a player could see or hear, in fixed text, with no wiki knowledge and nothing about who is watching (0058, 0068, 0145).

## Purpose

Jason could not tell what hit him, where his own drops were, how far the ground was, whether it was getting dark, or what was behind the lake. The Body knows all of this. Wave PX gives the Mind the facts a player would see or hear, and gives the Body reflexes the same sight rule, so the two never disagree about what is there.

## Scope and splits

The brief set eight packets, PX-1 to PX-8. Four were larger than one coder session and are split with letters. The split keeps the same ordinal and the same gap numbers.

| Packet | Scope | Gaps | Evidence |
|---|---|---|---|
| PX-0 (C6-DEATH) | death fields; separate, outline only here | 0144 | D3 |
| PX-1 | hurt event with source and bearing | #1 | D7, D3 |
| PX-2a | entity coordinates, dropped item names, stacks | #2, #3 | D3, D8 |
| PX-2b | threat reading, known hostiles, sight for reflexes | #4, rulings 1 and 6 | D7, D8 |
| PX-3a | sky phase, ground below, trapped state | #6, #7 | D6, D8 |
| PX-3b | light, health trend, regeneration hint | #8, #9 | D7, D8 |
| PX-3c | armour, status flags, air, tool wear | #10, #13 | D8, D9 |
| PX-4 | hearing: heard_sound with compass and band | #5 | D7 |
| PX-5 | hazards, and line of sight for block counts | #11, ruling 5 | D5, D8 |
| PX-6 | containers: furnace state, remembered contents, `recall` | #12 | D9 |
| PX-7 | reflex use: hiss flee, arrow dodge, dark shelter (body only) | reflexes | D7 |
| PX-8a | `reach` dry run in the Body | #14 | D8 |
| PX-8b | `reach` tool, contract, free of credits | #14, ruling 7 | D8 |

Gap #15 (reflex displacement unannounced, D5) is not in this wave. It is Jason's D5 and belongs to the body-events work, not to be duplicated here.

## Owner rulings this wave implements (decision 0154)

1. Known always-hostile mobs are always flagged `hostile`. Neutral and conditional mobs use observed state (idle, closing, attacking, fleeing) and the held item. Spider is conditional: neutral in daylight or bright light unless provoked, hostile at night or in low light (orchestrator ruling, 2026-11-11).
2. Time of day is a coarse sun phase (PX-3a).
3. Hearing is `heard_sound` with a compass direction and a distance band. Never coordinates. Fixed radius. Sounds do not wake the Mind by default (PX-4).
4. The regeneration hint states the rule plainly, as fixed text, with the trend as data (PX-3b).
5. Block counts require line of sight (PX-5).
6. Body reflexes use line of sight too (PX-2b for `view.nearbyHostiles`, PX-5 for hazards, PX-7 for the reflexes).
7. `reach` is free. Entities in sight carry exact coordinates. Entities only heard carry bearing and band (PX-2a, PX-4, PX-8b).

## Dependency graph and merge order

```
C6-BODY-EVENTS (branch phase1/c6-body-events, not yet merged) + C5-00 (event schema)
  |
  +-- PX-1 hurt event ----------------------------+
  |                                               |
  +-- PX-2a coords + items                        |
  |     |                                         |
  |     +-- PX-2b threat, sight                   |
  |     |     |                                   |
  |     +-- PX-3a sky, ground                     |
  |           |                                   |
  |           +-- PX-3b light, regen              |
  |                 |                             |
  |                 +-- PX-3c armour, flags, wear |
  |                       |                       |
  |                       +-- PX-5 hazards, sight |
  |                       +-- PX-6 containers     |
  |                                               |
  +-- PX-4 sound (after PX-1, PX-2b) -------------+
  |
  +-- PX-7 reflex use (after PX-1 and PX-4)
  |
  +-- PX-8a reach dry run (after PX-2a) -> PX-8b reach tool
```

PX-0 (C6-DEATH) depends on C6-BODY-EVENTS and on C5-03 (death event and `died_at`, 0144).

Parallel and sequential rules:

- **Contract files are merged one at a time, in the order above.** `contract/schemas/event.schema.json`, `snapshot.schema.json`, `mcp-world.schema.json` and the generated outputs are touched by PX-1, PX-2a, PX-2b, PX-3a, PX-3b, PX-3c, PX-4, PX-5, PX-6, PX-8b. Each packet rebases on the previous merge and regenerates; it never hand-edits generated code (packet-conventions 2).
- **`perception/snapshot.ts` and `play-view.ts`** are shared by PX-2a to PX-6. The same rule applies: rebase and merge in order.
- **PX-7** edits `reflexes/fight-or-flee.ts` and `shelter.ts`. No other PX packet touches them.
- **PX-5 and hazard-escape**: PX-5 refactors the scan in `reflexes/hazard-escape.ts` and must keep every existing hazard-escape test passing unchanged.
- **C5-01 overlap**: C5-01 edits `pathing.ts`, `goto.ts`, `unstick.ts`, `blocked-path.ts` and `dig-cell.ts`. PX-8a reads the planner but edits `pathing.ts` only after C5-01 merges.

## Shared rules for every card

- **Knowledge boundary.** All agent-visible text is fixed text built from enumerated codes. No model text, no agent string, no Glass, Lakitu or spectator data. Sound and hurt events carry no coordinates. Every new channel passes the existing scans.
- **Sight.** A channel reports only what the Body can see, unless the card says "heard". Line of sight is the same test the Body already uses for notable blocks.
- **Principle 1.** No new tool lets a human act in the world.
- **Provisional vocabulary** (0033, 0069). New event types and wake reasons are PROVISIONAL and listed in the card's decision line.
- **Revert-check.** Each behaviour change has a named test that fails when its one line is mutated back. The report names the test and the mutation.
- **Limiter, timer, counter.** Any throttle, window, cap or counter has a success test, a last-allowed-attempt test, an abort test, a close test and an error-path test.
- **Geometry.** Every direction rule has a test on each axis and each sign (+x, -x, +z, -z, and y where it matters).
- **Live lane.** Live cases are written but not run in these cards; the orchestrator runs them. Each card names its live case and says `live: pending`.
- **Common card tail** (packet-conventions 3): must-not-edit `docs/spec.md`; worknote `docs/analysis/phase1/worknotes/<id>.md`; on the cap, commit what passes and report the rest; the commit subject names the item.
- **Checks** for every card: `./geldar.ps1 pnpm --filter golem test`, the threshold/mcp test script, `./geldar.ps1 pnpm contract:generate` and the drift check after any contract edit, `./geldar.ps1 pnpm typecheck`, `./geldar.ps1 pnpm check:repo`, `./geldar.ps1 check`.

---

## PX-0 (C6-DEATH): death fields (outline, separate packet)

- **id / wave.** PX-0 (C6-DEATH), outside the PX-1 to PX-8 sequence. **depends-on.** C6-BODY-EVENTS merged; C5-03 (death event and `died_at`, 0144).
- **Goal.** Death gains a coarse `where` (x, z) once; one "dropped N items" line per life; `status` gets `life` (1..n) and `days_alive_this_life` next to the existing `days_alive`; the respawn point is stated once per life. No revive (0144).
- **Tests.** Death once emits one `where` and one drop line. Two deaths give life 2 and a reset `days_alive_this_life`. A death with no drops emits no drop line. Revert: count does not reset per life; the test fails. Abort and error: a death during a respawn gives one event, not two.
- **decisions.** 0144 (death event, no revive), 0154 (the death fields are outside the seven rulings; they follow 0144). **size.** S + S.

## PX-1: hurt event with source and bearing

- **Branch / commit.** `phase1/px-1-hurt-event`; "PX-1: hurt event with source and bearing". **depends-on.** C6-BODY-EVENTS merged (it changes the damage wording; PX-1 builds on it, it does not redo it); C5-00 merged (event schema).
- **Goal (gap #1, D7, D3).** Event `hurt`: `{source: melee|arrow|explosion|fall|fire|lava|drowning|starvation|other, bearing: front|left|right|behind, mob?, amount:int}`. Text: "An arrow hit you from behind. You lost 3 health." Zero-amount duplicates are dropped; amount is rounded and capped at health. `bearing` is relative to the Body's facing, not compass.
- **may-edit.** `contract/schemas/event.schema.json`, `contract/src/outcome-words.ts`, `golem/src/mind-link/recent-events.ts`, new `golem/src/perception/hurt.ts`, `threshold/mcp/src/events/mapper.ts`, `threshold/mcp/src/events/present.ts`, tests beside them.
- **Tests (each fails on revert).**
  - Source table: each cause maps to its fixed sentence; an unknown cause maps to `other`. Revert: map unknown to melee.
  - Bearing on every axis and sign: attacker at +x, -x, +z, -z with yaw 0, 90, -90, 180. Revert: bearing ignores yaw.
  - Duplicates: a zero-amount hurt emits nothing. Revert: emit `amount: 0`.
  - Rounding and cap: 19.7 damage at 4 health gives amount 4 (capped), not 20. Revert: no cap.
  - Abort, close, error: a hurt after bot `end` is not emitted; a missing attacker gives `source: other` with no bearing and no throw.
  - Schema: validator accepts a valid hurt, rejects an unknown `source` and an extra property.
- **live.** `hurt-arrow-bearing`: arrow from behind, the text names "behind". `live: pending`.
- **checks.** Standard set plus `contract:generate`.
- **decisions.** 0143 (provisional vocabulary), 0154. **size.** S-M.

## PX-2a: entity coordinates and item stacks

- **Branch / commit.** `phase1/px-2a-entity-coords`; "PX-2a: entity coordinates and item names". **depends-on.** none in wave PX (first schema merge).
- **Goal (gaps #2, #3, D3, D8).** Every entity in sight carries integer `x,y,z` (ruling 7). Dropped items are `{type:"item", item:"oak_log", count:3, x,y,z}`, one record per item name per cluster, nearest position, counts summed. `look` caps entities at 12, nearest first. Entities only heard get no coordinates (PX-4 owns them).
- **may-edit.** `golem/src/perception/entities.ts`, `contract/schemas/snapshot.schema.json`, `contract/schemas/mcp-world.schema.json` (look entity fields), `threshold/mcp/src/play-view.ts`, tests beside them.
- **Tests.**
  - Coordinates: an entity at offsets +x, -x, +z, -z, +y, -y gives exact integer coordinates. Revert: omit `x,y,z`.
  - Stacks: three item entities with `oak_log` in one cluster give one record with count 3. Revert: three records.
  - Cap: 13 entities give 12 records, nearest first. Last allowed: exactly 12 kept. Revert: no cap.
  - Sight: an entity behind a wall is absent. Revert: no sight test.
  - Abort, close, error: an entity removed between samples is dropped without a throw; an item with no readable name gives `type: "item"` with no `item` key.
- **live.** none. `live: pending` only for the schema check.
- **checks.** Standard set.
- **decisions.** 0154 (rulings 7). **size.** S-M.

## PX-2b: threat reading and sight for reflexes

- **Branch / commit.** `phase1/px-2b-threat-sight`; "PX-2b: threat reading, known hostiles, sight for reflexes". **depends-on.** PX-2a merged.
- **Goal (gap #4, D7, D8; rulings 1 and 6).** `hostile: true` for the known always-hostile list (zombie, skeleton, creeper, witch, phantom, drowned, husk, stray, pillager and the rest of the game's always-hostile classification). Other mobs, spider included, are not flagged from their type; spider is conditional and its state is read from observation. `closing: true` when the distance fell over two samples. `held_item` for armed mobs (a skeleton's bow). `fuse: hissing` for a creeper that is ignited. Arrows are shown only when closing. `view.nearbyHostiles` (used by reflexes) requires line of sight; the Body and the Mind use the same sight test.
- **may-edit.** `golem/src/perception/entities.ts`, new `golem/src/perception/hostile-types.ts` (the list, written from the game's classification and named in the file), `golem/src/body/view.ts`, `contract/schemas/snapshot.schema.json`, `contract/schemas/mcp-world.schema.json`, `threshold/mcp/src/play-view.ts`, tests beside them.
- **Tests.**
  - Known list: each always-hostile type is flagged; spider is not flagged from type alone (a spider in state `attacking` shows the state). Revert: flag omitted for zombie; revert: flag spider by type.
  - Neutral: wolf, enderman, piglin, bee, iron_golem, spider are not flagged from type alone; a wolf in state `attacking` shows `closing` or the attacking state, not a flag. Revert: flag wolf by type.
  - Closing sign: distance 10 then 8 gives `closing: true`; 8 then 10 gives false; equal gives false. Revert: `closing` always false.
  - Window: samples older than the window are discarded. Last allowed: two samples exactly at the window edge still count. Revert: no window.
  - Abort, close, error: an entity that leaves view deletes its sample entry (no growth over 1000 leaves); a missing distance gives `closing: false` with no throw.
  - Sight for reflexes: a hostile behind a block is absent from `view.nearbyHostiles`. Revert: remove the sight test; the test fails.
  - Arrow filter: a non-closing arrow is omitted; a closing arrow is kept.
  - Fuse: `fuse: hissing` only when the creeper's ignited flag is set.
- **live.** `creeper-behind-wall`: a creeper behind a wall does not trigger a reflex. `live: pending`.
- **checks.** Standard set.
- **decisions.** 0154 (rulings 1, 6). **size.** M. Spider ruling recorded 2026-11-11; no open point.

## PX-3a: sky phase, ground below, trapped state

- **Branch / commit.** `phase1/px-3a-sky-ground`; "PX-3a: sun phase, ground distance, trapped state". **depends-on.** PX-2a merged (schema order).
- **Goal (gaps #6, #7, D6, D8).** `self.ground_below`: 0 when grounded, else distance to solid ground (leaves do not count as ground), cap 32. `self.trapped`: `none|perched|pit` from the column scan and the wall height. `sun`: `morning|midday|afternoon|low|set` from `bot.time`, omitted when there is no sky above (underground, indoors).
- **may-edit.** new `golem/src/perception/self-state.ts`, `golem/src/perception/snapshot.ts`, `contract/schemas/snapshot.schema.json`, `contract/schemas/mcp-world.schema.json`, `threshold/mcp/src/play-view.ts`, tests beside them.
- **Tests.**
  - Ground: standing on stone gives 0; stone 3 below gives 3; no ground within 32 gives 32. Revert: remove the cap.
  - Leaves: a body on leaves over stone 5 below gives `ground_below: 5` and `trapped: perched`. Revert: count leaves as ground.
  - Trapped: four walls at least 2 high with ground below gives `pit`; leaves over air gives `perched`; open ground gives `none`. Revert: `trapped` always `none`.
  - Sun boundaries: each boundary tick maps to its phase (exact edges). Revert: `sun` omitted.
  - No sky: `sun` key absent, not null, underground. Revert: emit `sun` underground.
  - Axis: `ground_below` uses only the y axis; a block offset in x or z does not change it.
  - Abort, close, error: a `blockAt` returning null stops the scan with no throw and omits the field.
- **live.** `canopy-perch`: body on the spawn canopy reports `perched`. `live: pending`.
- **checks.** Standard set.
- **decisions.** 0154 (ruling 2). **size.** S.

## PX-3b: light, health trend, regeneration hint

- **Branch / commit.** `phase1/px-3b-light-regen`; "PX-3b: light level, health trend, regeneration rule". **depends-on.** PX-3a merged.
- **Goal (gaps #8, #9, D7, D8; ruling 4).** `self.light: bright|dim|dark` from block and sky light at the head (bright at 12 or more, dim at 4 to 11, dark below 4); Body reflexes read the raw 0 to 15. `self.health_trend: rising|steady|falling` over a fixed sample window; `hunger_bar` unchanged. When hunger is below the server's natural-regeneration threshold, a fixed hint states the rule plainly: "Health does not regenerate naturally while hunger is low. Hunger falls over time." The threshold is read from the pinned Paper version's source and written in the card's test, not guessed.
- **may-edit.** `golem/src/perception/self-state.ts`, `golem/src/perception/snapshot.ts`, `golem/src/body/view.ts` (raw light for reflexes), `contract/schemas/snapshot.schema.json`, `contract/schemas/mcp-world.schema.json`, `threshold/mcp/src/play-view.ts`, tests beside them.
- **Tests.**
  - Light boundaries: 3 dark, 4 dim, 11 dim, 12 bright. Revert: `light` omitted.
  - Raw light: reflexes read the 0 to 15 number, not the word. Revert: reflexes read the word.
  - Trend: 18 then 19 gives rising; equal gives steady; a fall gives falling. Last allowed sample at the window edge still counts. Revert: no window.
  - Respawn: a health jump after a death resets the window; the trend is steady, not rising. Revert: no reset.
  - Abort, close, error: no samples gives `steady` with no throw; the timer is cleared on bot `end`.
  - Hint: present only below the threshold; exact text; the text contains no verb of advice (no "eat"). Revert: hint absent.
- **live.** `hunger-hint`: a body at low hunger shows the hint. `live: pending`.
- **checks.** Standard set.
- **decisions.** 0154 (rulings 4). **size.** S-M. Threshold verified in the report.

## PX-3c: armour, status flags, air, tool wear

- **Branch / commit.** `phase1/px-3c-self-flags`; "PX-3c: real armour, status flags, air and tool wear". **depends-on.** PX-3b merged.
- **Goal (gaps #10, #13, D8, D9).** `armor` is the real armour value (it is hard-coded 0 today). `status_flags` lists only the flags that are true: `burning`, `underwater`, `falling`, `in_water`, `on_ground`; the key is omitted when empty. `air` is shown only below 20. Tools and armour carry `wear: low|worn|nearly_broken` from durability: worn at 50 percent used or more, nearly_broken at 90 percent used or more, low below 50 percent.
- **may-edit.** `golem/src/perception/self-state.ts`, `golem/src/perception/snapshot.ts` (the inventory projection), `contract/schemas/snapshot.schema.json`, `contract/schemas/mcp-world.schema.json`, `threshold/mcp/src/play-view.ts`, tests beside them.
- **Tests.**
  - Armour: wearing an iron chestplate changes `armor` from 0. Revert: `armor` hard-coded 0.
  - Flags: each flag appears only when true; empty gives no key. Revert: always list all flags.
  - Air: 20 omits `air`; 19 shows it. Revert: always show `air`.
  - Wear boundaries: 49 percent used is low, 50 worn, 89 worn, 90 nearly_broken. Revert: no wear key.
  - Non-tool: a stone block has no `wear` key. Revert: wear on every stack.
  - Error: an item with no durability data has no `wear` key and no throw.
- **live.** none.
- **checks.** Standard set.
- **decisions.** 0154. **size.** S-M.

## PX-4: hearing: heard_sound with compass and band

- **Branch / commit.** `phase1/px-4-sound`; "PX-4: heard sounds as compass and distance band". **depends-on.** PX-1 merged (event schema); PX-2b merged (reuses `closing` and `fuse`).
- **Goal (gap #5, D7; ruling 3).** Event `heard_sound`: `{sound: hiss|bow|groan|growl|explosion|thunder|digging, dir: compass, band: near|mid|far}`. Text: "You hear hissing close to the north." Listens to `hardcodedSoundEffectHappened` and `entitySound`. Fixed radius of 24 blocks. Bands: near up to 8, mid up to 16, far up to 24. `dir` is world-fixed (N is -z, S is +z, E is +x, W is -x), not the facing. Limiter: at most one event per kind per 10 seconds. Sound coordinates never leave the Golem. Sounds do not wake the Mind on their own: the wake interest `sound` in `threshold/mcp/src/tools/wait.ts` is off by default.
- **may-edit.** new `golem/src/perception/sounds.ts`, `contract/schemas/event.schema.json`, `contract/src/outcome-words.ts`, `threshold/mcp/src/events/mapper.ts`, `threshold/mcp/src/events/present.ts`, `threshold/mcp/src/tools/wait.ts`, tests beside them.
- **Tests (each fails on revert).**
  - Compass on every axis and sign: sound at +x, -x, +z, -z and diagonals gives E, W, S, N and the diagonals. Revert: swap the sign of z.
  - Bands: distances 8, 9, 16, 17, 24 give near, mid, mid, far, far; 25 is dropped. Revert: no radius.
  - Limiter: a second hiss within 10 s is dropped; at exactly 10.0 s it is allowed; a different kind is allowed. Revert: no throttle.
  - Abort, close, error: after bot `end` the throttle timer is cleared and nothing is emitted; an unknown sound id is ignored with no throw; an entity without a position is ignored.
  - Coordinates absent: the schema rejects `x`, `y`, `z` on `heard_sound`. Revert: allow coordinates.
  - Wake: a `heard_sound` does not wake the Mind unless the `sound` interest is set. Revert: default on.
- **live.** `heard-hiss`: a creeper hiss out of sight gives a compass event, no coordinates. `live: pending`.
- **checks.** Standard set plus `contract:generate`.
- **decisions.** 0154 (ruling 3), 0143 (provisional vocabulary). **size.** M.

## PX-5: hazards and line of sight for block counts

- **Branch / commit.** `phase1/px-5-hazards-sight`; "PX-5: hazard list and block counts need line of sight". **depends-on.** PX-3c merged (schema order).
- **Goal (gap #11, D5 lake episodes in sessions 13 and 19; rulings 5 and 6).** `hazards: [{kind: lava|deep_water|drop|fire|cactus, dir, dist}]`, at most 4, within 8, line of sight only, nearest first. The Body shares the scan with hazard-escape. Block counts in `nearby-counts.ts` count only cells the Body can see.
- **may-edit.** new `golem/src/perception/hazards.ts`, `golem/src/body/reflexes/hazard-escape.ts` (shared scan), `golem/src/perception/nearby-counts.ts`, `golem/src/perception/snapshot.ts`, `contract/schemas/snapshot.schema.json`, `contract/schemas/mcp-world.schema.json`, `threshold/mcp/src/play-view.ts`, tests beside them.
- **Tests.**
  - Kinds: each kind is detected at a known cell. Revert: drop one kind.
  - Distance: 8 in, 9 out. Last allowed: exactly four hazards kept, the fifth dropped. Revert: no cap.
  - Direction on every axis and sign: lava to the west gives W, to the north gives N, and so on. Revert: swap a sign.
  - Sight: lava behind a wall is not reported; a block count for a kind excludes cells behind a wall. Revert: remove the sight test (ruling 5 test).
  - Refactor: every existing hazard-escape test passes unchanged. Revert the shared scan; the escape test fails.
  - Abort, close, error: an unloaded chunk (`blockAt` null) is skipped with no throw; the scan stops on bot `end`.
- **live.** `lake-edge`: the summary names lava or deep water within 8. `live: pending`.
- **checks.** Standard set.
- **decisions.** 0154 (rulings 5, 6). **size.** M.

## PX-6: containers: furnace state, remembered contents, recall

- **Branch / commit.** `phase1/px-6-containers`; "PX-6: furnace state, remembered containers, free recall". **depends-on.** PX-3c merged (schema order).
- **Goal (gap #12, D9).** An open result adds furnace `input`, `fuel`, `output`, `progress`. A notable furnace carries `lit: bool`. The Body keeps the last-opened contents of each container and returns them in a free `recall` read with `age_days`. Contents of an unopened container are never shown (spec, 0145 pattern).
- **may-edit.** `golem/src/actions/container.ts`, new `golem/src/perception/remembered-containers.ts`, `golem/src/perception/notable-blocks.ts` (`lit`), new `threshold/mcp/src/tools/recall.ts`, `contract/schemas/mcp-world.schema.json`, `threshold/mcp-mock/` fixtures, tests beside them.
- **Tests.**
  - Furnace: an open result carries all four fields. Revert: drop `progress`.
  - Recall: open a chest, recall returns its contents with `age_days: 0`; after two days it is 2. Revert: no `age_days`.
  - Unopened: recall of a chest never opened returns "unknown", not contents. Revert: show empty contents.
  - Lit: a furnace with lit state true shows `lit: true`; false shows false. Revert: omit `lit`.
  - Cap (limiter): 64 remembered containers are kept; the 65th evicts the oldest. Last allowed: the 64th is kept. Revert: no cap.
  - Abort, close, error: an open that fails mid-way remembers nothing; bot `end` makes no store write.
  - Free: `recall` spends no credits. Revert: charge one credit; the budget test fails.
- **live.** `furnace-lit`: open a lit furnace in a fixture. `live: pending`.
- **checks.** Standard set.
- **decisions.** 0154 (ruling 7, free reads), 0145 (no oracle). **size.** M.

## PX-7: reflex use (body only)

- **Branch / commit.** `phase1/px-7-reflex-use`; "PX-7: reflexes for hiss, arrows and dark". **depends-on.** PX-1 merged; PX-4 merged.
- **Goal (D7).** Flee on a hiss when a creeper is in sight within 5 (ruling 6: no flee from a creeper out of sight). Sidestep away from an arrow's bearing when hurt by an arrow or when a bow is heard. Shelter when it is dark and a hostile is closing. A flee cooldown stops thrashing.
- **may-edit.** `golem/src/body/reflexes/fight-or-flee.ts`, `golem/src/body/reflexes/shelter.ts`, tests beside them.
- **Tests.**
  - Hiss with a creeper in sight within 5 triggers flee. Revert: no hiss trigger.
  - Hiss from a creeper out of sight does not trigger flee (ruling 6). Revert: ignore sight.
  - Arrow bearing left sidesteps right; front and behind on every sign. Revert: sidestep the wrong way.
  - Dark and a closing hostile triggers shelter; not dark does not. Revert: shelter always.
  - Cooldown limiter: a second flee within 2 s is suppressed; at 2.0 s it is allowed. Revert: no cooldown.
  - Abort, close, error: the flee is cancelled on bot `end`; a missing bearing does not throw.
- **live.** `creeper-hiss-flee`: the body moves away on a hiss with a creeper in sight. `live: pending`.
- **checks.** Standard set.
- **decisions.** 0154 (rulings 6). **size.** M.

## PX-8a: reach dry run in the Body

- **Branch / commit.** `phase1/px-8a-reach-dryrun`; "PX-8a: reach dry run with a node cap". **depends-on.** PX-2a merged; C5-01 merged before `pathing.ts` is touched (read-only use before that).
- **Goal (gap #14).** Result: `in_hand | walk N | needs_digging | blocked | unknown`. Dry run of the pathfinder with a node cap (a named constant). Only targets already seen or remembered; any other target gets `unknown`, the same wording as a hidden target (no oracle, 0145).
- **may-edit.** new `golem/src/actions/reach.ts`; `golem/src/actions/pathing.ts` only for a read-only planner entry, and only after C5-01 merges; tests beside them.
- **Tests.**
  - In hand: a held block matching the target gives `in_hand`. Revert: skip the hand check.
  - Walk: a target 5 blocks away on a flat floor gives `walk 5`; the distance counts both x and z in all four directions. Revert: count x only.
  - Needs digging: a target behind a stone wall gives `needs_digging`. Revert: report `blocked`.
  - Unknown: a target never seen gives `unknown`; the same text as a hidden target. Revert: differing text.
  - Node cap (limiter): a goal behind an unreachable region stops at the cap and returns within a bounded step count. Last allowed: at the cap exactly, the result is returned.
  - Abort, close, error: a planner throw gives `unknown` with no throw; bot `end` cancels the search with no timer left.
- **live.** none.
- **checks.** Standard set.
- **decisions.** 0154 (ruling 7), 0141 (soft-dig, the planner's dig rule). **size.** M.

## PX-8b: reach tool, contract, free of credits

- **Branch / commit.** `phase1/px-8b-reach-tool`; "PX-8b: reach tool, free of credits". **depends-on.** PX-8a merged.
- **Goal (gap #14, ruling 7).** Tool `reach {x,y,z}`, integer arguments, free. Out-of-range or missing arguments are `invalid_input`. Result text is the fixed text of PX-8a.
- **may-edit.** new `threshold/mcp/src/tools/reach.ts`, the tool registry file in `threshold/mcp/src/tools/`, `contract/schemas/mcp-world.schema.json`, `contract/src/` (generator inputs), `threshold/mcp-mock/` fixtures, tests beside them.
- **Tests.**
  - Valid call is accepted; a missing `z` is rejected. Revert: accept a missing `z`.
  - Free: the budget is unchanged after a `reach`. Revert: charge one credit.
  - No oracle: a hidden target and an unknown target return identical text. Revert: differing text.
  - Schema: the generated validator rejects an extra property; the drift check is clean after regeneration.
  - Abort, close, error: a `reach` after the session closes returns the closed-session error with no throw.
- **live.** `reach-seen-log`: a seen log returns `walk N`. `live: pending`.
- **checks.** Standard set plus `contract:generate`.
- **decisions.** 0154 (ruling 7), 0145. **size.** S-M.

---

## Ledger

One row per card is in [../ledger.md](../ledger.md), section "Wave PX". PX-1 and PX-0 wait on C6-BODY-EVENTS merging. PX-2b is Ready after PX-2a merges; the spider point under ruling 1 is settled (conditional mob).
