# Cards: events (PT-01, PT-06, PT-07, PT-08)

Read [README.md](README.md) first (aliases, frozen API and names, inherited rules) and [safety-rules.md](safety-rules.md). Paper class names below come from the survey and 0351; each is unverified until it compiles against paper-api 26.1.2.build.74-stable (README rule 7). A class that is deprecated, listener-gated or on the exclusion list of 0351 point 3 is never registered: the coder stops and reports instead of registering it.

Every event handler in these cards: priority `EventPriority.MONITOR`, never mutates the event (no `setCancelled`, no setter), wraps its body in a guard `begin/end` and a `try/catch (Throwable)` that counts an error and returns (S8). Player events carry `geldar.life_id` (name, only when `LifeIds.isLifeId`), via the `EventLog` string fields; the emitter adds the UUID.

---

## PT-06a: census counters and duty cycler (pure logic)

- Loader: Neutral. Depends on: PT-03 api (starts only when it is on the integration branch). Size: S. Start: immediately.
- Goal: the loader-independent part of the census: one pair of bound counters per event class and the duty-cycle decision.
- Files: CREATE `CORE/census/CensusCounters.java`, `CORE/census/DutyCycler.java`; tests `CORE_T/census/CensusCountersTest.java`, `CORE_T/census/DutyCyclerTest.java`.
- Metric attribute keys for the census (README section 4): bare `event_class` and `cancelled`; never the `geldar.event.class` event key.
- Steps: 1. `CensusCounters(Ledger, List<String> classNames)`: for each name `counter("geldar_event_count_total", ...).bind(className, "false")` and `bind(className, "true")`, stored in two arrays indexed by class index; `count(int index, boolean cancelled)` is O(1) and allocation-free. 2. `DutyCycler(onTicks, periodTicks)`: `boolean on(long serverTick)` is `(serverTick % period) < on`; period 0 means always on. `ratio()` is `on/period`, published as `geldar_event_duty_ratio{event_class}` by the collector in PT-06c. 3. Class names are simple names; the constructor throws on duplicate simple names (the allow-list generator in PT-06b emits fully qualified names where simple names collide).
- Tests (fail when reverted): counts land in the right series by class and cancelled flag; duty 5/20 is on for ticks 0 to 4 of each 20 and off otherwise; duplicate names rejected; 1 million `count` calls allocate under a small constant.
- Checks: `:ledger-core:test`. S6, S7.
- Commit: `PT-06a Census counters and duty cycler (plugin)`.
- Do NOT: add a Bukkit type; read a clock.

## PT-06b: census allow-list generator

- Loader: Paper. Depends on: PT-03a. Size: M. Start: after PT-03a.
- Goal: 0351 point 3: the list of event classes the census may register is generated from paper-api at build time, checked in, and guarded by a drift test.
- Files: CREATE `plugin/ledger/census.gradle.kts` (applied by the guarded line PT-03a put in `plugin/ledger/build.gradle.kts`, so that file is not edited); CREATE `plugin/ledger/src/test/java/dev/geldar/ledger/paper/census/CensusAllowlistGenerator.java` (has `main(String[] out)`); CREATE `PAPER/census/CensusExclusions.java`; CREATE `plugin/ledger/src/main/resources/ledger/census-allowlist.txt` (generated, one fully qualified class per line, sorted); CREATE `PAPER_T/census/CensusAllowlistTest.java`.
- Steps: 1. `CensusExclusions.NAMES`: exactly the 14 gated classes of 0351 point 3 (`BlockPhysicsEvent`, `EntityMoveEvent`, `InventoryMoveItemEvent`, `HopperInventorySearchEvent`, `PlayerChunkLoadEvent`, `PlayerChunkUnloadEvent`, `PlayerTrackEntityEvent`, `PlayerUntrackEntityEvent`, `BlockDestroyEvent`, `PlayerInventorySlotChangeEvent`, `PlayerRecipeBookClickEvent`, `PlayerSignOpenEvent`, `ItemTransportingEntityValidateTargetEvent`, `AsyncPlayerConnectionConfigureEvent`), `AsyncPlayerChatEvent`, `PlayerChatEvent`, `PlayerLoginEvent`, plus a rule `isExcluded(Class)` true for any `@Deprecated` class. 2. The generator loads every class under `org/bukkit/event`, `io/papermc/paper/event` and `com/destroystokyo/paper/event` from the paper-api jar through a class loader (test runtime classpath), keeps classes that are public, non-abstract, assignable to `org.bukkit.event.Event`, have a static `getHandlerList()` (directly declared), and are not excluded; writes the sorted list. 3. `census.gradle.kts` registers a `JavaExec` task `generateCensusAllowlist` (main class the generator, classpath `sourceSets.test.runtimeClasspath`, argument the resource path). 4. `CensusAllowlistTest` recomputes the list in memory and compares to the checked-in file (so a paper-api bump fails until regenerated); asserts none of the excluded classes is present; asserts `BlockBreakEvent` and `PlayerJoinEvent` are present; asserts the file has no duplicates.
- Tests (fail when reverted): each assertion above; adding `PlayerLoginEvent` to the file by hand fails; removing an exclusion from `CensusExclusions` fails the test that all 14 plus the legacy chat events plus `PlayerLoginEvent` are excluded.
- Checks: `:ledger:test`; run `./gradlew :ledger:generateCensusAllowlist` and show a clean diff after.
- Commit: `PT-06b Census allow-list generator and exclusions (plugin)`.
- Do NOT: register anything; use a reflective "all events" listener; hand-edit the generated file except through the task.

## PT-06c: census registration

- Loader: Paper. Depends on: PT-03h, PT-06a, PT-06b. Size: M.
- Goal: `geldar_event_count_total` and `geldar_event_duty_ratio` from one `MONITOR` registration per allow-listed class.
- Files: CREATE `PAPER/census/CensusCollector.java`, `PAPER/census/CensusRegistrar.java` (interface with a Paper implementation `PaperCensusRegistrar`), `PAPER/census/PaperCensusRegistrar.java`; tests `PAPER_T/census/CensusCollectorTest.java`, `PAPER_T/census/CensusExclusionRuntimeTest.java`.
- Steps: 1. `CensusCollector.start`: reads the allow-list resource, builds `CensusCounters`, for each class calls `registrar.register(clazz, executor)` where the executor is `(listener, event) -> { long t = guard.begin(); if (duty == null || duty.on(host.serverTick())) counters.count(i, event instanceof Cancellable c && c.isCancelled()); guard.end(t); }` with one executor instance per class; the Paper registrar uses `PluginManager.registerEvent(clazz, listener, EventPriority.MONITOR, executor, plugin, false)` and records the listener in `ListenerRegistry`. 2. Duty cycles for the high-rate families of 0351 (`GenericGameEvent`, `EntityAirChangeEvent`, `PlayerStatisticIncrementEvent`, `EntityPathfindEvent`, `EntityTargetEvent`, `EntityTargetLivingEntityEvent`, `PlayerMoveEvent`, `ClientTickEndEvent`, `EntityExhaustionEvent`, `BlockFromToEvent`, `VehicleUpdateEvent`, `VehicleMoveEvent`) come from `collector.census.duty.<Class>` config keys with the **estimated default 5/20 ticks** until PT-06d; the class `DefaultDuty` holds this table. 3. A class that fails `Class.forName` or registration is skipped and counted, not fatal (a paper-api change). 4. Disable path: `stop()` unregisters all; `HandlerList` check.
- Tests (fail when reverted): with a fake registrar, the number of registrations equals the allow-list size and none is an excluded class (`CensusExclusionRuntimeTest` builds the excluded set independently from `CensusExclusions` literal names and compares); firing a fake cancellable event bumps the `cancelled=true` series; a duty-cycled class counts only in its on-window (fake serverTick); `stop()` leaves zero registered listeners; a registrar that throws for one class leaves the rest registered.
- Checks: `:ledger:test`; scratch rows E1 and E2. S6, S8, S10.
- Commit: `PT-06c Census registration (plugin)`.
- Fix pass (T106 review): (a) Thread rule: `BudgetGuard` fields are main-thread-only, so the executor calls `guard.allowed()/begin()/end()` only when `host.isMainThread()`; an event fired off-thread (the 10 `Async*` allow-listed events, anything else off-thread) is only counted and skips the guard (so it is not time-budgeted). `CensusCounters.count` is one bound OTel counter add (thread-safe), `DutyCycler` is immutable (thread-safe), and `serverTick()` is a single int read (atomic; a stale value only shifts one event across a duty boundary). (b) Disjoint series: 58 of the 390 classes inherit `getHandlerList()` from a parent, so a child event is also delivered to the parent's executor. The executor counts only when `event.getClass() == type`, so each series is exactly its own class. Plugin-defined subclasses of a census class are NOT counted under the parent (an accepted loss). (c) Cost: about 15 to 40 ns per event in the executor, allocation-free (a volatile read, a class compare, `begin()` with `nanoTime` in 1 of 1024 calls, a floorMod, one counter add, an `instanceof Cancellable`); not measured until PT-06d. The census is OFF by default (`collector.census.enabled=true` to opt in). The high-rate classes `EntityInsideBlockEvent`, `EntityEffectTickEvent`, `EntityAddToWorldEvent`, `BlockRedstoneEvent` and `PlayerMoveEvent` stay on the allow-list; duty cycling gates counting only, not event construction or dispatch, which a registered listener induces. The first four joined `DefaultDuty` at 5/20 (16 classes in all).
- Do NOT: register a class outside the allow-list; use `ignoreCancelled=true` (the census must see cancelled events); allocate in the executor.

## PT-06d: duty-cycle defaults from measured rates

- Loader: Paper. Depends on: PT-06c, PT-01. Size: S. Status: after PT-01 results exist.
- Goal: replace the estimated 5/20 defaults with duty cycles that keep each family's cost within the census budget (0.1 us per event).
- Files: EDIT `PAPER/census/DefaultDuty.java` (the table only); CREATE `docs/analysis/telemetry/paper-plugin/pt01-census-results.md` is written by PT-01, not here; test EDIT `PAPER_T/census/CensusCollectorTest.java` (one new assertion).
- Steps: read the PT-01 rate table; for each family with rate above 5,000 per second choose on/period so that on-ratio times rate is at most 2,000 per second; record the rates in the table's comment with the PT-01 date.
- Tests (fail when reverted): a test asserts every family named in 0351 has an entry and every ratio is above 0 and at most 1.
- Checks: `:ledger:test`.
- Commit: `PT-06d Measured census duty cycles (plugin)`.
- Do NOT: invent a rate; run the scratch shard (PT-01 did).

## PT-01: census throwaway run (branch only, never merged)

- Loader: Paper (throwaway). Depends on: PT-03k (fixture), PT-06b (the class list; or build its own with the same generator). Size: M. Gate: the owner's scratch window.
- Goal: measure per-class event rates and nanoseconds per dispatch at 20, 10 and 5 TPS under load, to feed PT-06d and PT-07 (0351 PT-01).
- Files (branch `telemetry/pt-01-census`, never pushed to main): CREATE `plugin/ledger-census/` (build file, `plugin.yml` named `LedgerCensus`, one class registering every allow-listed class with a counting executor and writing `class,count,nanos` to its log every 60 s, no exporter); the single edit of `plugin/settings.gradle.kts` (`include("ledger-census")`) stays on the branch; CREATE `docs/analysis/telemetry/paper-plugin/pt01-census-results.md` (the one file that is merged, by a docs-only PR).
- Steps: 1. Build the census jar. 2. Start `scratch-telemetry` without Ledger, with LedgerCensus mounted instead (the coder adds the bind in a local, uncommitted override file). 3. Load: 19 scripted Bodies (no Minds) plus `./geldar.ps1 bench` plus one Chunky run, per [scratch-test-plan.md](scratch-test-plan.md) section 4. 4. Collect the per-60-s log lines for each of the three tick rates. 5. Write the results table: events per second per class, ns per dispatch (total nanos over count, measured with `System.nanoTime` around the executor body in a second run with timing on 1 call in 64), the top 30 classes, the families over 5,000 per second, and the estimated series count (feeds the 0351 storage estimate).
- Tests: none (throwaway); the results file is the artifact. Acceptance: all three tick rates covered, every class in the allow-list appears (zero rows included), the run notes UTC times and the jar sha256.
- Checks: results file passes `check:repo`. The census jar is never copied to a live path.
- Commit: `PT-01 Census results on scratch (docs)` for the results file only.
- Do NOT: merge the throwaway module; run on the live Paper; run the bench and `test:live` at the same time (CLAUDE.md).

## PT-07a: curated registry, token bucket use, blocks and items

- Loader: Paper. Depends on: PT-03h, PT-03d (frozen API meanwhile). Size: M.
- Goal: the curated-log mechanism, with the first family. The other families are separate cards that replace stubs this card creates, so no later card edits shared files.
- Files: CREATE `PAPER/curated/CuratedFamily.java` (interface `void register(CuratedRegistry r)`), `PAPER/curated/CuratedRegistry.java`, `PAPER/curated/CuratedCollector.java`, `PAPER/curated/CuratedFamilies.java` (a fixed list of family class names, resolved with `Class.forName`, missing skipped, like `PaperCollectors`), `PAPER/curated/BlocksItemsFamily.java`; tests `PAPER_T/curated/CuratedRegistryTest.java`, `PAPER_T/curated/BlocksItemsFamilyTest.java`. That is 7 files; the interface and the list are a few lines each. The names listed in `CuratedFamilies`: `BlocksItemsFamily`, `ContainersSleepAnimalsFamily`, `CombatMovementFamily`, `TextContentFamily`, `OperatorAuditFamily`, `MiscFamily` (so PT-07b to 07f create only their own class).
- Steps: 1. `CuratedRegistry.on(Class<E>, String eventName, Severity, String[] fieldNames, boolean ignoreCancelled, Extractor<E>)`: registers one `MONITOR` executor per class through `ListenerRegistry`; the executor calls `guard.begin`, `extractor.extract(event, out)` into a main-thread-only reusable `FieldSink` (3 longs, 3 strings), then `EventLog.record(id, ...)`, then `guard.end`. The per-class rate is the `EventLog` token bucket (default 20 per second, config `rate.<eventName>`); excess is dropped and counted by the core. 2. `BlocksItemsFamily` registers: `BlockBreakEvent`, `BlockPlaceEvent`, `BlockMultiPlaceEvent`, `PlayerHarvestBlockEvent`, `PlayerBucketEmptyEvent`, `PlayerBucketFillEvent`, `PlayerItemConsumeEvent`, `PlayerItemBreakEvent`, `CraftItemEvent`, `FurnaceExtractEvent`, `EnchantItemEvent`, `EntityPickupItemEvent` (players only: filter `getEntity() instanceof Player`), `PlayerDropItemEvent`. Names `geldar.block.break`, `geldar.block.place`, `geldar.item.consume`, etc. Fields: l1=x, l2=y, l3=z (block position ints), s1=life_id, s2=material key string (`getType().name()` is a cached String, no allocation), s3=world name. 3. `CuratedCollector.start` instantiates families through `CuratedFamilies`, each in try/catch.
- Tests (fail when reverted): firing a `BlockBreakEvent` (constructed as in Geldar-Core's `GhostListenerTest`) with a fake registry records one event with the right fields; a non-player `EntityPickupItemEvent` records nothing; a family that throws in `register` leaves the others registered; no extractor calls any method named `set*` on the event (reflection-free: the test passes a proxy event that throws on any setter call); `stop()` unregisters (S10).
- Checks: `:ledger:test`; scratch rows V1 to V3. S1, S6, S8, S10.
- Commit: `PT-07a Curated event registry and blocks and items family (plugin)`.
- Do NOT: put sign, book or chat text here (PT-07d); register an excluded class; allocate per event beyond the Bukkit event itself.

## PT-07b: containers, sleep, animals and trade

- Loader: Paper. Depends on: PT-07a. Size: M.
- Goal: replace the stub `ContainersSleepAnimalsFamily` (named in `CuratedFamilies`).
- Files: CREATE `PAPER/curated/ContainersSleepAnimalsFamily.java`; test `PAPER_T/curated/ContainersSleepAnimalsFamilyTest.java`.
- Steps: register with `r.on(...)`: `InventoryOpenEvent` and `InventoryCloseEvent` (`geldar.container.open|close`, s2=container type from `getInventory().getType().name()`, position from `getInventory().getLocation()` if non-null, players only), `PlayerBedEnterEvent` (`geldar.sleep.enter`, **s2 = the `BedEnterResult` name for every result**, `ignoreCancelled=false` because a denied entry is the data), `PlayerBedLeaveEvent`, `PlayerDeepSleepEvent`, `PlayerTradeEvent` (`geldar.trade`, s2 = the villager profession name, key `geldar.subtype`), `EntityBreedEvent` (breeder player only), `EntityTameEvent` (owner player only), `PlayerShearEntityEvent`, `PlayerFishEvent` (state name). The s2 key is `geldar.result` for the bed-enter result, `geldar.container_type` for containers and `geldar.subtype` for trade, breed, tame, shear and fish (profession, animal type, fish state); none borrows `geldar.result`.
- Tests (fail when reverted): bed enter with `NOT_POSSIBLE_NOW` records the result name and the event is cancelled-state agnostic; container open for a null location records zeros; non-player breeder records nothing.
- Checks: `:ledger:test`; scratch row V4. S1, S8.
- Commit: `PT-07b Containers, sleep, animals and trade events (plugin)`.
- Do NOT: touch inventory contents (item names inside containers are not captured); mutate any event.

## PT-07c: combat, deaths, movement

- Loader: Paper. Depends on: PT-07a. Size: M.
- Goal: replace the stub `CombatMovementFamily`.
- Files: CREATE `PAPER/curated/CombatMovementFamily.java`; test `PAPER_T/curated/CombatMovementFamilyTest.java`.
- Steps: `EntityDamageByEntityEvent` and `EntityDamageEvent` only when a player is damager or victim (`geldar.combat.damage`, l1 = final damage x100 as long, l2 = role code in `geldar.role` (1 victim, 2 attacker, 3 pvp), s1=life_id, s2=damage cause name in `geldar.cause`), `PlayerDeathEvent` (`geldar.combat.player_death`, s2=cause name, the death message is **not** captured), `EntityDeathEvent` with a player killer (`geldar.combat.kill`, s2=entity type name in `geldar.subtype`; kill records non-player victims killed by a player: a `PlayerDeathEvent` reaches the same handler list and is skipped, player deaths are recorded by `player_death` only), `PlayerRespawnEvent`, `PlayerPostRespawnEvent`, `PlayerTeleportEvent` (`geldar.movement.teleport`, s2=cause name; cause `COMMAND` is the operator signal and also writes l3=1 in `geldar.flag`), `PlayerChangedWorldEvent`, `PlayerPortalEvent`, `PlayerGameModeChangeEvent` (s2=new mode). **Not `PlayerMoveEvent`** (census duty-cycled only).
- Tests (fail when reverted): damage with no player involved records nothing; teleport with cause COMMAND sets the operator flag; death message text never appears in the recorded strings.
- Checks: `:ledger:test`; scratch row V5. S1, S8.
- Commit: `PT-07c Combat, death and movement events (plugin)`.
- Do NOT: register `PlayerMoveEvent`, `EntityMoveEvent` (gated), or any event of the exclusion list.

## PT-07d: text content (chat, sign, book)

- Loader: Paper. Depends on: PT-07a, PT-03f. Size: M. Owner gate: content (0351 PT-07 flag `owner (content)`); merge needs the owner's go because it is full-text capture.
- Goal: OWNER-APPROVED full-text capture (0350 point 2: chat, sign text, book text; no opt-out during development; outside players included, 0350 point 3 gap stays open) delivered **only to the gateway** through `ContentLog`, never back into the world.
- Files: CREATE `PAPER/curated/TextContentFamily.java`, `PAPER/curated/PlainText.java` (adventure `PlainTextComponentSerializer` use, one static method); test `PAPER_T/curated/TextContentFamilyTest.java`.
- Steps: 1. `AsyncChatEvent` (`io.papermc.paper.event.player.AsyncChatEvent`, not the legacy `AsyncPlayerChatEvent`, which is excluded): `ContentLog.record(chatId, plainText(event.message()), life_id, world, "")`; record only non-cancelled events; **the handler does not touch `viewers()`, `renderer()`, `message(...)` setters or `setCancelled`**. 2. `SignChangeEvent`: lines joined with `\n`, position as a small string `x,y,z` in s2 (the frozen `ContentLog.record` takes strings only; a sign change is rare, so building one short string is within budget). 3. `PlayerEditBookEvent`: pages joined with `\f` (form feed) of the new meta, title if signing. 4. Two layers of bounding (changed after the first coder round: the original "this card does not cap" would let an unbounded component or book be converted on the main thread). The plugin bounds the READ before any conversion (max 100 book pages, max 1 MiB of characters in total, max 32 KiB per sign line; past a bound the text is cut and `[truncated by plugin bound]` is appended), then applies `Redactor.scrub` and `ContentCap` before `ContentLog.record`; the core sink keeps its own cap and scrub as the second layer. A 40 KB book arrives whole; a 10 MiB book is cut in under a second. Chat is async: its handler runs off the main thread, skips the `CollectorGuard` and uses only the thread-safe token bucket and ring offer. The sign position is the new event key `geldar.pos` (`x,y,z`). The book author and the chat recipients are never exported; the speaker is exported only as a life id.
- Tests (fail when reverted): a chat event record reaches `RecordingLedger.content()` with the message text; the event object is unchanged after the handler (message, viewers, cancelled flag); a 40 KB book arrives whole; a 10 MiB book is bounded in time (under 1 s) and size; a credential-looking string in chat is scrubbed before `ContentLog.record`; the async chat path never touches the guard; a human speaker carries no name; proxy-event test: any setter call fails; no source call to a setter.
- Checks: `:ledger:test`; scratch rows X1 to X3; the S1 source scan (PT-18a) must pass. S1, S2, S3, S5.
- Commit: `PT-07d Chat, sign and book content capture to the gateway (plugin)`.
- Do NOT: send, echo, log to the server console, or store this text anywhere but `ContentLog`; register `AsyncPlayerChatEvent` or `PlayerChatEvent`.

## PT-07e: operator audit and RCON handling

- Loader: Paper. Depends on: PT-07a, PT-03f. Size: M. Owner gate: content.
- Goal: replace the stub `OperatorAuditFamily`: console, RCON and broadcast text as audit content, without any secret or address.
- Files: CREATE `PAPER/curated/OperatorAuditFamily.java`; test `PAPER_T/curated/OperatorAuditFamilyTest.java`.
- Steps: 1. `ServerCommandEvent` (`geldar.console.command`) and `RemoteServerCommandEvent` (`geldar.rcon.command`; it extends `ServerCommandEvent`: register both classes, and in the console handler skip instances of the remote class so a command is recorded once): `ContentLog.record(id, event.getCommand(), senderKind, "", "")`, where `senderKind` is a fixed string (`console` or `rcon`). **The handler never calls `getSender().toString()`, never reads an address, and the plugin never reads `rcon.password`, `rcon.port` or `server.properties`.** 2. `BroadcastMessageEvent` (`geldar.broadcast`): if the class is `@Deprecated` in this paper-api, skip it, record the reason in the commit body and use `io.papermc.paper.event.server` alternatives only if one exists. 3. Whitelist events (`geldar.whitelist.*`): the Paper whitelist toggle/state event class if present; the changed player's name only as `life_id`. 4. The RCON echo audit stream is a gateway rule (PT-12), not here.
- Tests (fail when reverted): an RCON event's record has `senderKind=rcon` and the command text, and the recorded strings contain no address or sender object string (use a sender whose `toString()` returns an IPv4 address with a port; the test asserts it never appears); a console and an RCON event each yield exactly one record; the source reads no `rcon` property key (PT-18a scan covers lasting); a command text `rcon.password=hunter2` typed by an operator is recorded as text (it is content) but passes `Redactor.scrub` unchanged: documented limit in the card's Javadoc: **the plugin cannot know a secret typed as plain text; the gateway rules (PT-12) and the operator's discipline are the other layers**.
- Checks: `:ledger:test`; scratch rows X4 to X6. S1, S3, S4, S5.
- Commit: `PT-07e Console, RCON and broadcast audit (plugin)`.
- Do NOT: reply to the sender; dispatch a command; read configuration for RCON; record the sender's address or object string.

## PT-07f: raids, tab completion, plugin lifecycle, exceptions

- Loader: Paper. Depends on: PT-07a. Size: M.
- Goal: replace the stub `MiscFamily`.
- Files: CREATE `PAPER/curated/MiscFamily.java`; test `PAPER_T/curated/MiscFamilyTest.java`.
- Steps: `RaidTriggerEvent`, `RaidFinishEvent` (`geldar.raid.*`), `TabCompleteEvent` (`geldar.tabcomplete`: l1 = buffer length, s2 = sender kind `player|console`; **the typed buffer is not recorded**: assumption that tab-completion content is not wanted), `PluginEnableEvent`/`PluginDisableEvent` (`geldar.server.plugin_enabled|plugin_disabled`, s2 = plugin name), `ServerExceptionEvent` (`geldar.server.exception`, s2 = exception class name, s3 = the first stack frame as `Class.method`; **not the message**: exception messages can carry paths, tokens or addresses). Confirm each class and package when compiling (`ServerExceptionEvent` is a Paper class under `com.destroystokyo.paper.event.server`).
- Tests (fail when reverted): an exception whose message contains `hunter2` records no `hunter2`; tab complete records length not text; plugin enable records the name.
- Checks: `:ledger:test`; scratch row V6. S4, S5.
- Commit: `PT-07f Raid, tab completion, plugin lifecycle and exception events (plugin)`.
- Do NOT: record the typed buffer or any exception message.

## PT-08a: connection lifecycle and `mc_session`

- Loader: Split (ULID in core, listener in Paper). Depends on: PT-03h. Size: M.
- Goal: `geldar.player.join|quit|kick|prelogin` and the session id other player events use.
- Files: CREATE `CORE/ids/Ulid.java`, test `CORE_T/ids/UlidTest.java`; CREATE `PAPER/players/ConnectionCollector.java`, `PAPER/players/SessionIds.java`; test `PAPER_T/players/ConnectionCollectorTest.java`.
- Steps: 1. `Ulid.next()` (26-char Crockford base32, time-ordered, thread-safe monotonic within a millisecond). 2. `SessionIds`: concurrent map from UUID to ULID with `open`, `get`, `close`; used by PT-08b to 08d through a tiny read-only accessor. 3. Listeners (MONITOR): `AsyncPlayerPreLoginEvent` (read `getLoginResult()` and the name only; **never `getAddress()`/`getRawAddress()`**), `PlayerJoinEvent` (mints the ULID, record `geldar.player.join` with s1=life_id, s2=session id, l1=online count), `PlayerQuitEvent` (reason name, session length ms; closes the session), `PlayerKickEvent` (reason as plain text truncated to 200 chars in s2). **Not `PlayerLoginEvent`** (0351: triggers the login workaround).
- Tests (fail when reverted): `Ulid` is 26 chars, sorts by time, unique over 100,000 calls; join then quit share one session id and quit records a duration; a pre-login event with an address-bearing fake never copies the address (fake whose `getAddress()` throws; test passes only if it is never called); the source has no `PlayerLoginEvent` reference.
- Checks: `:ledger-core:test`, `:ledger:test`; scratch rows P1 to P3. S5, S10.
- Commit: `PT-08a Connection lifecycle events and session ids (plugin)`.
- Do NOT: call `Player#getAddress`; register `PlayerLoginEvent`; emit the kick message when it is longer than 200 characters.

## PT-08b: 60 s player snapshots

- Loader: Paper. Depends on: PT-03h, PT-08a (accessor; stub meanwhile). Size: M.
- Goal: `geldar.player.snapshot` per online player each 60 s, staggered at most 2 players per tick and 50 us per tick (0351 point 6).
- Files: CREATE `PAPER/players/SnapshotCollector.java`; test `PAPER_T/players/SnapshotCollectorTest.java`.
- Steps: 1. Every tick `everyTicks(1)` with a rotating cursor over `Bukkit.getOnlinePlayers()` snapshot taken once per 20 ticks into an array; for each of at most 2 players whose 60 s deadline passed, read position (block x, y, z), health, food level, XP level, game mode name, world name and ping (`Player#getPing`) on the main thread into a small preallocated struct array (primitives and already-existing strings only). An async `everyMillis(1000)` task drains the structs and calls `emitMap` (19 events a minute, so the allocation there is fine and is off the main thread). 2. Guard `begin/end` around the main-thread part; budget 50 us per tick.
- Tests (fail when reverted): 19 players are each snapshotted once per 60 s of fake ticks, never more than 2 per tick; a player joining mid-cycle is snapshotted within 60 s; the main-thread part never calls `emitMap` (fake HostInfo flags it); no address field.
- Checks: `:ledger:test`; scratch row P4. S5, S6, S7.
- Commit: `PT-08b Player snapshots (plugin)`.
- Do NOT: put any per-player value in a metric attribute; call `getAddress`; read inventories.

## PT-08c: progress events and stats-file reader

- Loader: Paper. Depends on: PT-03h. Size: M.
- Goal: `geldar.player.advancement` and `geldar.player.stats`.
- Files: CREATE `PAPER/players/ProgressCollector.java`, `PAPER/players/StatsFileReader.java`; tests `PAPER_T/players/StatsFileReaderTest.java`, `PAPER_T/players/ProgressCollectorTest.java`; test resource `plugin/ledger/src/test/resources/stats/sample.json`.
- Steps: 1. `PlayerAdvancementDoneEvent` (MONITOR): record the advancement key string (`getAdvancement().getKey().toString()`). 2. `StatsFileReader`: on an async `everyMillis(300000)`, for each online player read `<world folder>/stats/<uuid>.json` (the world folder path comes from the adapter at start), parse with gson, extract an **allow-list** of stats (`minecraft:custom` play_time, deaths, mob_kills, walk_one_cm; `minecraft:mined` total; `minecraft:crafted` total), emit one `geldar.player.stats` with `emitMap`. 3. A parse error (file mid-write; atomicity unverified) is retried once after 1 s and then skipped.
- Tests (fail when reverted): sample file yields exactly the allow-listed values; a truncated file is skipped without throwing; a stat key not in the allow-list is never emitted; the reader never runs on the main thread (fake HostInfo).
- Checks: `:ledger:test`; scratch row P5. S6.
- Commit: `PT-08c Advancement events and stats reader (plugin)`.
- Do NOT: write to the stats directory; read other players' files (offline players); block the main thread.

## PT-08d: client tick cadence and command-tree audit

- Loader: Paper. Depends on: PT-03h. Size: S.
- Goal: `geldar.player.client_tick` (per player, per minute: count of client tick end events, to see a stalled client) and `geldar.player.command_tree` (once per join: number of commands visible and a hash of the sorted names).
- Files: CREATE `PAPER/players/ClientCadenceCollector.java`, `PAPER/players/CommandTreeAudit.java`; test `PAPER_T/players/CadenceAndTreeTest.java`.
- Steps: 1. `ClientTickEndEvent` listener increments an `int` in a per-player slot (array by a stable player index kept in `SessionIds`-like map; no allocation per event); a 60 s async task emits and resets. Whether mineflayer sends the client tick-end packet is unverified: if the count stays zero on scratch the card reports it, it is not a failure. This is the one registration that duplicates the census (the census counts the class too); acceptable. 2. `PlayerCommandSendEvent`: `event.getCommands()` size and a hash (`Arrays.hashCode` of a sorted array built once per event); the command **names** are not recorded.
- Tests (fail when reverted): 100 tick events then the minute task emits 100 and resets; command tree event records the size and hash and never the names.
- Checks: `:ledger:test`; scratch row P6. S1 (Principle 1: the audit exists to show agents see no operator commands; the plugin never edits the tree).
- Commit: `PT-08d Client tick cadence and command-tree audit (plugin)`.
- Do NOT: call `getCommands().remove` or clear the collection (that would change what the player sees: S1); record command names.

## PT-08e: Velocity login and disconnect events (OPTIONAL, second adapter)

- Loader: Velocity adapter over the neutral core. Depends on: PT-03 api, PT-03g, PT-03a. Size: M. Needs the owner's nod (not in 0351); it proves the core is loader-neutral.
- Goal: `geldar.velocity.login` and `geldar.velocity.disconnect` from the proxy, with the same redaction and drop rules, in its own jar.
- Files: EDIT `plugin/settings.gradle.kts` (one line `include("ledger-velocity")`; the only existing-file edit; stack on PT-03a); CREATE `plugin/ledger-velocity/build.gradle.kts` (compileOnly velocity-api with the `velocity-brigadier` exclusion copied from `plugin/velocity-identity/build.gradle.kts`, `implementation(project(":ledger-core"))`), `plugin/ledger-velocity/src/main/java/dev/geldar/ledger/velocity/LedgerVelocity.java` (`@Plugin` main, `VelocityHostScheduler`, listeners for `PostLoginEvent` and `DisconnectEvent`); test file for the listeners; generated lockfile.
- Steps: 1. Same shell contract as PT-03h: never throws out of an event handler. 2. `PostLoginEvent`: record the username as life_id when `LifeIds.isLifeId`, the protocol version, the forwarding mode name; **never `getRemoteAddress`**. 3. `DisconnectEvent`: `getLoginStatus()` name. 4. Resource `service.name=geldar-velocity` comes from the agent properties of the Velocity process (outside this card).
- Tests (fail when reverted): a fake event whose `getRemoteAddress()` throws is handled; login for a non-life-id name drops the life_id key; `NoLoaderImportsTest` for `ledger-core` still passes (the Velocity import lives only in the new module).
- Checks: `:ledger-core:test`, `:ledger-velocity:test`. S5, S8.
- Commit: `PT-08e Velocity login and disconnect events over the neutral core (plugin)`.
- Do NOT: edit `plugin/velocity-identity`; add Velocity imports to `ledger-core`; register commands.
