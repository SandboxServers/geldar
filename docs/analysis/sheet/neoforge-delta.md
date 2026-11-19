# Sheet campaign on NeoForge: the delta

Status: planning note, docs only, 2026-11-18, against `origin/main` = `a8063b0a`. The owner chose "delta packets": the existing sheet cards stay as written for the Paper shard, and every card whose world side is Paper-specific gets a NeoForge twin card, blocked on its NeoForge prerequisite. This note says which cards need a twin and why; the twins themselves are in [../harness/work-packets-sheet-neoforge.md](../harness/work-packets-sheet-neoforge.md). It edits no card, no decision and no code.

Tags, as in [../neoforge/p3-adapter-design.md](../neoforge/p3-adapter-design.md): **VERIFIED** = read in this repo (path given), or a class name that a merged NeoForge module compiles against NeoForge 26.1.2 (build 126). **UNVERIFIED** = needs a GameTest, a first server run, a node check, an owner answer, or a source read this note did not do. A NeoForge name is VERIFIED here only when merged code under `neoforge/` or `neoforge-ledger/` already compiles against it.

## 1. What is platform-neutral and what is not

**Neutral (one code path serves both shards):**

- **The Body** (`golem/`). It is a vanilla-protocol client (mineflayer). P0 proved a golem Body joins a NeoForge 26.1.2 server behind Velocity with Proxy Compatible Forge 1.3.1, walks and mines ([../neoforge/RESUME.md](../neoforge/RESUME.md), runs 6 to 8b). Its perception reads packets, not server events. Exception: perception that reads a **plugin-served** subject or a **server-side chat filter** is only neutral if NeoForge serves the same thing (below).
- **The contract** (`contract/`), **psyche** (`psyche/`), **the eventsink** (`eventsink/`, including `eventsink/src/xp/` and `eventsink/src/state/`), **SQL** (`sql/`), **the MCP** (`threshold/`, `player-core/`), **the kit** (repo `geldar-scriptorium`). They read NATS subjects and WorldEvents whatever produced them.
- W2's XP sources are all Body-produced: `action`, `intent` and `chunk_visited` (`eventsink/src/xp/awards.ts`, VERIFIED). No W2 XP row depends on a Paper event.

**Platform-bound (Paper today, nothing on NeoForge yet):**

| Surface | Paper source (VERIFIED path) | NeoForge today |
|---|---|---|
| WorldEvents `damage`, `death`, `sleep`, `server_tps` | `plugin/core/.../EventExporter.java` | Merged: `neoforge/.../ExportListeners.java`, `ExportHandlers.java`, `EventMapping.java` (P3-3). Scratch proof `live: pending` (`neoforge/README.md`) |
| Block ownership: `geldar.<shard>.blockowner.query` (reply) and `blockowner.changed` (decision 0165) | `plugin/core/.../blockowner/BlockOwnerSetup.java`, `BlockChangeListener.java`; core-common `NatsBlockOwnerLink`, `OwnerCache`, `CoreProtectOwnerSource` | None. P4 (own block-owner log) is on hold and has no design note. Every Body ownership read on NeoForge answers `known: false` (`golem/src/body/block-owners.ts`: a failed query is unknown) |
| Proximity chat (spec 5.8, decision 0199: speech reaches only players within 32 blocks; "There is no global chat") | `plugin/core/.../proximity/ProximityChatListener.java` | None. P3 put chat out of scope, and `NoRegistryScanTest` forbids chat event names in `neoforge/src/main` (decision 0375, Proposed). So on NeoForge a Body hears whatever vanilla chat delivers (UNVERIFIED: no NeoForge run with chat) |
| Provenance subjects (W5, W8; not built on either platform yet) | Planned in `plugin/` by AN-26a, AN-27a, AN-47a, AN-51a | Needs the twins in this note |

**Shard facts that change the world side on NeoForge** (all VERIFIED as written records; their status is Proposed unless stated):

- **Per-shard storage** (0380, 0381): the NeoForge shard has its own NATS, database (`geldar_nf`) and eventsink; stream `GELDAR_EVENTS_NF`, subjects `geldar.nf.*`. Each NeoForge database runs every migration from empty, so the sheet tables (`sql/0050` to `0052`) exist there once migrated.
- **NeoForge NATS users** (0383, `deploy/nats-auth-nf.ps1`): the mod's user `neoforge` may publish `geldar.<s>.*` (three tokens) only. The `body` user is the P0 probe's only (one registry key); the file says real Bodies on `geldar-nf` "will need their own role and a later owner decision". So **no sheet Body can run on the NeoForge shard today**: it cannot publish its events, request its proficiency state or hear level pushes.
- **Human-directed shard** (0387, Proposed): humans play on the NeoForge shard. The merged NeoForge export already writes no human name: `player` and `agent_id` are set only for a life id (`EventEnvelope.isLifeId`, pattern `^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$`), and a human's event is written anonymously (`neoforge/README.md`, Privacy). Every twin card keeps that rule: **no human name leaves the NeoForge server** in any message.

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
| HC-27a, HC-28a/b, HC-29, HC-30a/b | Neutral |
| HC-27b observation reader | Neutral, degraded: its `spoke_first` row reads `speech` with `to_me`; on NeoForge, without proximity chat, a Body hears speech from any distance (NF-CHAT). Its `hit_me`, `gave_me`, `took_mine` rows need the W5 twins |

### W5

| Card | World side | NeoForge verdict |
|---|---|---|
| AN-24 observed-actor contract | contract | Neutral |
| AN-25 visible attacker identity | Body (`golem/src/perception/hurt-trigger.ts`: cause entity from the damage packet) | Neutral code. NeoForge question: a visible **human** attacker. `observedActor` builds `{ name, life: lifeIdFor(username) }`; a human has no life id. Amendment A5 (section 3) and OD-NF-2 |
| AN-26a pickup provenance | **plugin** (`EntityPickupItemEvent`, `Item#getThrower()`) | **Twin AN-NF-26a** |
| AN-26b gift observation | Body | Neutral (reads provenance, whatever produced it) |
| AN-27a break provenance | **plugin** (`BlockBreakEvent`, prior owner from `OwnerCache`) | **Twin AN-NF-27a**; needs P4 to have a populated owner cache |
| AN-27b property-break observation | Body | Neutral, degraded: without P4, `prior_owner` is always null on NeoForge, so it never delivers |
| AN-28a delivery path | MCP | Neutral |
| AN-28b wiring, plugin setup, ACL, leakage gate | Body + leakage test (neutral); `BlockOwnerSetup.java` and `geldar.ps1` (Paper) | **Twin AN-NF-28b** for the mod setup and the NeoForge NATS rows (`deploy/nats-auth-nf.ps1`); the Body half needs NF-BODY |

### W7

| Card | NeoForge verdict |
|---|---|
| AN-44, AN-45 (contract, registration, body-api) | Neutral |
| AN-39 explore | Neutral (loaded columns are protocol data) |
| AN-40 farm | Neutral, degraded: a cell is farmed only if own or world-generated (`ownerRecordAt` known with owner null). Without P4 every cell that is not the Body's own placement is `known: false` and counted `skipped_unknown`, so the program farms only its own sowings |
| AN-41 patrol | Neutral |
| HC-31 | Neutral |

### W8

| Card | World side | NeoForge verdict |
|---|---|---|
| AN-46 evidence contract | contract | Neutral |
| AN-47a combat facts | **plugin** (`EntityDeathEvent#getKiller`, damage events) | **Twin AN-NF-47a** (combat facts and combat provenance) |
| AN-47b combat normaliser, visible fight | eventsink, Body | Neutral |
| AN-49 conversation exchange | eventsink over stored `speech` | Neutral code, degraded on NeoForge: the rule "B's Body heard A" assumes proximity chat (NF-CHAT). Without it, every pair of Bodies on the shard could "exchange" |
| AN-51a container-take facts | **plugin** (`InventoryClickEvent`) | **Twin AN-NF-51a**, BlockedDecision: NeoForge has no click-level container event in the verified set (OD-NF-3) |
| AN-51b observed take | Body | Neutral, degraded without P4 (as AN-27b) |
| HC-27c | kit | Neutral |
| AN-50 integration | sink registration (neutral), `GeldarCore.java`, `BlockOwnerSetup.java` (Paper), Body subscription (neutral) | **Twin AN-NF-50** for the mod registration |

### W9 to W12, GX-03

| Card | NeoForge verdict |
|---|---|
| S9-00, S9-01, S9-03 | Neutral |
| S9-02 property refusal | Neutral, degraded: it refuses only when the recorded owner is known and another life; unknown is never refused. Without P4 it never refuses on NeoForge (fail-safe) |
| HC-41 to HC-45 | Neutral |
| S10-01a to S10-04 (lineage, births) | Neutral code; births depend on C4 (Cradle), which has no NeoForge path |
| S11-01 to S11-06 (drift) | Neutral |
| S12-01 exporter, S12-02 to S12-07 | Neutral code; the exporter and cohort runs must name which shard database they read (0380: one database per shard) |
| GX-03 operator sheet read | Neutral (per-shard database) |

Twins in total: AN-NF-00 (unblocker), AN-NF-26a, AN-NF-27a, AN-NF-28b, AN-NF-47a, AN-NF-51a, AN-NF-50.

## 3. Amendments to the Paper cards (so the twins reuse code)

The P3 design rejects copying sources between `plugin/` and `neoforge/` ("drifts", p3-adapter-design section 4.1); `neoforge/` already consumes `plugin/core-common` as a composite build and packs it in its jar (VERIFIED, `neoforge/README.md`). The Paper cards as written put their logic in Bukkit classes in `plugin/core`, which NeoForge cannot use. The orchestrator should amend these cards before W5 and W8 dispatch. The twin cards check for each item and **stop** if it is missing.

| Id | Card | Amendment (exact shapes the twins rely on) |
|---|---|---|
| A1 | AN-27a | Create `ProvenanceSink` in core-common, not in `plugin/core`: file `plugin/core-common/src/main/java/dev/geldar/core/provenance/ProvenanceSink.java`, `package dev.geldar.core.provenance; public interface ProvenanceSink { void send(String tail, String json); }`. `NatsBlockOwnerLink` (already core-common) implements it, as the card says. |
| A2 | AN-27a, AN-26a, AN-47a, AN-51a | Build each provenance JSON in one Bukkit-free class: `plugin/core-common/src/main/java/dev/geldar/core/provenance/ProvenanceJson.java` with `public static String breakJson(String world, int x, int y, int z, String actor, String priorOwner, String block, long tick)`, `public static String pickupJson(String world, String picker, String thrower, String item, int count, int ageTicks, Double distance, long tick)`, `public static String takeJson(String world, int x, int y, int z, String actor, String priorOwner, String item, int count, long tick)`, `public static String combatJson(String world, String actor, String target, String kind, long tick)`. Each writes the AN-24 / AN-46 `Provenance` field names, with `"kind"` set (`break`, `pickup`) as the AN-24 shape requires; a null argument is written as JSON `null`. The Paper listeners call these. |
| A3 | AN-47a | Put the encounter logic and the hostile list in core-common: `plugin/core-common/src/main/java/dev/geldar/core/combat/EncounterTracker.java` and `HostileMobs.java`, with the shapes in the twin file's "Shapes the twins rely on". `CombatFactListener` (Bukkit) only reads events and calls the tracker. |
| A4 | AN-27a, AN-51a | Read one block's prior owner from the cache in one Bukkit-free method: `plugin/core-common/src/main/java/dev/geldar/core/provenance/PriorOwner.java`, `public static String of(OwnerCache cache, OwnerCache.Pos pos)`: `freshBase(chunkOf(pos))`, then `withChanges`, then the owner of the matching `OwnedBlock`; `null` on a missing or truncated base or no match; never a CoreProtect call. (AN-27a forbids editing `OwnerCache.java`, so this is a new class, not a method on the cache.) |
| A5 | AN-25 | State the human rule on every shard: `observedActor` returns null when `lifeIdFor(username)` does not return a value matching `LifeId`. On Paper this changes nothing (no human players, only ghosts). On NeoForge it keeps a human's name out of every observation. Needs OD-NF-2 to confirm. |

## 4. What P4 must provide for the sheet

P4 (the NeoForge block-owner log) has no design note yet. For the twins to wire without guessing, P4 should expose, in `neoforge/src/main/java/dev/geldar/neoforge/`:

1. A class `NeoForgeBlockOwners` with `public OwnerCache cache()` (the core-common `OwnerCache`, filled from the NeoForge owner log the way Paper fills it from CoreProtect) and `public ProvenanceSink provenanceSink()` (a core-NATS publisher on `geldar.<shard>.provenance.<tail>`, accepting only the tails `break`, `pickup`, `take`, `combat`, as AN-27a's link does). Both may return null when the block-owner feature is off.
2. The Paper world names (decision 0164; the Body maps `overworld` to `world`, `the_nether` to `world_nether`, `the_end` to `world_the_end` in `golem/src/body/block-owners.ts`). AN-NF-00 adds the same mapping in `WorldNames.java`; P4 should use it so `OwnerCache.Pos.world` and the Body agree.
3. A ruling on **human owners** (OD-NF-6): a human's placement must not publish the human's name to Bodies (0387 item 7, the NeoForge privacy rule). Whatever P4 publishes in its place, a Body must still treat the block as someone else's (`golem/src/actions/protected-blocks.ts`), not as world-generated.
4. Its NATS rows in `deploy/nats-auth-nf.ps1`: `neoforge` answers `geldar.<s>.blockowner.query` and publishes `blockowner.changed`; the twin AN-NF-28b adds `geldar.<s>.provenance.>`.
5. **Read before write on a break.** Paper's AN-27a reads the prior owner *before* the cache records the break. On NeoForge the sheet's break listener runs at `EventPriority.LOWEST` (so a cancelled break is skipped), so P4 must record its own break change in the cache after that listener has run: a P4 break listener at `LOWEST` registered after `EvidenceSetup.install`, or P4 recording the change on the next server tick. Registration order inside one priority on the 26.1 bus is UNVERIFIED. P4's README must state which it does; AN-NF-28b checks for that statement and stops without it.

If P4 chooses other names, the twins' step 0 stops and the orchestrator updates the twin cards.

## 5. Prerequisites outside the campaign, and owner decisions

Prerequisites (each is a NeoForge-campaign or ops item, not a sheet card):

| Id | What | Today |
|---|---|---|
| P3-LIVE | P3-6 merged and its scratch run passed: a NeoForge export event reaches the NeoForge stream | P3-1 to P3-4 merged as code; P3-5, P3-6 not in the repo; `live: pending` |
| P4 | NeoForge block-owner log, with section 4 | On hold, no design |
| NF-BODY | A Body NATS role in the NeoForge auth set and an owner decision to run sheet Bodies on `geldar-nf` | `body` is the P0 probe only |
| NF-SINK | The NeoForge eventsink with the sheet wiring (AN-12b's equivalent) | UNVERIFIED |
| NF-CHAT | Proximity chat on NeoForge (spec 5.8), or a ruling that the sheet's speech rows stay inactive there | None; chat names are forbidden in `neoforge/src/main` by `NoRegistryScanTest` |

Owner decisions (none is answered; each recommendation is a proposal):

| Id | Question | Recommendation | Cards |
|---|---|---|---|
| OD-NF-1 | On the human-directed shard, a human breaks an agent's block, gives an agent an item, or takes from an agent's container. Send the provenance with the human's name replaced by null (the agent learns "someone did it"), or send nothing? | Null name, as the merged export does for events (`neoforge/README.md`, Privacy). The twins implement this; it ships off | AN-NF-26a, 27a, 51a |
| OD-NF-2 | May a Body name a visible human attacker in a `hurt` observation? | No: A5, the name only for a life id | AN-25 (amendment) |
| OD-NF-3 | NeoForge has no click-level container event in the verified set (`PlayerContainerEvent.Open` and `.Close` only, VERIFIED in `neoforge-ledger/.../curated/McReaders.java`). Detect a take by comparing the container's contents at open and at close (one message per session, per item), or keep container taking inactive on NeoForge? | Inactive on NeoForge until a GameTest shows a slot-level hook | AN-NF-51a |
| OD-NF-4 | Kill credit on NeoForge: the twin credits `LivingDeathEvent#getSource()`'s entity when it is a player. Paper's `getKiller()` credits the last player to damage the mob within a window. Accept the difference? | Accept and record it; a mob that dies of a fall after a hit gives no kill on NeoForge | AN-NF-47a |
| OD-NF-5 | Proximity chat on NeoForge (NF-CHAT), or the speech-based rows (HC-27b `spoke_first`, AN-49) stay inactive on NeoForge? | Inactive on NeoForge until the chat ruling (0375) settles | HC-27b, AN-49 |
| OD-NF-6 | Human owners in the NeoForge block-owner log (section 4 item 3) | A fixed non-life owner value | P4 |
| OD-NF-7 | Does the sheet campaign include the NeoForge shard at all? | Yes as inert code; activation follows the held-live ruling on each shard | all twins |
| OD-NF-8 | Progression and proficiency (section 7) | Open question, no recommendation here | P6 to P8, AN-10a |

## 6. NeoForge event candidates for each twin

| Twin | Paper source | NeoForge candidate | Tag |
|---|---|---|---|
| AN-NF-27a | `BlockBreakEvent` (MONITOR, `ignoreCancelled`), `getPlayer()`, `getBlock()` | `net.neoforged.neoforge.event.level.block.BreakBlockEvent`: `getLevel()`, `getPos()`, `getPlayer()`, `getState()`, `isCanceled()`; block id `getState().getBlock().builtInRegistryHolder().key().identifier()` | VERIFIED (compiled in `neoforge-ledger/.../curated/McReaders.java`). Fires on both sides: check `!getLevel().isClientSide()` (VERIFIED, same file). It can arrive already cancelled ([../neoforge/neoforge-api-notes.md](../neoforge/neoforge-api-notes.md) section 2) |
| all twins | MONITOR priority, skip cancelled | `NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, false, Class, Consumer)` | UNVERIFIED overload on the 26.1 bus; the twins compile against it and stop if it does not exist |
| AN-NF-26a | `EntityPickupItemEvent`, `Item#getThrower()` (UUID), `getTicksLived()` | `net.neoforged.neoforge.event.entity.player.ItemEntityPickupEvent.Post`: `getPlayer()`, `getItemEntity()`, `getOriginalStack()`, `getCurrentStack()`; thrower `ItemEntity#getOwner()`; age `ItemEntity#getAge()` | UNVERIFIED (event name, accessors and whether a death drop has an owner) |
| AN-NF-47a | `EntityDeathEvent`, `getKiller()` | `net.neoforged.neoforge.event.entity.living.LivingDeathEvent`: `getEntity()`, `getSource()`; killer `getSource().getEntity()` | Event and `getSource()` VERIFIED (`neoforge/.../ExportListeners.java`); `DamageSource#getEntity()` UNVERIFIED |
| AN-NF-47a | `EntityDamageByEntityEvent` (encounter open, engaged) | `net.neoforged.neoforge.event.entity.living.LivingDamageEvent.Post`: `getEntity()`, `getSource()` | Event VERIFIED (same file); `getSource().getEntity()` UNVERIFIED |
| AN-NF-47a | scheduler tick (encounter timeout) | `net.neoforged.neoforge.event.tick.ServerTickEvent.Post`: `getServer()` | VERIFIED (same file) |
| AN-NF-47a | mob type, entity UUID | `getType().builtInRegistryHolder().key().identifier()`, `getUUID()` | UNVERIFIED for `EntityType` (the holder pattern is VERIFIED for blocks and items only) |
| all twins | player name | `ServerPlayer#getGameProfile().name()` | VERIFIED (`neoforge/.../NeoForgeFacts.java`); its runtime value behind Velocity is a P0 open item |
| all twins | dimension | `level.dimension().identifier().toString()` | VERIFIED compile (`NeoForgeFacts.java`); runtime strings UNVERIFIED |
| all twins | tick | `MinecraftServer#getTickCount()` | VERIFIED compile (`NeoForgeFacts.java`). It is the server tick count, not Paper's overworld game time (difference recorded; the provenance `tick` is only a key part and an order) |
| AN-NF-51a | `InventoryClickEvent`, `InventoryDragEvent`, `Inventory#getLocation()` | `PlayerContainerEvent.Open` / `.Close` (`getEntity()`, `getContainer()`) | VERIFIED compile (`McReaders.java`); no click-level event VERIFIED; the location of a menu's block is UNVERIFIED |

## 7. Progression (P6 to P8) and the sheet's proficiency: an open question

This section states the overlap. It rules nothing. Decision 0385 (progression as a per-shard flag that relaxes Principle 2) is **Proposed, not accepted**; P6 to P8 are on hold.

What the records say:

- **Decision 0280 (Accepted)** fixes seven proficiency domains, levels 0 to 3, `version` as total XP, and the state subjects. The eventsink is the only XP writer: AN-10a's exactly-once ledger (`xp_evidence`, unique per life, domain and evidence key) and AN-10b's publication. The levels feed the roll engine as `prof` (D-CS-05) and are never shown to an agent as numbers (sheet blindness rules, W3-W5 R11).
- **[progression-defaults.md](../neoforge/progression-defaults.md) Q3** (proposal under the owner's delegation, adopted as proposals by 0385 item 2): `proficiency-state` is the only skill and XP signal; progression's award engine "writes XP into the seven existing domains" and unlocks read the levels 0 to 3; professions map to domains; **combat is never awarded**.
- **[progression-design.md](../neoforge/progression-design.md)** awards points from novelty and usefulness with decay and caps, in a Java engine with saved data on the server, and shows the agent its level, points and limits as MCP text (section 8.2).

Where they meet, as questions for the owner:

1. **Who writes XP?** If progression writes into the seven domains, does the mod publish evidence events that the eventsink's normalisers turn into awards (one writer, the sink), or does the mod's own engine write XP (two writers on one ledger, which AN-10a's exactly-once design does not allow for)?
2. **Which award rules?** The sheet's D-CS-04 matrix (one award per accomplishment, keyed for uniqueness, no decay) and progression's novelty and usefulness model (decay, daily caps, anti-collusion weights) give different XP for the same play. One domain value cannot follow both.
3. **Combat.** The sheet awards combat XP (W2's `kill:` row in `eventsink/src/xp/awards.ts`; AN-47b's encounter row). Progression's defaults say combat is never awarded. On a shard with both, which holds?
4. **Visibility.** The sheet never shows proficiency levels to an agent; progression shows level, points and limits as tool text. If both read the same `proficiency-state`, showing it on NeoForge would expose to agents a number the sheet treats as hidden.
5. **Scale.** Progression's level table runs 0 to 8 over 0 to 2600 points; the domain scale is 0 to 3. progression-defaults Q3 notes the thresholds would be re-derived.
6. **Scope.** If the sheet does not run on the NeoForge shard (OD-NF-7 "no"), questions 1 to 4 do not arise there, but the shared contract still binds both: a second meaning of `xp` in the same schema would change 0280.

Nothing in the twin cards depends on these answers: the twins produce provenance and combat facts only, and award nothing themselves.

## 8. UNVERIFIED claims in this note (for an owner or node check)

1. Every NeoForge name in section 6 tagged UNVERIFIED (pickup event and accessors, `DamageSource#getEntity`, the `EntityType` holder id, the four-argument `addListener` overload, a menu's block location).
2. That a Body on NeoForge hears chat from any distance (no NeoForge run with chat has been done).
3. That the `geldar-nf` compose project carries the sheet sink wiring (NF-SINK).
4. That the NeoForge extra mods add no entities, so the vanilla hostile list holds.
5. That a vanilla death drop on NeoForge has no `ItemEntity` owner (AN-26a's "no message for a death drop").
6. The runtime values of the profile name behind Velocity and of the dimension id strings (P0 open items, `NeoForgeFacts.java` javadoc).
7. Remote state of the `psyche-v1.1.0` tag and of the kit's `scriptorium/hw0` branch (not checked).
