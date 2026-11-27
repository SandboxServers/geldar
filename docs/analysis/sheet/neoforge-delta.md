# Sheet campaign on NeoForge: the delta

> **Decision 0390 is Accepted (operator ruling, 2026-11-27, see 0289) and supersedes 0329.** The NeoForge twins stay frozen until their cards are re-dispatched; nothing is activated (held-live stands).

Status: planning note, docs only, 2026-11-18, against `origin/main` = `a8063b0a`; revised the same day for the operator rulings 0321, 0322 and NF-1 to NF-6 (decision 0329, Proposed). The owner chose "delta packets": the existing sheet cards stay as written for the Paper shard, and every card whose world side is Paper-specific gets a NeoForge twin card, blocked on its NeoForge prerequisite. This note says which cards need a twin and why; the twins themselves are in [../harness/work-packets-sheet-neoforge.md](../harness/work-packets-sheet-neoforge.md); proximity chat on NeoForge is planned in [neoforge-chat-plan.md](neoforge-chat-plan.md). It edits no accepted decision and no code.

**Decision 0322 (operator ruling, 2026-11-18), OD-NF-7 answered yes:** the sheet campaign includes the NeoForge shard **as inert code**. The twins are written, reviewed and merged, but stay **off** (nothing registers unless `export.enabled` and `provenance.enabled` are both true, and no deploy turns them on), and every twin, AN-NF-00 included, merges only after **P3-LIVE and P4** have merged. Activation follows the held-live ruling on the NeoForge shard, as on Paper.

**Decision 0321 (operator ruling, 2026-11-18):** combat XP is keyed by encounter. The Body's own kill record and the `combat_fact` (Paper or NeoForge) pay one shared key, `enc:<life_id>:<mob_uuid>` (AN-46, AN-47b), so a kill is paid once whichever source reports it.

**Decision 0329 (Proposed; operator rulings NF-1 to NF-6, 2026-11-18):** on the NeoForge shard players and agents are equals and agents are fully aware of players. 0387 item 7, and 0059 as far as 0387 item 7 relies on it, do not apply to the NeoForge shard. That is scope, not a change for Paper: on the Paper shard agents do not know humans exist and nothing changes. The rulings: NF-1 no blanked human names, and an agent is told nothing it did not see itself; NF-2 the attacker is named, human or agent (A5 withdrawn); NF-3 container-taking inactive, AN-NF-51a dropped; NF-4 kill credit to the killing blow; NF-5 proximity chat planned (NF-CHAT); NF-6 human block owners logged by name. Two of its questions were answered on 2026-11-18: **Q1** skip the provenance feed on NeoForge for v1, the Body derives observations itself, raise its priority for v2 (section 3a; the v1 cost is section 3b); **Q7** humans do not earn or hold marks in this version, agents still do (section 7 item 7).

Tags, as in [../neoforge/p3-adapter-design.md](../neoforge/p3-adapter-design.md): **VERIFIED** = read in this repo (path given), or a class name that a merged NeoForge module compiles against NeoForge 26.1.2 (build 126). **UNVERIFIED** = needs a GameTest, a first server run, a node check, an owner answer, or a source read this note did not do. A NeoForge name is VERIFIED here only when merged code under `neoforge/` or `neoforge-ledger/` already compiles against it.

## 1. What is platform-neutral and what is not

**Neutral (one code path serves both shards):**

- **The Body** (`golem/`). It is a vanilla-protocol client (mineflayer). P0 proved a golem Body joins a NeoForge 26.1.2 server behind Velocity with Proxy Compatible Forge 1.3.1, walks and mines ([../neoforge/RESUME.md](../neoforge/RESUME.md), runs 6 to 8b). Its perception reads packets, not server events. Exception: perception that reads a **plugin-served** subject or a **server-side chat filter** is only neutral if NeoForge serves the same thing (below).
- **The contract** (`contract/`), **psyche** (`psyche/`), **the eventsink** (`eventsink/`, including `eventsink/src/xp/` and `eventsink/src/state/`), **SQL** (`sql/`), **the MCP** (`threshold/`, `player-core/`), **the kit** (repo `geldar-scriptorium`). They read NATS subjects and WorldEvents whatever produced them. Exception: the observed-actor shape (AN-24, AN-25) assumes every visible player has a life id; NF-2 needs a name-keyed player actor (A6, A7, AN-NF-25).
- W2's XP sources are all Body-produced: `action`, `intent` and `chunk_visited` (`eventsink/src/xp/awards.ts`, VERIFIED). No W2 XP row depends on a Paper event.

**Platform-bound (Paper today, nothing on NeoForge yet):**

| Surface | Paper source (VERIFIED path) | NeoForge today |
|---|---|---|
| WorldEvents `damage`, `death`, `sleep`, `server_tps` | `plugin/core/.../EventExporter.java` | Merged: `neoforge/.../ExportListeners.java`, `ExportHandlers.java`, `EventMapping.java` (P3-3). Scratch proof `live: pending` (`neoforge/README.md`) |
| Block ownership: `geldar.<shard>.blockowner.query` (reply) and `blockowner.changed` (decision 0165) | `plugin/core/.../blockowner/BlockOwnerSetup.java`, `BlockChangeListener.java`; core-common `NatsBlockOwnerLink`, `OwnerCache`, `CoreProtectOwnerSource` | None. P4 (own block-owner log) is on hold and has no design note. Every Body ownership read on NeoForge answers `known: false` (`golem/src/body/block-owners.ts`: a failed query is unknown) |
| Proximity chat (spec 5.8, decision 0199: speech reaches only players within 32 blocks; "There is no global chat") | `plugin/core/.../proximity/ProximityChatListener.java` (Bukkit); the judge is Bukkit-free in core-common (`ChatHearing`, `ProximityRule`, `Absorption`, `NatsHearingSink`) | None. P3 put chat out of scope, and `NoRegistryScanTest` forbids chat event names in `neoforge/src/main` (decision 0375, Proposed). So on NeoForge a Body hears whatever vanilla chat delivers (UNVERIFIED: no NeoForge run with chat). Planned: [neoforge-chat-plan.md](neoforge-chat-plan.md) (NF-CHAT) |
| Provenance subjects (W5, W8; not built on either platform yet) | Planned in `plugin/` by AN-26a, AN-27a, AN-47a (AN-51a on Paper only) | Skipped for v1 (0329 Q1, answered 2026-11-18), v2 priority; only AN-NF-47a's combat facts (not provenance) are planned (section 3a) |

**Shard facts that change the world side on NeoForge** (all VERIFIED as written records; their status is Proposed unless stated):

- **Per-shard storage** (0380, 0381): the NeoForge shard has its own NATS, database (`geldar_nf`) and eventsink; stream `GELDAR_EVENTS_NF`, subjects `geldar.nf.*`. Each NeoForge database runs every migration from empty, so the sheet tables (`sql/0050` to `0052`) exist there once migrated.
- **NeoForge NATS users** (0383, `deploy/nats-auth-nf.ps1`): the mod's user `neoforge` may publish `geldar.<s>.*` (three tokens) only. The `body` user is the P0 probe's only (one registry key); the file says real Bodies on `geldar-nf` "will need their own role and a later owner decision". So **no sheet Body can run on the NeoForge shard today**: it cannot publish its events, request its proficiency state or hear level pushes. The provenance widening (`geldar.<s>.provenance.>` for `neoforge`) is **not written** (0329 Q1: not needed for v1; v2 would need it).
- **Human-directed shard, players and agents equals** (0387, 0388 Accepted, 0329 Proposed): humans play on the NeoForge shard. Agents perceive them as players. In agent-facing observations a human is an actor like any agent and is named when the agent saw them (NF-1, NF-2). Human block owners are logged by name (NF-6). The merged NeoForge **export** (P3) still writes human events without a name (`EventEnvelope.isLifeId`, `neoforge/README.md`, Privacy); that is telemetry privacy, not agent perception, and 0329 does not change it (0329 Q5).
- **Agent usernames on NeoForge.** The human lane refuses any name starting with `ag_` or `ag-`, any case (0388, "What is built"), and the bot ingress is unpublished, so a player whose username starts with `ag_` is never a human there. Not every agent username is a `LifeId`, though: managed lives are `ag_` plus 1 to 12 characters (`golem/src/players/managed-config.ts`, `MANAGED_LIFE_ID`), which does not match the contract `LifeId` pattern (`contract/schemas/common.schema.json`). Which username shape NeoForge Bodies will use is part of NF-BODY (UNVERIFIED).

## 2. Card by card

"Twin" = a NeoForge card exists in the twin file. "Neutral" = no twin; the card's code serves both shards. "Neutral, degraded" = no twin, but on NeoForge the card's behaviour is reduced until a named prerequisite lands.

### W0 to W2 (merged)

| Card | World side | NeoForge verdict |
|---|---|---|
| AN-02a/b, AN-03a/b/c, AN-04a/b, GX-02 | contract, psyche, SQL | Neutral |
| AN-05, AN-05b loaders; AN-06b audit producer; AN-07 wiring; GX-01b stamps | Body | Neutral; needs the NeoForge Body role (NF-BODY) to run |
| AN-06a sink audit projection; AN-09a matrix; AN-10a/b ledger and publication; AN-11a state service; AN-12b sink wiring | eventsink | Neutral code. Deployment: the NeoForge eventsink (0380) would need the sheet sink wiring AN-12b gave colo (`eventsink/src/sheet-sink-override.test.ts` exists; whether the `geldar-nf` compose project carries the same override is UNVERIFIED). Held-live anyway |
| AN-08a/b threat policy and reflexes | Body (psyche policy, `golem/src/perception/hostile-types.ts`) | Neutral. The hostile list is vanilla; the NeoForge extra mods are server-side and add no entities (UNVERIFIED, [../neoforge/pregen-and-extra-mods-design.md](../neoforge/pregen-and-extra-mods-design.md)) |
| AN-09b first chunk visit, attack target kind; AN-09c program on intent | Body | Neutral |
| AN-11b, AN-11c proficiency cache, reply without sheet; AN-12a Body wiring | Body plus state subjects | Neutral code; the `geldar.nf.state.*` grants exist for `sink` in `deploy/nats-auth-nf.ps1` but not for a Body (NF-BODY) |
| GX-04a player-core, GX-05a turn record, GX-06 instinct key, GX-08 peek | MCP and contract | Neutral |

### W3, W4, W6 (kit)

| Card | NeoForge verdict |
|---|---|
| HC-18 to HC-26c, HC-33, HC-24 | Neutral (the kit talks to the MCP, not the server) |
| HC-27a, HC-28a/b, HC-29, HC-30a/b | Neutral. HC-30a's adapter must read a `PlayerActor` (no `life`) as `actorName` only; HC-27b already keys an actor with no life by its name (`SAFE_ID` takes a Minecraft name). Message the kit owner when AN-NF-25 lands |
| HC-27b observation reader | Neutral, degraded: `spoke_first` reads `speech` with `to_me`; on NeoForge, without proximity chat, a Body hears speech from any distance, so `spoke_first` is **inactive on NeoForge until NF-CHAT merges and is on** (NF-5). `hit_me` works on NeoForge once AN-NF-25 lands (the hurt actor is Body-derived). `gave_me` and `took_mine` (from `property_broken`) get no input on NeoForge in v1 (0329 Q1; cost in section 3b) |

### W5

| Card | World side | NeoForge verdict |
|---|---|---|
| AN-24 observed-actor contract | contract | Neutral, plus amendment **A6** (a `PlayerActor`) for NF-2 |
| AN-25 visible attacker identity | Body (`golem/src/perception/hurt-trigger.ts`: cause entity from the damage packet) | Neutral code, plus amendment **A7** (a naming mode). A visible human attacker is named (NF-2). If A6 and A7 are not folded into AN-24 and AN-25 before dispatch, **twin AN-NF-25** adds them after |
| AN-26a pickup provenance | **plugin** (`EntityPickupItemEvent`, `Item#getThrower()`) | Twin AN-NF-26a, **Deferred to v2 (0329 Q1: not needed for v1)** |
| AN-26b gift observation | Body | Neutral code, but no input on NeoForge in v1 (no pickup provenance). In v2 only the attributed gift survives NF-1 (section 3a) |
| AN-27a break provenance | **plugin** (`BlockBreakEvent`, prior owner from `OwnerCache`) | Twin AN-NF-27a, **Deferred to v2 (0329 Q1: not needed for v1)**; needs P4 for a populated owner cache |
| AN-27b property-break observation | Body | Neutral code, but no input on NeoForge in v1 (no break provenance). In v2 only the attributed break survives NF-1 (section 3a); without P4, `prior_owner` is null for every block the Body did not place in its current session |
| AN-28a delivery path | MCP | Neutral. Its marked-word drop of actor names conflicts with NF-2 for some human names (0329 Q2) |
| AN-28b Body wiring and leakage gate | Body + leakage test | Neutral code; needs NF-BODY to run on NeoForge; on NeoForge it passes naming `'named'` (A7) |
| AN-28c plugin setup and ACL (split out of AN-28b) | `BlockOwnerSetup.java` and `geldar.ps1` (Paper) | Twin AN-NF-28b for the mod setup, **Deferred to v2 (0329 Q1: not needed for v1)**; its NATS rows are removed (the 0383 widening is not written; v2 would need it) |

### W7

| Card | NeoForge verdict |
|---|---|
| AN-44, AN-45a, AN-45b (contract, registration, body-api v11) | Neutral |
| AN-39 explore | Neutral (loaded columns are protocol data) |
| AN-40 farm | Neutral, degraded: a cell is farmed only if own or world-generated (`ownerRecordAt` known with owner null). Without P4 every cell that is not the Body's own placement is `known: false` and counted `skipped_unknown`, so the program farms only its own sowings |
| AN-41 patrol | Neutral |
| HC-31 | Neutral |

### W8

| Card | World side | NeoForge verdict |
|---|---|---|
| AN-46 evidence contract and the combat key | contract | Neutral |
| AN-47a combat facts | **plugin** (`EntityDeathEvent`, `LivingEntity#getKiller`, damage events); encounter logic in core-common (A3) | **Twin AN-NF-47a**, combat facts only. Kill credit differs (NF-4): NeoForge credits the player whose hit is the death source; Paper credits the last player to damage the mob within a window. The combat provenance half is removed (section 3a: the Body sees fights itself) |
| AN-47b combat award, one key per encounter | eventsink, Body attack record | Neutral: the same key pays a NeoForge `combat_fact` and the Body's kill once |
| AN-47c visible-fight observation | Body | Neutral code. On NeoForge it has no provenance source; the Body can derive a visible fight itself (section 3a, UNVERIFIED for other entities' damage packets) |
| AN-49 conversation exchange | eventsink over stored `speech` | Neutral code, **inactive on NeoForge until NF-CHAT merges and is on** (NF-5): the rule "B's Body heard A" assumes proximity chat. Without it, every pair of Bodies on the shard could "exchange" |
| AN-51a container-take facts | **plugin** (`InventoryClickEvent`) | Paper only. **Twin AN-NF-51a Dropped** (0329 NF-3): container-taking stays inactive on NeoForge |
| AN-51b observed take | Body | Paper only; inactive on NeoForge (NF-3: the agent notices a theft itself) |
| HC-27c | kit | Neutral |
| AN-50a sink and plugin registration | sink registration (neutral), `GeldarCore.java`, `BlockOwnerSetup.java` (Paper) | **Twin AN-NF-50** for the mod registration of the combat facts |
| AN-50b Body subscription and leakage gate | Body, MCP | Neutral code; needs NF-BODY to run on NeoForge |

### W9 to W12, GX-03

| Card | NeoForge verdict |
|---|---|
| S9-00 erasure coverage gate | Neutral; each NeoForge database (0380) runs the same migrations, so the gate holds there too |
| S9-01, S9-02, S9-03 property refusal | **Retired, not built** (0326, OD-1 no: mining stays free); no NeoForge question remains |
| HC-41, HC-42, HC-43, HC-45 | Neutral |
| HC-44 persona refresh | **Retired** (0327: no persona refresh text) |
| S10-01a to S10-04 (lineage) | Neutral code, not dispatched; no births this campaign (0327); C4 (Cradle) has no NeoForge path either |
| S11-01 to S11-06 (drift) | Neutral code, not dispatched; no drift this campaign (0327) |
| S12-01 exporter, S12-02 to S12-07 | Neutral code; the exporter and cohort runs must name which shard database they read (0380: one database per shard) |
| GX-03 operator sheet read | Neutral (per-shard database) |

Twins in total: AN-NF-00 (unblocker), AN-NF-25 (new, named player actor), AN-NF-26a, AN-NF-27a, AN-NF-28b (these three Deferred to v2, 0329 Q1), AN-NF-47a, AN-NF-50; AN-NF-51a Dropped. The Body-derived cards AN-NF-26b-native, AN-NF-27b-native and AN-NF-47c-native are not written (names reserved). Under 0322 all of them are inert code: merged but off, each merging only after P3-LIVE and P4. NF-CHAT-0 to NF-CHAT-3 are prerequisite cards owned by the NeoForge campaign ([neoforge-chat-plan.md](neoforge-chat-plan.md)).

## 3. Amendments to the Paper cards (so the twins reuse code)

The P3 design rejects copying sources between `plugin/` and `neoforge/` ("drifts", p3-adapter-design section 4.1); `neoforge/` already consumes `plugin/core-common` as a composite build and packs it in its jar (VERIFIED, `neoforge/README.md`). The Paper cards as first written put their logic in Bukkit classes in `plugin/core`, which NeoForge cannot use. **Applied in the W8 cards (2026-11-18):** AN-47a carries A2 (`combatJson`) and A3, AN-51a carries A2 (`takeJson`) and A4 ([../harness/work-packets-sheet-w6-w8.md](../harness/work-packets-sheet-w6-w8.md)). A1, A2 (`breakJson`, `pickupJson`), A4, A6 and A7 belong to the W5 cards (AN-24, AN-25, AN-26a, AN-27a), whose file is owned elsewhere; the twin cards check for each item and **stop** if it is missing. A1, A2 and A4 matter on NeoForge only for the v2 provenance cards (0329 Q1: not needed for v1); they are harmless on Paper either way.

| Id | Card | Amendment (exact shapes the twins rely on) |
|---|---|---|
| A1 | AN-27a | Create `ProvenanceSink` in core-common, not in `plugin/core`: file `plugin/core-common/src/main/java/dev/geldar/core/provenance/ProvenanceSink.java`, `package dev.geldar.core.provenance; public interface ProvenanceSink { void send(String tail, String json); }`. `NatsBlockOwnerLink` (already core-common) implements it, as the card says. |
| A2 | AN-27a, AN-26a, AN-47a, AN-51a | Build each provenance JSON in one Bukkit-free class: `plugin/core-common/src/main/java/dev/geldar/core/provenance/ProvenanceJson.java` with `public static String breakJson(String world, int x, int y, int z, String actor, String priorOwner, String block, long tick)`, `public static String pickupJson(String world, String picker, String thrower, String item, int count, int ageTicks, Double distance, long tick)`, `public static String takeJson(String world, int x, int y, int z, String actor, String priorOwner, String item, int count, long tick)`, `public static String combatJson(String world, String actor, String target, String kind, long tick)`. Each writes the AN-24 / AN-46 `Provenance` field names, with `"kind"` set (`break`, `pickup`) as the AN-24 shape requires; a null argument is written as JSON `null`. The Paper listeners call these. |
| A3 | AN-47a | Put the encounter logic and the hostile list in core-common: `plugin/core-common/src/main/java/dev/geldar/core/combat/EncounterTracker.java` and `HostileMobs.java`, with the shapes in the twin file's "Shapes the twins rely on". The encounter key is `enc:<life_id>:<mob_uuid lowercase>` and the `combat_fact` payload is `{ life_id, kind, mob, encounter_key }` (AN-46, 0321). `CombatFactListener` (Bukkit) only reads events and calls the tracker. |
| A4 | AN-27a, AN-51a | Read one block's prior owner from the cache in one Bukkit-free method: `plugin/core-common/src/main/java/dev/geldar/core/provenance/PriorOwner.java`, `public static String of(OwnerCache cache, OwnerCache.Pos pos)`: `freshBase(chunkOf(pos))`, then `withChanges`, then the owner of the matching `OwnedBlock`; `null` on a missing or truncated base or no match; never a CoreProtect call. (AN-27a forbids editing `OwnerCache.java`, so this is a new class, not a method on the cache.) |
| ~~A5~~ | AN-25 | **Withdrawn (0329 NF-2).** It said `observedActor` returns null for a username that `lifeIdFor` does not map to a `LifeId`. Besides naming no human, it could never trigger: `lifeIdFor` (`golem/src/registry.ts:51`, VERIFIED) maps every username to a `LifeId`-shaped value, hashing any other name into `ag_<stem><hash>_01`. |
| A6 | AN-24 | `ObservedActor` in `contract/schemas/observation-event.schema.json` becomes a `oneOf` of two `$defs`: `LifeActor` (exactly AN-24's object: required `name` (`ActorName`) and `life` (`common.schema.json#/$defs/LifeId`), `additionalProperties: false`) and `PlayerActor` (required `kind` (const `player`) and `name` (`ActorName`), `additionalProperties: false`). A `LifeActor` is byte-identical to AN-24's shape, so every Paper payload validates unchanged. Exact text: twin card AN-NF-25 step 1. |
| A7 | AN-25 | `observedActor(bot, username, lifeIdOf = lifeIdFor, naming: ActorNaming = 'life')` with `export type ActorNaming = 'life' \| 'named'`. `'life'` (the default, Paper) is AN-25 exactly. `'named'` (NeoForge, passed by the NeoForge Body wiring once NF-BODY exists) returns `{ name: username, life: username }` when `username` matches the `LifeId` pattern, else `{ kind: 'player', name: username }`; it never invents a life id. The visibility rule (`findVisibleAgent`) is the same in both modes. Exact text: twin card AN-NF-25 step 3. |

A finding for the Paper card (not ruled here): AN-25 as written gives a managed life (`ag_` plus 1 to 12 characters, `golem/src/players/managed-config.ts`) a hashed life id that names no life (`lifeIdFor('ag_kestrel')` is `ag_agkestre<hash>_01`), because a managed id is not a contract `LifeId`. That is a Paper question for the AN-25 owner (the orchestrator), separate from NeoForge.

## 3a. NF-1: what survives "only what the agent itself saw"

The rule (0329 NF-1): an agent is told nothing it did not natively see through its own viewport; a human it saw acting is named as any actor. On Paper the provenance design already filters by sight (AN-26b, AN-27b): the plugin publishes every break and pickup on the shard to Bodies, and each Body keeps only what concerns it and what it can see. Two things in it go beyond the agent's own sight: the **unattributed** observations ("Someone broke one of your blocks" while the breaker was not seen; "You received 3 bread" from a thrower who was not seen), whose "someone" and "received" the agent did not witness, and the attribution itself, which comes from the server's record rather than from what the Body saw happen. On Paper that stays as written. On NeoForge the table below applies.

| Feed | Survives on NeoForge (NF-1) | Does not survive | What the Body derives itself (no provenance) |
|---|---|---|---|
| **break** (AN-27a, AN-27b: `property_broken`) | An observation only when the Body saw the cell change (within 24 blocks and in line of sight, AN-27b's rule) **and** saw the breaker at that moment (visible, `findVisibleAgent`). The breaker is named, human or agent (NF-2, A7). The block counts as the Body's own when the Body placed it, or when its owner record names the Body (P4; NF-6) | The unattributed break (breaker not seen). The block's absence still reaches the agent through its own perception of the world | The change: the block update in view (mineflayer `blockUpdate`, VERIFIED in use at `golem/src/actions/own-placements.ts`). Own block: the Body's in-memory own-placement records (same file; lost at restart) or its owner cache (`golem/src/body/block-owners.ts`, needs P4). The breaker: the break-progress packet names the breaking entity (mineflayer `blockBreakProgressObserved`, UNVERIFIED for mineflayer 4.39 and for whether NeoForge sends it to a watching player); an instant break sends no progress, so it gives no breaker |
| **pickup** (AN-26a, AN-26b: `gift_received`) | An attributed gift only: the Body saw the thrower toss the stack (the thrower visible and within `GIVE_REACH + 3` when the item appeared) and picked it up itself. The thrower is named, human or agent | The unattributed gift (thrower not seen). The pickup itself already reaches the agent through its own inventory and pickup outcomes | The pickup: `playerCollect` with the Body as collector (VERIFIED in use at `golem/src/actions/give-pickup.ts` and `pickup.ts`). The toss: an item entity that spawns at a visible player's position (mineflayer `entitySpawn`); linking the item to that player is a Body heuristic, because the protocol does not send an item's thrower to clients (UNVERIFIED) |
| **take** (AN-51a, AN-51b) | Nothing: inactive on NeoForge (NF-3) | All of it; AN-NF-51a Dropped | The agent notices a theft itself (its chest's contents in its own view) |
| **combat facts** (AN-47a: `combat_fact`) | All of it. A `combat_fact` is XP evidence for the eventsink and is never agent-visible, so NF-1 does not bind it. Lives only, because the fact is keyed by `life_id` (AN-46), not for privacy | Nothing | n/a |
| **combat provenance** (AN-47a `engaged`, `killed`: AN-47c `fight_seen`) | A visible fight, from the Body's own perception | The server-sourced `engaged` and `killed` messages: removed from AN-NF-47a | The damage packet names the source entity (`entityHurt` with its cause, VERIFIED for the Body's own hurts in `golem/src/perception/hurt-trigger.ts`; UNVERIFIED that mineflayer 4.39 passes the cause for another entity's hurt), and a death is seen (`entityDead`). Both entities visible gives "X fought a zombie" |
| **own hurt** (AN-25: `hurt` with `actor`) | All of it: the damage packet is the Body's own perception, the attacker named only when visible, human or agent (NF-2) | Nothing | Already Body-derived |

**0329 Q1, answered 2026-11-18 (operator): skip the provenance feed for v1; the Body derives observations itself; raise its priority for v2.** The "Survives" column above is what a v2 feed may carry; in v1 no break or pickup provenance exists on NeoForge. The analysis that was put to the operator:

- What the feed would add under NF-1: (a) the breaker of a break the Body watched when no break-progress packet arrived (an instant break) while the breaker stood in view; (b) which of several visible players tossed a stack; (c) the owner of a Body's block placed before its current session, which P4's owner query also answers. Each is a case where the Body saw the event and the actor, and the server only says which of the things it saw goes with which.
- What it costs: the 0383 widening (`neoforge` publishes `geldar.<s>.provenance.>`), which this note does not write; NF-BODY grants for a Body subscription; and a Body process that receives every break and pickup on the shard, out of sight included, which the leakage gate must then keep from the agent. That last point is exactly what NF-1 forbids at the agent, held back one layer below it.
- The sheet campaign proposed: not needed for v1.

The outcome:

- **v1.** AN-NF-26a, AN-NF-27a and AN-NF-28b are **Deferred to v2 (0329 Q1: not needed for v1)**. They are kept in full in the twin file and are not dispatched in v1. The 0383 widening (`geldar.<s>.provenance.>` for `neoforge`) is not written. The NeoForge rows `gave_me` and `took_mine` (from `property_broken`) get no input; section 3b is the cost.
- **Body-derived cards.** AN-NF-26b-native, AN-NF-27b-native and AN-NF-47c-native are **not written**; the names stay reserved for a Body-derived path (section 3b says what each could cover, all UNVERIFIED).
- **v2 (revisit, raised priority).** Dispatching the deferred cards needs: a 0383 amendment and a grant card (AN-NF-28b's NATS steps, removed from that card); a Body option that drops the unattributed results on NeoForge for AN-26b and AN-27b (a new card, not written); P4's `provenanceSink()` (section 4 item 1) and its break-order statement (section 4 item 5).

## 3b. What v1 loses on NeoForge (0329 Q1)

The social model (W6, [work-packets-sheet-w6-w8.md](../harness/work-packets-sheet-w6-w8.md) HC-27a) learns four fields of another agent or player from observations: `curiosity`, `aggression`, `law`, `good`. `common_sense` and `cleverness` are never learned on either shard. Rule values are HC-27a's `OBS_RULES`; event kinds are HC-27b's event table.

**Rows, Paper versus NeoForge v1:**

| HC-27a row {field evidence} | Source (Paper) | NeoForge v1 | Why |
|---|---|---|---|
| `gave_me` {good 4.5} | `gift_received` (AN-26b over AN-26a pickup provenance) | **Lost** | AN-NF-26a deferred to v2 (Q1) |
| `took_mine` from a break {law 1.5, good 2.0} | `property_broken` (AN-27b over AN-27a break provenance) | **Lost** | AN-NF-27a deferred to v2 (Q1) |
| `took_mine` from a take {law 1.5, good 2.0} | `container_taken` (AN-51b over AN-51a; HC-27c) | **Lost** | NF-3 (AN-NF-51a Dropped); not a Q1 effect |
| `fought_mob` {aggression 4.5} | `fight_seen` (AN-47c; HC-27c) | Inactive | Inactive on Paper too until HC-27c; on NeoForge also no source (AN-NF-47a sends no combat provenance; AN-NF-47c-native not written) |
| `spoke_first` {curiosity 4.0} | `speech_to_me` | Inactive until NF-CHAT | Without proximity chat a Body hears speech from any distance (NF-5); not a Q1 effect |
| `approached` {curiosity 3.5}, `kept_away` {curiosity 2.5} | Body distance samples (HC-27b; positions from HC-46) | **Kept** | Body sightings, shard-neutral |
| `hit_me` {aggression 4.5} | `hurt` with a visible actor (AN-25) | **Kept** (after AN-NF-25) | The Body's own hurt; a human attacker is a `PlayerActor`, keyed by name (NF-2) |
| `fled_mob`, `kept_promise`, `broke_promise` | none | Inactive | Inactive on both shards |

**Fields, Paper versus NeoForge v1:**

| Field | Paper v1 evidence | NeoForge v1 evidence |
|---|---|---|
| `curiosity` | `spoke_first`, `approached`, `kept_away` | `approached`, `kept_away` (plus `spoke_first` once NF-CHAT is on) |
| `aggression` | `hit_me` (plus `fought_mob` after HC-27c) | `hit_me` (after AN-NF-25) |
| `law` | `took_mine` (break; take after HC-27c) | **none** |
| `good` | `gave_me`, `took_mine` | **none** |
| `common_sense`, `cleverness` | none (prior) | none (prior) |

**On NeoForge in v1 the `good` field gets no evidence at all, and `law` gets none.** Both stay at their prior with `n = 0` for every other agent and every human: `estimateOf` returns `priorFor(f, own)` = `3 + 0.25 * (5 - own.common_sense) * (own[f] - 3)`, clamped 1 to 5, `supported: false` (HC-27a; `PRIOR_STRENGTH` 2 never applies, because no evidence is ever applied). What that means downstream, exactly as the cards are written:

- **Predictions (HC-28a).** `estimatedScores` passes that prior to `predict`, so any prediction that reads another's `law` or `good` uses the observer's own projection ("they are like me", pulled toward 3 by the observer's common sense), the same value for everyone it meets. It is not the stranger policy.
- **Stranger policy (HC-28b).** It does not read another's `law` or `good`: `approach = (curiosity-3) + (good-3) + 0.5*socialProficiency` uses the observer's **own** curiosity and good, and `threat = estAggression - own aggression` uses the learned aggression, which `hit_me` still feeds. So the stranger step works the same on NeoForge; it never had law or good evidence to lose.
- **Prose (HC-29).** A field is shown only when `n >= 1`, so no `law` or `good` line ever reaches a NeoForge agent in v1.

**Body-derived paths that could cover part of it** (not written; names reserved; every signal UNVERIFIED, section 8 item 8):

| Reserved card | Could restore | Body signal | UNVERIFIED |
|---|---|---|---|
| AN-NF-26b-native | part of `gave_me` (`good`) | An item entity spawns (`entitySpawn`) at a visible player within `GIVE_REACH + 3`, and the Body collects it (`playerCollect`, VERIFIED in use) | The protocol sends no thrower, so the link is a heuristic; several visible players make it ambiguous; an item dropped by accident would count as a gift |
| AN-NF-27b-native | part of `took_mine` from a break (`law`, `good`) | A block update in view (`blockUpdate`, VERIFIED in use) on a cell the Body placed this session (or, with P4, whose owner names the Body), with the breaker from `blockBreakProgressObserved` | The mineflayer 4.39 event, and whether NeoForge sends break progress to a watching player; an instant break names no breaker; own-placement records are lost at restart without P4 |
| AN-NF-47c-native | `fought_mob` (`aggression`), once HC-27c is on | `entityHurt` with its cause for another entity, then `entityDead` | Whether mineflayer 4.39 passes the cause for another entity's hurt |
| none | `took_mine` from a take | none (NF-3) | n/a |

**XP (W8) is unaffected.** No XP row reads pickup or break provenance on either shard (W8 evidence table, AN-50b). Combat XP pays one key per encounter from the Body's kill record (AN-47b) and AN-NF-47a's `combat_fact` (0321), both still planned on NeoForge. Social XP for a give (`give:<action_id>`) is the Body's own action. W2's farming, mining, building, crafting and exploring rows are Body-produced (`action`, `intent`, `chunk_visited`). The social exchange award (AN-49) is inactive on NeoForge until NF-CHAT (NF-5), which is not a Q1 effect.

v2 priority: the deferred provenance cards (section 3a, outcome) restore `gave_me` and the break half of `took_mine`, and with them all NeoForge evidence for `good` and `law`.

## 4. What P4 must provide for the sheet

P4 (the NeoForge block-owner log) has no design note yet. For the twins to wire without guessing, P4 should expose, in `neoforge/src/main/java/dev/geldar/neoforge/`:

1. A class `NeoForgeBlockOwners` with `public OwnerCache cache()` (the core-common `OwnerCache`, filled from the NeoForge owner log the way Paper fills it from CoreProtect). Only for v2 (0329 Q1: not needed for v1; P4 need not provide it now): also `public ProvenanceSink provenanceSink()` (a core-NATS publisher on `geldar.<shard>.provenance.<tail>`, accepting only the tails `break`, `pickup`, `combat`). Both may return null when the block-owner feature is off.
2. The Paper world names (decision 0164; the Body maps `overworld` to `world`, `the_nether` to `world_nether`, `the_end` to `world_the_end` in `golem/src/body/block-owners.ts`). AN-NF-00 adds the same mapping in `WorldNames.java`; P4 should use it so `OwnerCache.Pos.world` and the Body agree.
3. **Human owners are logged by name, like agent owners (0329 NF-6).** A human's placement is recorded with the human's player name as the owner (`ServerPlayer#getGameProfile().name()`, VERIFIED compile in `NeoForgeFacts.java`; its runtime value behind Velocity is a P0 open item). There is no placeholder value and no anonymous owner. The name fits `OwnerId` (`contract/schemas/block-owner.schema.json`: "The placer's agent or player id. Opaque", 1 to 64 characters, VERIFIED), so the contract does not change. A Body then treats the block as someone else's (`golem/src/actions/protected-blocks.ts`), as for an agent owner. The agent-facing refusal text names no owner ("that block is someone else's work", `golem/src/actions/edit-sign.ts`, VERIFIED), so no owner name reaches an agent through it.
4. Its NATS rows in `deploy/nats-auth-nf.ps1`: `neoforge` answers `geldar.<s>.blockowner.query` and publishes `blockowner.changed`. No provenance row (0329 Q1: not needed for v1; v2 would need a 0383 amendment).
5. **Read before write on a break** (v2 only: it binds AN-NF-27a and AN-NF-28b, Deferred to v2 by 0329 Q1; P4 need not meet it for v1, but stating its choice now saves v2 a P4 change). Paper's AN-27a reads the prior owner *before* the cache records the break. On NeoForge the sheet's break listener runs at `EventPriority.LOWEST` (so a cancelled break is skipped), so P4 must record its own break change in the cache after that listener has run: a P4 break listener at `LOWEST` registered after `EvidenceSetup.install`, or P4 recording the change on the next server tick. Registration order inside one priority on the 26.1 bus is UNVERIFIED. P4's README must state which it does; AN-NF-28b checks for that statement and stops without it.

If P4 chooses other names, the twins' step 0 stops and the orchestrator updates the twin cards.

## 5. Prerequisites outside the campaign, and owner decisions

Prerequisites (each is a NeoForge-campaign or ops item, not a sheet card):

| Id | What | Today |
|---|---|---|
| P3-LIVE | P3-6 merged and its scratch run passed: a NeoForge export event reaches the NeoForge stream. **Merge gate of every twin** (0322) | P3-1 to P3-4 merged as code; P3-5, P3-6 not in the repo; `live: pending` |
| P4 | NeoForge block-owner log, with section 4. **Merge gate of every twin** (0322) | On hold, no design |
| NF-BODY | A Body NATS role in the NeoForge auth set and an owner decision to run sheet Bodies on `geldar-nf`; the username shape of NeoForge Bodies | `body` is the P0 probe only |
| NF-SINK | The NeoForge eventsink with the sheet wiring (AN-12b's equivalent) | UNVERIFIED |
| NF-CHAT | Proximity chat on NeoForge (spec 5.8), cards NF-CHAT-0 to NF-CHAT-3, owned by the NeoForge campaign ([neoforge-chat-plan.md](neoforge-chat-plan.md)). Blocks HC-27b `spoke_first` and AN-49 on NeoForge | Not started; chat names are forbidden in `neoforge/src/main` by `NoRegistryScanTest` until NF-CHAT-0 narrows the ban |

Owner decisions. OD-NF-1 to OD-NF-6 are **ruled by decision 0329 (Proposed; pending the operator's acceptance)**; OD-NF-7 is answered by 0322; OD-NF-8 stays open.

| Id | Question | Ruling or state | Cards |
|---|---|---|---|
| OD-NF-1 | On the human-directed shard, a human breaks an agent's block, gives an agent an item, or takes from an agent's container: blank the human's name, or send nothing? | **Ruled by 0329 NF-1 (pending acceptance):** no blanking; an agent is told only what it saw itself, and a human it saw acting is named. Section 3a says what survives. The provenance feed is skipped for v1 (0329 Q1, answered 2026-11-18; v2 priority; cost in section 3b) | AN-NF-26a, 27a, 28b (Deferred to v2) |
| OD-NF-2 | May a Body name a visible human attacker in a `hurt` observation? | **Ruled by 0329 NF-2 (pending acceptance):** yes, the attacker is named, human or agent; A5 withdrawn; A6, A7, AN-NF-25 | AN-24, AN-25, AN-NF-25 |
| OD-NF-3 | Container-take detection on NeoForge (no click-level event in the verified set), or keep it inactive? | **Ruled by 0329 NF-3 (pending acceptance):** inactive on NeoForge; the agent notices a theft itself. AN-NF-51a Dropped | AN-NF-51a (Dropped) |
| OD-NF-4 | Kill credit on NeoForge: the death source's player (killing blow) versus Paper's last damager within a window? | **Ruled by 0329 NF-4 (pending acceptance):** accepted. A mob that dies of a fall after a player's hit gives no kill on NeoForge; on Paper it does | AN-NF-47a |
| OD-NF-5 | Proximity chat on NeoForge, or the speech rows stay inactive? | **Ruled by 0329 NF-5 (pending acceptance):** NF-CHAT is planned ([neoforge-chat-plan.md](neoforge-chat-plan.md)); HC-27b `spoke_first` and AN-49 stay inactive on NeoForge until it merges and is on | HC-27b, AN-49, NF-CHAT-0 to 3 |
| OD-NF-6 | Human owners in the NeoForge block-owner log | **Ruled by 0329 NF-6 (pending acceptance):** logged by name, like agent owners; no placeholder (section 4 item 3) | P4 |
| OD-NF-7 | Does the sheet campaign include the NeoForge shard at all? | **Answered yes (decision 0322, 2026-11-18):** inert code, merged but off, each twin merging after P3-LIVE and P4; activation follows the held-live ruling on each shard | all twins |
| OD-NF-8 | Progression and proficiency (section 7) | **Open**, no recommendation here. The human side is answered for this version only (0329 Q7, 2026-11-18): humans do not earn or hold marks in v1, agents still earn marks; 0385 item 8 stands for now. How progression and sheet proficiency relate is still open | P6 to P8, AN-10a |

The questions from 0329 (Q1 to Q7) are listed in that record. Q1 (provenance) and Q7 (progression for humans) were answered on 2026-11-18; Q2 to Q6 are open. Q2 (actor names with a marker word) binds cards in this campaign.

## 6. NeoForge event candidates for each twin

| Twin | Paper source | NeoForge candidate | Tag |
|---|---|---|---|
| AN-NF-27a | `BlockBreakEvent` (MONITOR, `ignoreCancelled`), `getPlayer()`, `getBlock()` | `net.neoforged.neoforge.event.level.block.BreakBlockEvent`: `getLevel()`, `getPos()`, `getPlayer()`, `getState()`, `isCanceled()`; block id `getState().getBlock().builtInRegistryHolder().key().identifier()` | VERIFIED (compiled in `neoforge-ledger/.../curated/McReaders.java`). Fires on both sides: check `!getLevel().isClientSide()` (VERIFIED, same file). It can arrive already cancelled ([../neoforge/neoforge-api-notes.md](../neoforge/neoforge-api-notes.md) section 2) |
| all twins | MONITOR priority, skip cancelled | `NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, false, Class, Consumer)` | UNVERIFIED overload on the 26.1 bus; the twins compile against it and stop if it does not exist |
| AN-NF-26a | `EntityPickupItemEvent`, `Item#getThrower()` (UUID), `getTicksLived()` | `net.neoforged.neoforge.event.entity.player.ItemEntityPickupEvent.Post`: `getPlayer()`, `getItemEntity()`, `getOriginalStack()`, `getCurrentStack()`; thrower `ItemEntity#getOwner()`; age `ItemEntity#getAge()` | UNVERIFIED (event name, accessors and whether a death drop has an owner) |
| AN-NF-47a | `EntityDeathEvent`, `getKiller()` (last damager within a window) | `net.neoforged.neoforge.event.entity.living.LivingDeathEvent`: `getEntity()`, `getSource()`; killer `getSource().getEntity()` (the killing blow, NF-4) | Event and `getSource()` VERIFIED (`neoforge/.../ExportListeners.java`); `DamageSource#getEntity()` UNVERIFIED |
| AN-NF-47a | `EntityDamageByEntityEvent` (encounter open, engaged) | `net.neoforged.neoforge.event.entity.living.LivingDamageEvent.Post`: `getEntity()`, `getSource()` | Event VERIFIED (same file); `getSource().getEntity()` UNVERIFIED |
| AN-NF-47a | scheduler tick (encounter timeout) | `net.neoforged.neoforge.event.tick.ServerTickEvent.Post`: `getServer()` | VERIFIED (same file) |
| AN-NF-47a | mob type, entity UUID | `getType().builtInRegistryHolder().key().identifier()`, `getUUID()` | UNVERIFIED for `EntityType` (the holder pattern is VERIFIED for blocks and items only) |
| all twins | player name | `ServerPlayer#getGameProfile().name()` | VERIFIED (`neoforge/.../NeoForgeFacts.java`); its runtime value behind Velocity is a P0 open item |
| all twins | dimension | `level.dimension().identifier().toString()` | VERIFIED compile (`NeoForgeFacts.java`); runtime strings UNVERIFIED |
| all twins | tick | `MinecraftServer#getTickCount()` | VERIFIED compile (`NeoForgeFacts.java`). It is the server tick count, not Paper's overworld game time (difference recorded; the provenance `tick` is only a key part and an order) |

## 7. Progression (P6 to P8) and the sheet's proficiency: an open question

This section states the overlap. It rules nothing. Decision 0385 (progression as a per-shard flag that relaxes Principle 2) is **Proposed, not accepted**; P6 to P8 are on hold.

What the records say:

- **Decision 0280 (Accepted)** fixes seven proficiency domains, levels 0 to 3, `version` as total XP, and the state subjects. The eventsink is the only XP writer: AN-10a's exactly-once ledger (`xp_evidence`, unique per life, domain and evidence key) and AN-10b's publication. The levels feed the roll engine as `prof` (D-CS-05) and are never shown to an agent as numbers (sheet blindness rules, W3-W5 R11).
- **[progression-defaults.md](../neoforge/progression-defaults.md) Q3** (proposal under the owner's delegation, adopted as proposals by 0385 item 2): `proficiency-state` is the only skill and XP signal; progression's award engine "writes XP into the seven existing domains" and unlocks read the levels 0 to 3; professions map to domains; **combat is never awarded**.
- **[progression-design.md](../neoforge/progression-design.md)** awards points from novelty and usefulness with decay and caps, in a Java engine with saved data on the server, and shows the agent its level, points and limits as MCP text (section 8.2).

Where they meet, as questions for the owner:

1. **Who writes XP?** If progression writes into the seven domains, does the mod publish evidence events that the eventsink's normalisers turn into awards (one writer, the sink), or does the mod's own engine write XP (two writers on one ledger, which AN-10a's exactly-once design does not allow for)?
2. **Which award rules?** The sheet's D-CS-04 matrix (one award per accomplishment, keyed for uniqueness, no decay) and progression's novelty and usefulness model (decay, daily caps, anti-collusion weights) give different XP for the same play. One domain value cannot follow both.
3. **Combat.** The sheet awards combat XP once per encounter (0321: the Body's kill row in `eventsink/src/xp/awards.ts` and the `combat_fact` row share the key `enc:<life_id>:<mob_uuid>`, AN-47b). Progression's defaults say combat is never awarded. On a shard with both, which holds?
4. **Visibility.** The sheet never shows proficiency levels to an agent; progression shows level, points and limits as tool text. If both read the same `proficiency-state`, showing it on NeoForge would expose to agents a number the sheet treats as hidden.
5. **Scale.** Progression's level table runs 0 to 8 over 0 to 2600 points; the domain scale is 0 to 3. progression-defaults Q3 notes the thresholds would be re-derived.
6. **Scope.** OD-NF-7 is answered yes as inert code (0322), so questions 1 to 5 will arise on the NeoForge shard the day its sheet code is activated; while it is off they do not bind behaviour. The shared contract binds both shards either way: a second meaning of `xp` in the same schema would change 0280.
7. **Humans (0329 Q7, answered 2026-11-18 for this version only).** Humans do not earn or hold marks in this version; agents still earn marks. This is a v1 scope ruling, not a statement that humans never will. 0385 item 8 stands for now; items 3 and 4 are per-life rules and are unaffected. 0387 item 6 says humans earn nothing and cites "0385 items 3 and 4"; in 0385 as written that rule is item 8, and items 3 and 4 are "agents see only their own marks" and "a starter stipend" (citation left for the operator). The analysis put to the operator: progression is an encouragement mechanism that gives agents the feedback humans get from playing, which fits humans earning nothing; but marks are also an in-world medium (contracts, trade), where a human who cannot hold marks is not an equal partner. Questions 1 to 6 (OD-NF-8) stay open.

Nothing in the twin cards depends on these answers: the twins produce combat facts only (provenance is deferred to v2, 0329 Q1), and award nothing themselves.

## 8. UNVERIFIED claims in this note (for an owner or node check)

1. Every NeoForge name in section 6 tagged UNVERIFIED (pickup event and accessors, `DamageSource#getEntity`, the `EntityType` holder id, the four-argument `addListener` overload).
2. That a Body on NeoForge hears chat from any distance (no NeoForge run with chat has been done).
3. That the `geldar-nf` compose project carries the sheet sink wiring (NF-SINK).
4. That the NeoForge extra mods add no entities, so the vanilla hostile list holds.
5. That a vanilla death drop on NeoForge has no `ItemEntity` owner (AN-26a's "no message for a death drop").
6. The runtime values of the profile name behind Velocity and of the dimension id strings (P0 open items, `NeoForgeFacts.java` javadoc).
7. Remote state of the `psyche-v1.1.0` tag and of the kit's `scriptorium/hw0` branch (not checked).
8. Section 3a's Body-side signals: mineflayer 4.39's `blockBreakProgressObserved` (and whether a watching player gets the break-progress packet from NeoForge), `entityHurt` with a cause for another entity's hurt, and that the protocol sends no item thrower to clients.
9. The username shape of NeoForge Bodies (NF-BODY): whether every one matches the contract `LifeId`, or some use the managed `ag_` shape.
10. Whether the MCP's visible-agents list filters names with `markedWords` (0329 Q2).
