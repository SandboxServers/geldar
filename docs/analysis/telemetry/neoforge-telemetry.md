# NeoForge telemetry plan: a second Ledger adapter beside Paper

Status: plan, 2026-11-17. Docs only. No code, no node contact, no push. Author: geldar-telemetry. Governing records: [0350](../../decisions/0350-telemetry-scope-and-full-capture.md), [0351](../../decisions/0351-paper-telemetry-plugin-scope.md). Paper side: [paper-plugin/README.md](paper-plugin/README.md) (frozen API v1, names, card table). NeoForge side: [../neoforge/RESUME.md](../neoforge/RESUME.md), [../neoforge/neoforge-api-notes.md](../neoforge/neoforge-api-notes.md) (short name NOTES below).

Target loader: NeoForge 26.1.2 (build 126), Java 25. Every NeoForge API statement here is tagged VERIFIED (read in NOTES, with its section) or UNVERIFIED (not read; a coder confirms it compiles before relying on it). Nothing below invents an API: where NOTES is silent the tag is UNVERIFIED and the class name, if given, is a search hint only.

## 0. Paper stays supported (owner constraint, binding on every card)

The NeoForge work is strictly additive. Paper is not replaced, retired or put on a deprecation path.

- Both adapters ship and run side by side from the same `plugin/ledger-core`: `plugin/ledger` (Paper, jar `ledger.jar`, unchanged) and a new NeoForge adapter (section 3.1). Which one runs is decided by which server the jar is placed on; one JVM never loads both.
- Every `ledger-core` change in this plan is backward compatible with the Paper adapter: no signature change on the frozen API v1, no rename or removal of a name, key, metric or event, no change of a default. A change that cannot be additive stops the card and goes to the orchestrator.
- Required checks on EVERY card that touches `plugin/ledger-core`, the gateway, the dashboards or the alerts (each card repeats them as "Paper guard"): `(cd plugin; ./gradlew :ledger-core:test :ledger:test)` green, which includes `LedgerPluginTest`, `NoLoaderImportsTest` and the golden jar guard of plugin/core; the PT-18b neutral-core purity and agent-text scan green; `deploy/signoz/paper-dashboard.json`, `paper-alerts-server.json` and `paper-alerts-capacity.json` byte-identical to main (`git diff --stat origin/main -- deploy/signoz/paper-*` empty); `deploy/telemetry/gateway.yaml` rules for Paper unchanged.
- Paper-only cards stay on the list unchanged: PT-04c (spark bridge), PT-06d (duty-cycle defaults), PT-01 (throwaway census), the scratch Paper telemetry run, PT-02a, PT-03l, PT-11a-e, PT-15, PT-16, PT-17b and PT-08e. Nothing here reorders them or blocks them. The "Paper-only" lists in section 1.3 describe code that the NeoForge adapter does not need; they do not describe code that goes away.
- A change to a Paper alert or panel is not part of this plan. NeoForge gets its own copies (section 3.3).

## 1. What NeoForge adds

### 1.1 New signal sources (against what Paper gave us)

| # | Capability | Tag | Source and note |
|---|---|---|---|
| A1 | Server tick start and end as game-bus events (`ServerTickEvent.Pre` / `.Post`, accessor `getServer()`); MSPT from `System.nanoTime()` between the two | VERIFIED NOTES 2, 9 | Paper's tick data comes from the Paper tick API and a watchdog thread; here one pair of events feeds `TickStats` and `StallDetector` (both neutral, in core). |
| A2 | Per-dimension tick time: `MinecraftServer#getTickTime(ResourceKey<Level>)`, a `long[]` ring of 100 nanosecond values, null for an unknown dimension, zero-filled until full | VERIFIED NOTES 9 | New metric family `geldar_world_tick_ms` {world} (name PROPOSED, add to the README names first). Paper has no per-world MSPT. Cheap field read, fits a gauge reader. |
| A3 | Game-bus events: block break `BreakBlockEvent` (fires on both sides; check `!getLevel().isClientSide()`), place `BlockEvent.EntityPlaceEvent`, craft `PlayerEvent.ItemCraftedEvent`, smelt `ItemSmeltedEvent`, join `PlayerLoggedInEvent`, leave `PlayerLoggedOutEvent`, respawn, dimension change, chat `ServerChatEvent`, death `LivingDeathEvent` (test `instanceof ServerPlayer`), container `PlayerContainerEvent.Open/Close`, commands `RegisterCommandsEvent` (registration only), advancement `AdvancementEarnEvent` and `AdvancementProgressEvent` | VERIFIED NOTES 2 | Accessors listed in NOTES 2. Note there is NO `BlockEvent.BreakEvent` in 26.1. |
| A4 | Damage, item use, interaction, animal breed and tame, villager trade, sleep, raid, explosion, fluid, command execution (as opposed to registration), whitelist, operator changes | UNVERIFIED | Not read in NOTES. Paper has curated families for these; the NeoForge equivalents (a damage event, an item-use event, a command-execution event and the rest) must be located in the 26.1.x source by a read-only card (PT-N5) before any listener is written. |
| A5 | Loaded mod list and versions as resource or snapshot data | UNVERIFIED | NOTES does not cover `ModList` or FML loader info. Hint only: the FML loader exposes loaded mods. Plan: one `geldar.server.mod_list` event at start (event, not resource attribute, see privacy P-N3). |
| A6 | Registry, datapack and advancement counts (how many advancements loaded, how many recipes) | UNVERIFIED | NOTES 4 says reaching the advancement manager is UNVERIFIED on 26.1. Defer. |
| A7 | Per-player advancement progress | VERIFIED events (NOTES 2) | Replaces Paper's stats-file reader for progress only; stats counters still come from the stats file (UNVERIFIED path on NeoForge, same world folder as vanilla; confirm). |
| A8 | Mod-bus lifecycle and load time: `FMLDedicatedServerSetupEvent` (mod bus, dedicated only) and the game-bus `ServerStartingEvent`, `ServerStartedEvent`, `ServerStoppingEvent`, `ServerStoppedEvent` (class names present; accessors not read) | VERIFIED names, accessors UNVERIFIED | Gives server start duration (Starting to Started) and a clean shutdown marker. The Paper plugin has no equivalent of load-time of the whole server. |
| A9 | Config reload hook `ModConfigEvent.Loading` / `Reloading` for a SERVER `ModConfigSpec` | VERIFIED NOTES 6 | The core already has its own `ConfigWatcher` (5 s reload, file based). Keep the core mechanism so config behaves the same on both loaders; the spec hook is optional and not used. |
| A10 | Own block-owner log (P4) and maintenance notices (P3) from the geldar-neoforge mod | depends on that mod | Telemetry must not read them; the mod's own events (`geldar.blockowner.*`, `geldar.maintenance.*`, names PROPOSED) are counted in a later card (PT-N12) like PT-11e does for Geldar-Core. Blocked on P3/P4. |
| A11 | Crash and exception hooks | UNVERIFIED | NOTES has none. Use the JFR `ExceptionHandler` (core, VERIFIED present in `ledger-core/jfr`) for counts; an uncaught-exception handler or a log appender is a spike (PT-N5). D-J (async exceptions dropped) applies. |
| A12 | JFR streams, cgroup v2, disk sizes, OpenTelemetry binding, rings, redaction, token bucket, census counters, duty cycler | unchanged, reused | All in `ledger-core` (VERIFIED by file list: `jfr/`, `container/CgroupCollector`, `disk/DiskCollector`, `census/`, `OtelLedger`, `Redactor`). |

### 1.2 Risks specific to NeoForge (not in the Paper plan)

1. OpenTelemetry API and agent under NeoForge's module layer: the Paper plugin bundles `opentelemetry-api` unrelocated and the agent supplies the implementation. Whether the same works inside a NeoForge mod (jar-in-jar, `GlobalOpenTelemetry` resolving to the agent's) is UNVERIFIED, like jnats loading (NOTES 5, "Not verified" 5). `LedgerBootstrap.agentPresent` makes the ledger a no-op when it does not resolve, so the failure mode is silent. PT-N3 is a spike with a loud test.
2. No-registry rule: the geldar mod forbids registry entries, payloads and mixins (`neoforge/README.md`, `NoRegistryScanTest`). The NeoForge Ledger adapter obeys the same rules (vanilla clients join unchanged) and carries its own copy of that scan.
3. `ServerChatEvent`, `LivingDeathEvent` and the block events can arrive cancelled by another mod; census counters carry `cancelled` as on Paper. UNVERIFIED how the cancelled flag is read on each event (`ICancellableEvent#isCanceled`, NOTES 2 mentions `setCanceled`).
4. Thread model: NeoForge game-bus events are handled on the server thread for server events (UNVERIFIED for every event; a `BreakBlockEvent` is flagged client and server in NOTES). `HostInfo.isMainThread()` must be implemented by comparing with the server thread (UNVERIFIED accessor; `MinecraftServer#isSameThread` is a search hint).

### 1.3 What the NeoForge adapter does not need (Paper keeps all of it)

These Paper-only parts have no NeoForge counterpart and are simply not built for it; they stay in `plugin/ledger` unchanged: the Bukkit scheduler (`PaperHostScheduler`), Paper tick API listener (`TickEndListener`), `StallWatchdog` Bukkit thread use, Paper Timings and the spark bridge (`SparkCollector`, PT-04c), plugin census and `geldar_plugins_enabled` / `geldar.server.plugin_enabled|disabled` (NeoForge has a mod list, A5, instead), `plugin.yml`, the Chunky, BlueMap and CoreProtect bridges (PT-10b; the BlueMap and Chunky equivalents for NeoForge are P5, on hold), and Paper's census of 390 Bukkit event classes (the census idea carries over, section 2 row "census").

## 2. Mapping: every Paper collector family to NeoForge

Source of the Paper list: `PaperCollectors.NAMES` (tick, spark, world, server, census, curated, connection, snapshot, progress, client cadence, bridge) plus the two core collectors `CgroupCollector` and `DiskCollector`; JFR is built in core and not started.

Legend: REUSE = used from `ledger-core` as is. NEW = new NeoForge adapter code. N/A = not applicable on NeoForge (stays on Paper).

| Paper family (class) | NeoForge | Notes |
|---|---|---|
| `TickCollector` + `TickEndListener` + `TpsGauges` + `StallWatchdog` (metrics `geldar_tick_lag_ms`, `geldar_tick_overruns_total`, `geldar_tick_stalls_total`, `geldar_tps`) | REUSE `tick/TickStats`, `tick/StallDetector`; NEW listener on `ServerTickEvent.Pre/Post` (VERIFIED) and a watchdog thread | Same metric names and bounds so the same panels work. Add A2 per-world tick time as NEW gauges. |
| `SparkCollector` (`geldar_spark_*`) | N/A | Paper-only (PT-04c unchanged). |
| `WorldCollector` (`geldar_world_loaded_chunks`, `_entities`, `_players`) | NEW | Reads levels of the server; accessor names UNVERIFIED (chunk and entity counts). Same metric names and `world` attribute. |
| `ServerCollector` + `ConfigSnapshot` (`geldar_players_online`, `geldar_operators_count`, `geldar_plugins_enabled`, `geldar_scheduler_pending_tasks`, `geldar.server.config_snapshot`) | NEW; `geldar_plugins_enabled` and `geldar_scheduler_pending_tasks` N/A (add `geldar_mods_loaded` PROPOSED) | Config snapshot content must be an allow-list of keys, as on Paper (S-rules). |
| `CensusCollector` + `CensusRegistrar` (`geldar_event_count_total`, `geldar_event_duty_ratio`) | REUSE `census/CensusCounters`, `census/DutyCycler`; NEW registrar over NeoForge event classes | A generated allow-list needs a different generator (NeoForge event classes, scanned from the jar; UNVERIFIED how to enumerate). Same `event_class` attribute. Opt-in, like Paper. |
| `CuratedCollector`: `BlocksItemsFamily` | NEW | `geldar.block.*`, `geldar.item.*` from A3 (VERIFIED events). D2 (item-event block positions) applies. |
| `ContainersSleepAnimalsFamily` | NEW, partly UNVERIFIED | Container VERIFIED (A3); sleep, animals, trade UNVERIFIED (A4). |
| `CombatMovementFamily` | NEW, mostly UNVERIFIED | Death VERIFIED; damage and movement UNVERIFIED (A4). D-B and D-C apply. |
| `TextContentFamily` + `PlainText` (chat, sign, book via ContentLog) | NEW; REUSE `ContentLog`, `ContentCap`, `Redactor` | Chat `ServerChatEvent` VERIFIED (`getRawText()`); sign and book UNVERIFIED. D-F, D-I apply. |
| `OperatorAuditFamily` (operator audit, RCON, console) | NEW, UNVERIFIED | Command execution event and RCON path not read (A4). D-D, D-G, D-H apply. The gateway noise rule is generic (section 3.3). |
| `MiscFamily` (raids, tab complete, plugin enable/disable, exceptions) | NEW partly; plugin enable/disable N/A | Exceptions A11. |
| `ConnectionCollector` + `SessionIds` (`geldar.player.join|quit|kick|prelogin`, `geldar.mc_session`) | REUSE `ids/Ulid`; NEW listener on join and leave (VERIFIED) | Prelogin and kick-reason events UNVERIFIED. D1 applies. |
| `SnapshotCollector` (`geldar.player.snapshot` every 60 s, agents only) | NEW | Reads ServerPlayer state; fields as Paper (`geldar.health`, `food`, `xp_level`, `gamemode`, `ping_bucket`). Accessors UNVERIFIED. Snapshots stay opt-in per the open decision. |
| `ProgressCollector` + `StatsFileReader` (`geldar.player.advancement|stats`) | NEW; advancement events VERIFIED (A7) | Stats file reader reusable if the file layout is the vanilla one (UNVERIFIED). |
| `ClientCadenceCollector` (client tick cadence, command-tree audit) | NEW, UNVERIFIED | May be N/A: depends on a packet hook not read. Keep for last. |
| `BridgeCollector` (Chunky, BlueMap, CoreProtect) | N/A for now | P5 (BlueMap, pregeneration) on hold. |
| `CgroupCollector` | REUSE | `geldar_container_*`. |
| `DiskCollector` / `DirSize` | REUSE | `geldar_disk_bytes` {area}; NeoForge area names (world, mod config, logs) need an addition to `DiskArea` (additive enum values; Paper tests stay green). |
| JFR handlers (`jfr/*`) | REUSE | Not started on Paper; the same wiring decision applies. |
| `LedgerBootstrap`, `OtelLedger`, rings, guard, config | REUSE | One bootstrap call with a `HostInfo`. |

### 2.1 Identity and safety rules that carry over unchanged

1. Life ids: `LifeIds.isLifeId(name)` (`^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$`) decides "this player is an agent". Only an agent gets `geldar.life_id` and `minecraft.player.uuid` on events.
2. `mc_session`: a per-connection ULID from `ids/Ulid`, generated at join, dropped at leave, never reused across reconnects, on every event of that connection.
3. Offline UUID: `OfflineUuid.of(name)` is the derivation the Paper plugin uses. The Body model note records that a golem Body derives its UUID differently ("Goldar:" plus id, not `OfflineUuid`), and which UUID the NeoForge server sees behind Velocity is a P0 open item. The adapter reads the UUID the server reports and does not derive it; a test pins the choice once P0 reports (PT-N6 is blocked on this).
4. No human identity without the owner's decision: a human actor (not a life id) is recorded without id, with position and time (D-A, as built). D3 (a human named like a life id) and D4 (offline UUID reversible) stay open and apply identically.
5. `AttrKeys` allow-list: the NeoForge adapter adds no key to events or metrics except by a README change first; the binding drops unknown keys. Events use `geldar.*` keys (never bare), metrics use the bare keys (`world`, `window`, `collector`, ...); per-player data is never a metric attribute.
6. Free text goes only through `ContentLog` (redacted, 32 KiB cap). The credential scrubbers (`CredentialScrub`, `HeaderScrub`, `KeyValueScrub`, `FlagScrub`) are used by the core path; the adapter calls no logger on game text.

## 3. Changes outside the NeoForge adapter

### 3.1 Module layout

A new Gradle project beside `neoforge/`, named `neoforge-ledger/` (name carries no telemetry word, as on Paper: 0350 point 7), with its own jar `ledger-neoforge.jar` (mod id `ledger`). Reason it is not inside `neoforge/`: that project belongs to session geldar-neoforge and holds the progression mod; telemetry should be removable and independently versioned, as Ledger is on Paper. It is not inside `plugin/` because `plugin/settings.gradle.kts` pins `FAIL_ON_PROJECT_REPOS` and an exclusive Paper repository, and the NeoForge toolchain (ModDevGradle 2.0.148, Gradle 9.8.2) brings its own repositories. How the adapter consumes `ledger-core`: options (a) Gradle composite `includeBuild("../plugin")` with dependency substitution of `:ledger-core`, (b) a locally published artifact, (c) a source-set include. Option (a) is the recommendation; it is owner-gated (section 6, G1).

### 3.2 `ledger-core` changes (all additive; Paper guard on each)

1. Host ports: no change needed. `HostScheduler` (`everyTicks` on the server thread, `everyMillis` async) and `HostInfo` (`serverTick`, `isMainThread`, `loaderName`) are implementable on NeoForge: `everyTicks` by counting `ServerTickEvent.Post` (VERIFIED); `everyMillis` by a daemon scheduled executor owned by the adapter. `loaderName()` returns a fixed string for NeoForge; PT-N2 adds a test that no core code switches on its value except for labels.
2. Bukkit and Paper leakage found by reading ledger-core (all additive fixes):
   - `Names.COLLECTOR_DISABLED = "geldar_paper_collector_disabled"`: a Paper-named metric in neutral code. DO NOT rename (alert "Paper collector disabled" and its panel use it). NeoForge emits the same metric name so the existing alert logic can be cloned; the `service.name` resource attribute separates loaders. Record this in the README names table as a deliberate legacy name.
   - `jfr/ThreadCpuHandler` classifies threads by the prefixes "Paper" and "Netty" (line 59). On NeoForge the server thread is named differently (UNVERIFIED; likely "Server thread"). PT-N2 makes the prefix list injectable through `JfrSettings` with the current values as the default, so Paper output is identical, and adds a NeoForge list.
   - `jfr/ContentionHandler` mentions `org.bukkit.craftbukkit.X` in a comment only (harmless; the group rule is the first two package segments, loader-neutral).
   - `ids/OfflineUuid` doc comment names Paper and Velocity; no change.
3. `NoLoaderImportsTest` already forbids `net.neoforged`, `net.minecraft`, `net.fabricmc`, `org.bukkit`, `io.papermc`, `com.velocitypowered` in `ledger-core` (VERIFIED: the pattern list read). It scans only the core source tree (system property `ledger.core.src`). Needed: a mirror test in the NeoForge module that forbids `org.bukkit`, `io.papermc`, `com.velocitypowered` and `net.kyori` in `neoforge-ledger/src/main` (PT-N1), so neither adapter leaks the other's loader. `NoLoaderImportsTest` itself is not edited.
4. `DiskArea`: add NeoForge areas only as new enum values if needed (additive).
5. PT-18a (forbidden-API and plugin.yml scan): keep the Paper list, add a NeoForge list for the new module (PT-N10); the neutral list is reused as is.
6. Java level: `ledger-core` and `ledger` both use toolchain 25 (VERIFIED in the two build files), matching NeoForge 26.1.2; no bump needed.

### 3.3 Gateway, dashboard, alerts (both loaders)

- Gateway (`deploy/telemetry/gateway.yaml`, VERIFIED read): the pipeline is loader-agnostic. Credential-key deletion, address masking, resource-attribute deletion and the metric-label rules apply to any OTLP source. The only Paper-specific rule is the `filter/noise` log rule that drops lines naming "RCON Client" or "Thread RCON" when no `event.name` is set (PT-12). It stays as is and is harmless for NeoForge; whether NeoForge prints such lines is UNVERIFIED (PT-N11 checks on the scratch run, and adds a rule only if needed, as an additional statement). No gateway change is required to start; the gateway on the node still needs its owner-gated PT-12 restage for Paper regardless.
- `service.name`: `geldar-neoforge` for the NeoForge server (Paper: `geldar-paper`, Velocity: `geldar-velocity`), set by the agent properties file (PT-02b style, a new properties file for the NeoForge server), never by the adapter.
- Dashboard: the existing `paper-dashboard.json` (14 widgets: tick percentiles, TPS, overruns and stalls, container throttling and memory, chunks, entities, players, census top 20, drops, queue depth, disabled collectors, JFR thread-group CPU, disk) has an empty variable list and Paper-named panels. It stays unchanged. NeoForge gets a new `deploy/signoz/neoforge-dashboard.json`, cloned from the Paper file with a `service.name` filter of `geldar-neoforge`, all 14 panel types kept (none of them is fed by spark), plus per-world tick time and mod count panels. A later merge into one dashboard with a loader variable is an owner choice, after both are imported; it is not part of this plan.
- Alerts: the 11 Paper alerts (6 in `paper-alerts-server.json`, 5 in `paper-alerts-capacity.json`) stay byte-identical. NeoForge gets `neoforge-alerts-server.json` and `neoforge-alerts-capacity.json`, cloned with the `service.name` filter and "NeoForge" in the titles; alerts that depend on Paper data (watchdog warning, operators present if not built) are omitted or re-sourced. JSON is not imported into SigNoz until the owner says so (as for Paper).

## 4. Cards

Shape follows the Paper cards: one worktree and branch per card (`telemetry/pt-n<k>`), edit only the files named, under about 300 changed lines and 6 files, one local commit, no push. Size S under 100 lines, M 100 to 300. Common checks on every card: `git diff --check`, `git status --short`, `pwsh -NoProfile -File ./geldar.ps1 pnpm check:repo` when docs/deploy/tools are touched, and the Paper guard (section 0) whenever the card touches `plugin/`, `deploy/telemetry` or `deploy/signoz`.

Numbering: PT-N1 onward. Paper cards keep their numbers.

### Dependency summary

```
G1 (owner: Gradle lane)  -> PT-N1 -> PT-N3, PT-N4a, PT-N4b, PT-N6 ...
PT-N2 (core, additive)   independent of G1, can start now
PT-N5 (read-only API spike) independent, can start now
```

Parallel groups after PT-N1 merges: {PT-N3, PT-N4a, PT-N4b, PT-N7, PT-N8} touch disjoint files and can run in parallel; PT-N9 to PT-N12 follow.

### PT-N1: neoforge-ledger skeleton, wired to ledger-core (M) BLOCKED ON G1 (owner-gated Gradle lane; the neoforge CI lane is on hold)
- Files (new): `neoforge-ledger/{settings.gradle.kts,build.gradle.kts,gradle.properties,.gitignore,README.md}`, `gradle/{libs.versions.toml,verification-metadata.xml}`, lockfiles, wrapper copied from `neoforge/` (same Gradle 9.8.2), `src/main/resources/META-INF/neoforge.mods.toml` (mod id `ledger`, `side = "SERVER"` dependencies, `loaderVersion` as the geldar mod's), `src/main/java/dev/geldar/ledger/neoforge/{LedgerMod,NeoForgeHostInfo,NeoForgeHostScheduler,package-info}.java`, tests `NoRegistryScanTest` (copy of the geldar one: no registry, payloads, mixins), `NoPaperImportsTest` (mirror of `NoLoaderImportsTest`), `ModInfoTest`.
- Steps: copy build conventions from `neoforge/` (pins identical; no new versions); consume `:ledger-core` per the G1 decision; `@Mod(value = "ledger", dist = Dist.DEDICATED_SERVER)` (VERIFIED NOTES 1); the constructor reads the config file path, calls `LedgerBootstrap.create(config, host, logger)`, and registers no collectors yet; `HostInfo`/`HostScheduler` implementations per 3.2 item 1; jar-in-jar of `ledger-core` and `opentelemetry-api` (exact versions from the Paper libs catalog, 1.67.0).
- Checks: `(cd neoforge-ledger; ./gradlew build)` (not run on the node; local only), Paper guard unchanged because no `plugin/` file is edited.
- Depends on: G1. Blocks: everything NeoForge-side.

### PT-N2: ledger-core additive neutrality fixes (S) can start now
- Files: `plugin/ledger-core/.../jfr/JfrSettings.java`, `jfr/ThreadCpuHandler.java`, their tests, README names table note for `geldar_paper_collector_disabled` (docs edit only through the orchestrator, per README rule).
- Steps: make the thread-prefix list an injectable `JfrSettings` field with default `["Paper","Netty"]` (so Paper behaviour is bit-identical; a test asserts the default list and the output on the existing fixtures); add a second list constant for NeoForge once PT-N5 confirms the thread names. No signature change on frozen API v1.
- Revert test: a test that fails if the default list changes.
- Paper guard: `:ledger-core:test :ledger:test`, `LedgerPluginTest`, `NoLoaderImportsTest`, golden jar guard, PT-18b scan, jar content of `ledger.jar` unchanged except the changed classes.

### PT-N3: OpenTelemetry under NeoForge, loud spike (S) after PT-N1; node-free
- Files: `neoforge-ledger/src/test/.../OtelLoadTest.java`, `neoforge-ledger/README.md`.
- Steps: run `runServer` (dev server, NOTES 7; EULA by `eula.txt`) with the OpenTelemetry Java agent from the same pin as PT-02a and an OTLP file or log exporter; assert that `LedgerBootstrap.agentPresent` is true and one metric is exported; record the module-layer behaviour (UNVERIFIED items 1 above and NOTES "Not verified" 5). Result is a note, not a pass condition: if the API cannot see the agent, the card ends "blocked" with the failure and the options (shade and relocate: UNVERIFIED NOTES 5).
- Checks: build; local run only. No node, no Docker.

### PT-N4a: tick and stall collector (M) after PT-N1
- Files: `neoforge-ledger/.../tick/{TickCollector,TickListener,StallWatchdog}.java`, `.../world/WorldTickGauges.java` (A2), tests (pure logic via fakes; no Minecraft classes).
- Steps: `ServerTickEvent.Pre`/`Post` record `System.nanoTime()` into `TickStats`; overrun and stall counters with the frozen names; per-dimension gauge from `getTickTime(dim)` averaged on the exporter thread reading a field copied each tick (do not call from the exporter thread: the long[] is written by the server thread; copy an average once per 20 ticks into a volatile). Register names in `Names` only through PT-N2-style core cards (the `geldar_world_tick_ms` constant needs a README names row first: orchestrator).
- Checks: `./gradlew test`; fakes verify the same bucket output as the Paper `TickCollector` tests.
- Revert test: fails if Post does not record the duration.

### PT-N4b: world, server and snapshot collectors (M) after PT-N1, parallel with N4a
- Files: `.../world/WorldCollector.java`, `.../server/{ServerCollector,ConfigSnapshot}.java`, `.../players/SnapshotCollector.java`, tests.
- Steps: counts via the accessors found in PT-N5 (UNVERIFIED now); config snapshot is an allow-list of keys; snapshot collector agents-only (`LifeIds.isLifeId`), 60 s, opt-in, off by default.
- Blocked on PT-N5 for accessor names.

### PT-N5: read-only API spike, no code (S) can start now
- Output: an addendum to NOTES (only by the geldar-neoforge session; see section 6) or a section in this file's follow-up, listing for each UNVERIFIED row in sections 1 and 2 the class and accessor in the 26.1.x source: damage, item use, interaction, breed, tame, trade, sleep, raid, explosion, command execution, whitelist, operator changes, sign and book edit, prelogin, kick, `ModList`, dedicated-server thread check, thread names, uncaught-exception hook, level chunk and entity counts. Read-only; no node contact.
- Parallel: yes. Blocks N4b, N6 to N9.

### PT-N6: connection lifecycle and session ids (M) after PT-N1; BLOCKED on P0 (which UUID and name the server sees)
- Files: `.../players/{ConnectionCollector,SessionIds}.java`, tests with fakes.
- Steps: join and leave listeners (VERIFIED); `Ulid.next()` per connection; agent test by `LifeIds.isLifeId`; events `geldar.player.join|quit`; kick and prelogin only if PT-N5 found events; D1 (kick-reason free text) not captured until decided.
- Revert test: fails if a reconnect reuses the old `mc_session`; fails if a human name gets `geldar.life_id`.
- Gate: the UUID the server reports (P0 open item) must be recorded in the card report before merge.

### PT-N7: curated families, blocks, items, containers (M) after PT-N1 and PT-N5; parallel with N8
- Files: `.../curated/{CuratedCollector,BlocksItemsFamily,ContainersFamily}.java`, tests.
- Steps: VERIFIED events only (A3): break, place, craft, smelt, container open and close. Token bucket via `EventLog.register` rates; cancelled break marked, not dropped. D2 stays default (positions as built for blocks, item events without position).

### PT-N8: combat, deaths, text content, operator audit (M) after PT-N1, PT-N5
- Files: `.../curated/{CombatFamily,TextContentFamily,OperatorAuditFamily}.java`, tests.
- Steps: death VERIFIED; damage and command execution per PT-N5; chat via `ContentLog` (D-F, D-I). Defaults for D-A to D-J as built on Paper: nothing different.
- Revert tests: pvp damage keeps the victim only (D-B); kill excludes players (D-C).

### PT-N9: progress and stats (S) after PT-N1
- Files: `.../players/{ProgressCollector,StatsFileReader}.java`, tests.
- Steps: `AdvancementEarnEvent` and `AdvancementProgressEvent` (VERIFIED) to `geldar.player.advancement`; stats-file reader reused logic if the layout is vanilla (UNVERIFIED; the card confirms against a scratch world file, local only).

### PT-N10: scans for the new module (S) after PT-N1
- Files: the PT-18a forbidden-API scan (`tools/repo-checks/...` file named in the PT-18a card; the coder reads that card first), a NeoForge list, tests.
- Steps: add the NeoForge list as a second table; Paper list and its tests untouched; the neutral list reused.
- Paper guard: PT-18a and PT-18b scans still pass on the existing tree.

### PT-N11: gateway, dashboard and alerts for NeoForge (M) can start now for JSON; panels needing N4a names wait for N4a
- Files (new only): `deploy/signoz/neoforge-dashboard.json`, `deploy/signoz/neoforge-alerts-server.json`, `deploy/signoz/neoforge-alerts-capacity.json`; if a rule is needed, one added statement in `deploy/telemetry/gateway.yaml` (only after the scratch run shows a NeoForge-specific noise line; otherwise no edit).
- Steps: clone the Paper files with the `service.name` filter; keep metric names; add per-world tick and mod-count panels; JSON validity test as the Paper dashboard has.
- Checks: JSON parses; `git diff --stat origin/main -- deploy/signoz/paper-*` empty; gateway unchanged or one new statement; `check:repo`. The existing Paper dashboard and 11 alerts untouched.
- Not imported into SigNoz (owner step).

### PT-N12: Geldar mod counters (S) BLOCKED on geldar-neoforge P3 and P4
- Files: counters in `neoforge-ledger` or a tiny seam in the geldar mod (decided with that session); the counting points are named by that session.
- Steps: counters like PT-11e for event export, maintenance notices and block-owner queries. Needs the geldar mod to expose its counting points through a stable interface (section 6, item 4).

### PT-N13: scratch NeoForge telemetry run (M) HELD: owner and node gate
- Reuse the scratch overlay (PT-03k) with `SCRATCH_PLATFORM=neoforge`; the existing scratch Paper run stays first on the list. Verify every row as scratch-test-plan.md does for Paper (a new "Rows pending a live scratch run" table for NeoForge). 15 GB RAM, up to 6 CPUs, 20-40 min, one at a time with the Paper run. Needs: the P0 node run finished, the NeoForge scratch re-run, owner's go.

### PT-N14: enablement window request (S) HELD: owner
- Same as PT-16 for the NeoForge server: PT-N13 passes, PT-15 overhead A/B on NeoForge, gateway restaged, agent properties for `geldar-neoforge`. No jar is placed on any server until then.

### Order and parallelism

Start now, no gate: PT-N2, PT-N5, PT-N11 (JSON only). Front of the line for fan-out: G1 then PT-N1. After PT-N1: PT-N3, PT-N4a, PT-N4b, PT-N7, PT-N8, PT-N9, PT-N10 (disjoint files; N4b, N7, N8 also need N5). PT-N6 waits for P0. PT-N12 waits for P3 and P4. PT-N13 and PT-N14 wait for owner and node.

## 5. Privacy

Every D-decision default stands, unchanged for NeoForge: nothing exports until an enablement window (the NeoForge Ledger ships disabled and no-op without an agent, like Paper); full-text capture with no opt-out and 1-year retention per 0350; D1, D2, D3, D4, D-A to D-J and the snapshots question remain open with the defaults as built (D-A human actors without id but with position and time; D-B pvp victim only; D-C kill excludes players; D-D RCON thread lines dropped; D-F human chat, sign, book verbatim with no speaker id; D-G, D-H, D-I, D-J as built). `safety-rules.md` S1 to S12 apply to the NeoForge adapter, each card naming the ones it can break.

New questions NeoForge raises (for the owner; nothing is implemented until answered, and the default is "not captured"):
- P-N1: the loaded mod list and versions (A5) reveal the server's software stack. Default: one event at start, not a resource attribute, exported only in an enablement window.
- P-N2: advancement progress events (A7) carry player identity and timing, like Paper's. Default: agents only; humans without id, as D-A.
- P-N3: per-world tick time labelled by dimension (A2) is a metric attribute `world`; dimension names are not personal. Default: allowed (same as Paper's `world`).
- P-N4: the geldar mod's block-owner log (P4) records who built what; its counters (PT-N12) must count only, never copy owners or positions into telemetry. Default: counts only.
- P-N5: UUID the server sees for a Body behind the proxy differs from `OfflineUuid`; if the adapter emits `minecraft.player.uuid` for agents it must be the one the server reports, which may differ between Paper and NeoForge for the same Body. Default: emit what the server reports and record the mapping in the card report; cross-loader joins are by `geldar.life_id`, not by UUID.
- P-N6: an uncaught-exception hook (A11) could capture stack traces with game text. Default: counts and class names only (D-J, async exceptions dropped).

## 6. Ownership and coordination

`neoforge/` is owned by session geldar-neoforge. This plan edits nothing there. The new `neoforge-ledger/` directory is proposed as a sibling so that no file in `neoforge/` changes; the orchestrator confirms that with that session before PT-N1.

What we need from geldar-neoforge:
1. Agreement that the NeoForge Ledger lives in `neoforge-ledger/` (a second mod jar, mod id `ledger`), not inside `neoforge/`; and that the two jars coexist on one server.
2. The Gradle lane decision G1 (owner-gated): the neoforge CI lane is on hold; whether `neoforge-ledger/` gets its own lane, a shared lane, or none; and the `ledger-core` consumption method (composite build, as recommended). Also a ruling that `neoforge-ledger/` may reuse their pins and the verification-metadata and locking approach.
3. The result of P0: which UUID and name the server sees for a Body behind Velocity (blocks PT-N6), and the confirmed `runServer` task name, EULA handling and dev-server start (NOTES "Not verified" 6).
4. For PT-N12: after P3 (event export and maintenance notices) and P4 (own block-owner log), a stable counting seam in the geldar mod (an interface or a counter holder the Ledger mod can read), plus their names for the events.
5. Answers to the UNVERIFIED rows PT-N5 lists, if their session has already read them (damage, item use, command, thread names), so the spike is not duplicated; any NOTES addendum is written by them in `docs/analysis/neoforge/`, not by us.
6. Notice before any change to the mod-wide rules (no registry, no payloads, no mixins), since the Ledger adapter copies them.

What they must not need from us: no change to their build, their CI, their jar or their files.

Owner and node gates (not session gates): G1 (Gradle lane), PT-N13 (scratch run time and capacity), PT-N14 (enablement window), the open D decisions, and the owner's nod for any dashboard import into SigNoz.
