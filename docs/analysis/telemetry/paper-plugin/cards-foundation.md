# Cards: foundation (PT-03a to PT-03l, PT-02a, PT-02b)

Read [README.md](README.md) first: path aliases, frozen API, frozen names and the rules every card inherits (commit trailers, size cap, targeted checks). Safety rules S1 to S12 are in [safety-rules.md](safety-rules.md).

---

## PT-03a: module skeleton and build wiring

- Loader: repo (both modules). Depends on: nothing. Size: S. Start: immediately, first.
- Goal: two empty Gradle subprojects that build, lock and test, with the loader-neutral boundary enforced from day one.
- Files:
  - EDIT `plugin/settings.gradle.kts`: add `include("ledger-core")` and `include("ledger")` after the existing two.
  - EDIT `plugin/gradle/libs.versions.toml`: add pins `opentelemetry-api` 1.67.0 (`io.opentelemetry:opentelemetry-api`). Do NOT add `spark-api`: a `-SNAPSHOT` declaration is not checksum-verified by Gradle (proven), so PT-04c pins it with a verified artifact. Reuse existing `junit`, `junit-platform-launcher`, `paper-api`.
  - EDIT `plugin/README.md`: one paragraph: modules `ledger-core` (no loader imports) and `ledger` (Paper adapter).
  - CREATE `plugin/ledger-core/build.gradle.kts`: `java-library`, `java-test-fixtures`, toolchain 25, `implementation(libs.opentelemetry.api)`, JUnit as in `plugin/core/build.gradle.kts`; `tasks.test { useJUnitPlatform() }`.
  - CREATE `plugin/ledger/build.gradle.kts`: `java-library`, toolchain 25, `compileOnly(libs.paper.api)`, `compileOnly(libs.gson)` (Paper provides gson; PT-08c parses stats files with it), `testImplementation(libs.gson)`, `compileOnly(libs.bluemap.api) { isTransitive = false }` (PT-10b needs it; declaring it here keeps later cards off this file), `implementation(project(":ledger-core"))`, `implementation(libs.opentelemetry.api)`, `testImplementation(libs.paper.api)`, `testImplementation(testFixtures(project(":ledger-core")))`, JUnit. `tasks.jar`: `archiveBaseName = "ledger"`, `archiveVersion = ""`, `duplicatesStrategy = EXCLUDE`, a guarded line `if (file("census.gradle.kts").exists()) apply(from = "census.gradle.kts")` (PT-06b creates that file, so it never edits this one), copy `runtimeClasspath` jars with the same excludes as `plugin/core/build.gradle.kts` (copy that block).
  - CREATE `plugin/ledger/src/main/resources/plugin.yml`: `name: Ledger`, `main: dev.geldar.ledger.paper.LedgerPlugin`, `version: "${version}"`, `api-version: "26.1"`, `description: Server statistics.`, `softdepend: [spark, Chunky, BlueMap, CoreProtect]`. No `commands:`, no `permissions:`. Add `processResources` expand as in core.
  - CREATE `plugin/ledger-core/src/test/java/dev/geldar/ledger/core/NoLoaderImportsTest.java`.
  - Generated: `plugin/ledger-core/gradle.lockfile`, `plugin/ledger/gradle.lockfile`, `plugin/settings-gradle.lockfile` (edit only via `--write-locks`).
- Steps: 1. Edit settings and the version catalog. 2. Create both build files and `plugin.yml`. 3. Write `NoLoaderImportsTest`: walks `plugin/ledger-core/src` (path from a system property set in `tasks.test`), reads every `.java`, fails when any line matches `^import\s+(org\.bukkit|io\.papermc|com\.destroystokyo|net\.minecraft|net\.fabricmc|net\.neoforged|com\.velocitypowered|net\.kyori)`. 4. Add one placeholder class per module so the jars are not empty (`package-info.java` is enough). 5. `(cd plugin; ./gradlew :ledger-core:dependencies :ledger:dependencies --write-locks)`; commit the lockfiles. 6. `./gradlew :ledger-core:test :ledger:jar`.
- Tests (fail when reverted): `NoLoaderImportsTest` passes on the clean tree and a temporary file `Bad.java` containing `import org.bukkit.Bukkit;` under `ledger-core/src/main` makes it fail (the coder shows this once, then deletes the file). A second test asserts `plugin.yml` has no `commands:` and no `permissions:` key (read the resource; fails if either is added).
- Checks: `:ledger-core:test`, `:ledger:jar`, `ls plugin/ledger/build/libs/ledger.jar`; `unzip -l` shows `plugin.yml` and the OpenTelemetry API classes. Lockfiles committed. Common rules.
- Commit: `PT-03a Ledger module skeleton and build wiring (plugin)`.
- Do NOT: touch `plugin/core` or `plugin/velocity-identity`; add a dependency not named above; relocate OpenTelemetry (0351 point 1); name anything with "telemetry".

## PT-03 api: core API, names, attribute lists, config (PT-03b1 + PT-03b2 + PT-03c as ONE packet)

- Decision 2026-11-17: PT-03b1, PT-03b2 and PT-03c are mutually dependent (`Ledger` declares `LedgerConfig config()`; `LedgerConfig` and `ConfigWatcher` need `HostScheduler` and `Cancellable`), so they ship as ONE packet "PT-03 api" (done on branch telemetry/t40-pt03b1; integration branch telemetry/t60-paper-int). The three sections below stay as the spec of its parts.
- Loader: Neutral. Depends on: PT-03a. Size: M. Start: after PT-03a.
- Goal: the interfaces of README section 3 plus the name registry, with the validation rules.
- Two packets, because one type per file makes the interfaces alone 14 files (interface files are a few lines each, so the 6-file cap is waived for PT-03b1 only; PT-03b2 has 6):
  - **PT-03b1 (interfaces, no logic, no test needed beyond compiling):** CREATE under CORE: `Severity.java`, `Ledger.java`, `Counter.java`, `BoundCounter.java`, `Histogram.java`, `BoundHistogram.java`, `EventLog.java`, `ContentLog.java`, `CollectorGuard.java`, `Collector.java`, `CollectorContext.java`, `HostScheduler.java`, `HostInfo.java`, `Cancellable.java`. Commit `PT-03b1 Core API interfaces (plugin)`.
  - **PT-03b2 (names and rules):** CREATE under CORE: `Attrs.java`, `Names.java`, `AttrKeys.java`, `NameRules.java`; tests `CORE_T/NameRulesTest.java`, `CORE_T/AttrKeysTest.java`. Commit `PT-03b2 Names, attribute allow-list and rules (plugin)`. Part of the same packet as PT-03b1 and PT-03c (not independently startable).
- Steps: 1. Copy the signatures from README section 3 exactly, Javadoc each with its threading rule. 2. `Names`: public static final String constants for every metric and event name of README section 4 (grouped by nested class per owner card). 3. `AttrKeys`: the canonical set; `static boolean allowed(String key)`; `static boolean metricAllowed(String key)` which accepts only the BARE metric keys of README section 4 (`window`, `stat`, `scope`, `gc`, `group`, `class_group`, `op`, `kind`, `area`, `world`, `queue`, `collector`, plus the census keys named there) and is false for every `geldar.*` key, `minecraft.player.uuid` and free-text keys (S7). `allowed` covers the event/log keys (`geldar.*`) listed in README section 4; the two lists are separate. 4. `NameRules`: `isMetricName` matches `^geldar_[a-z0-9_]+$`; `isEventName` matches `^geldar(\.[a-z0-9_]+)+$`; `requireMetricName` throws `IllegalArgumentException`. 5. `Attrs`: immutable builder (`str`, `lng`, `dbl`, `bool`, `build`), values null-checked.
- Tests (fail when reverted): `NameRulesTest` rejects `tick_lag`, `geldar_Tick`, accepts `geldar_tick_lag_ms`; every constant in `Names` passes `NameRules` (reflection over `Names` fields; fails if a constant is added that breaks the rule); `AttrKeysTest`: `metricAllowed("geldar.life_id")` is false, `metricAllowed("queue")` is true, `metricAllowed("geldar.queue")` is false, `allowed("minecraft.player.uuid")` is true, `allowed("password")` is false.
- Checks: `:ledger-core:test`; `NoLoaderImportsTest` still green. S7.
- Commit: `PT-03b Core API, names and attribute allow-list (plugin)`.
- Do NOT: add an implementation here; import OpenTelemetry types into any public signature; add a name that README section 4 does not list.

## PT-03c: config schema and 5 s reload

- Loader: Neutral. Depends on: PT-03 api (shipped in the same packet as PT-03b1 and PT-03b2; `ConfigWatcher` needs `HostScheduler`). Size: M.
- Goal: `LedgerConfig` (immutable snapshot) parsed from a `.properties` file, validated, re-read every 5 s, last good config kept on a bad file.
- Files: CREATE `CORE/LedgerConfig.java`, `CORE/ConfigParser.java`, `CORE/ConfigWatcher.java`; tests `CORE_T/ConfigParserTest.java`, `CORE_T/ConfigWatcherTest.java`; CREATE `docs/analysis/telemetry/paper-plugin/config-reference.md` is NOT created; the keys are documented in the Javadoc of `LedgerConfig`.
- Steps: 1. Keys (all defaults in code): `enabled=true` (master), `collector.<id>.enabled=true`, `collector.<id>.budget_avg_us` (default 50), `collector.<id>.budget_max_us` (250), `collector.census.duty.<EventClass>=<on_ticks>/<period_ticks>`, `rate.<eventName>=<per second>` (default 20), `queue.<name>.capacity` (default 4096, min 64, max 65536), `content.max_bytes=32768` (hard max 32768), `stall.threshold_ms=2000`, `sample.world_every_ticks=200`, `sample.player_every_ticks=20`, `jfr.enabled=true`. 2. `ConfigParser.parse(Properties) -> ParseResult` with errors list; unknown keys are errors; any key whose name ends with `password`, `secret`, `token`, `key` or `authorization` (case-insensitive) is a hard error and the whole file is rejected (S4). 3. `ConfigWatcher(Path, HostScheduler, Consumer<LedgerConfig>)`: schedules `everyMillis(5000)`; reads only when mtime or size changed; on parse error keeps the previous config and logs once per distinct error; a missing file means defaults; swap through `AtomicReference`. 4. `LedgerConfig.disabled()` factory for the master-off state.
- Tests (fail when reverted): defaults when file is empty; `enabled=false` yields all collectors off; unknown key rejected; `rcon_password=x` rejected and nothing is applied; a file edited to invalid after a valid one keeps the old snapshot; watcher with a fake scheduler picks up a valid edit on the next tick and ignores an unchanged file (count of file reads).
- Checks: `:ledger-core:test`. S4, S6 (no I/O on the main thread: the watcher uses `everyMillis` only; a test asserts it never calls `everyTicks`).
- Commit: `PT-03c Ledger config schema and reload (plugin)`.
- Do NOT: use YAML or Bukkit config; read `server.properties`; add a command or a file watcher thread of your own.

## PT-03d: rings, emitter thread, token bucket, drop counters

- Loader: Neutral. Depends on: PT-03 api (starts only when it is on the integration branch). Size: M. Start: immediately.
- Goal: the bounded, non-blocking, dropping pipeline between the hot path and the exporter (0351 point 8).
- Files: CREATE `CORE/EventRing.java` (preallocated slots: 3 longs, 3 strings, event id, timestamp), `CORE/TokenBucket.java`, `CORE/Emitter.java` (one daemon thread drains rings into a `Sink` interface), `CORE/Sink.java`, `CORE/DropCounters.java`; tests `CORE_T/EventRingTest.java`, `CORE_T/TokenBucketTest.java`, `CORE_T/EmitterTest.java`.
- Steps: 1. Ring: single-producer-friendly but safe for many producers (CAS on a write index), power-of-two capacity, `offer(...)` returns false when full and never blocks, never allocates (slots reused). 2. `TokenBucket(ratePerSecond, nanoClock)`: `tryTake()` O(1), burst equals rate. 3. `Emitter`: drains in batches of up to 256 every 50 ms, stops on `close()` within 1 s, catches every `Throwable` from the sink, never lets it kill the thread, counts `sinkErrors`. 4. `DropCounters`: per-queue `LongAdder`, names from README (metric attribute `queue`; `geldar.queue` is the event-side key).
- Tests (fail when reverted): full ring drops and counts, never blocks (offer returns within a bound with 1 million offers on a full ring); no allocation on the hot path (compare `ThreadMXBean` allocated bytes before and after 100k offers: under a small constant; `com.sun.management.ThreadMXBean` is allowed in tests); token bucket gives exactly `rate` in a second of fake time; a sink that throws and a sink that blocks for 5 s do not stop offers (producer thread still returns) and drops are counted.
- Checks: `:ledger-core:test`. S6.
- Commit: `PT-03d Bounded rings, emitter and token bucket (plugin)`.
- Do NOT: use `BlockingQueue`, `synchronized` on the offer path, `forceFlush`, or any I/O in `offer`.

## PT-03e: collector guard

- Loader: Neutral. Depends on: PT-03 api (starts only when it is on the integration branch). Size: S. Start: immediately.
- Goal: `CollectorGuard` implementation: timing on 1 call in 1,024, average and per-call budgets, automatic switch-off (0351 point 6).
- Files: CREATE `CORE/BudgetGuard.java`, `CORE/GuardRegistry.java`; test `CORE_T/BudgetGuardTest.java`.
- Steps: 1. `begin()` increments a counter; every 1,024th call returns `System.nanoTime()`, else 0. 2. `end(token)` with token 0 returns at once; else computes elapsed; a single call over `budget_max_us` or a running average over `budget_avg_us` (per-tick average supplied by the collector through `tickAverageUs(double)` if it samples per tick; default is the per-call mean) calls `disable(reason)`: sets `allowed()` false, sets a flag read by the `geldar_paper_collector_disabled{collector}` gauge, logs once through a `Logger` supplied at construction. 3. `reenable()` only from the config reload or plugin restart. 4. `GuardRegistry.guard(id, LedgerConfig)` returns one per id; reload updates budgets and re-enables only if the config flips `enabled` false then true.
- Tests (fail when reverted): over-budget call disables and the log line appears exactly once; under budget stays allowed; only about 1 in 1,024 calls costs a `nanoTime`; `allowed()` stays false after more under-budget calls until `reenable()`.
- Checks: `:ledger-core:test`. S6, S8.
- Commit: `PT-03e Collector budget guard (plugin)`.
- Do NOT: sleep, lock, or allocate in `begin` and `end`.

## PT-03f: redactor and content cap

- Loader: Neutral. Depends on: PT-03 api (starts only when it is on the integration branch). Size: S. Start: immediately.
- Goal: the one place that scrubs values and caps text, used by the OTel binding for every attribute and every content record (S4, S5).
- Files: CREATE `CORE/Redactor.java`, `CORE/ContentCap.java`, `CORE/ids/LifeIds.java`, `CORE/ids/OfflineUuid.java`; tests `CORE_T/RedactorTest.java`, `CORE_T/ContentCapTest.java`, `CORE_T/ids/IdsTest.java`. Six files, with the two id helpers small.
- Steps: 1. `Redactor.keyIsCredential(String key)`: case-insensitive match on `password|passwd|secret|token|authorization|api[_-]?key|cookie|credential|private[_-]?key`. 2. `Redactor.scrub(String value)`: replaces IPv4 literals and IPv6 literals (including `::1`-style and bracketed with port) with `[addr]`; leaves everything else byte-identical. 3. `ContentCap.cap(String text, int maxBytes)`: truncates at a UTF-8 boundary at `maxBytes` (default 32768) and appends the marker ` [truncated:<originalBytes>]`; strings under the cap are returned unchanged (same instance). 4. `Redactor.redactAttr(key, value)`: if the key is credential-looking return `[redacted]`; if the value is a String return `scrub(value)`. 5. `LifeIds.isLifeId(String)`: the same pattern as `EventEnvelope.isLifeId` in `plugin/core` (the coder reads that method and copies the regex, not the class; `plugin/core` is not a dependency). 6. `OfflineUuid.of(String name)`: `UUID.nameUUIDFromBytes("OfflinePlayer:" + name)` in UTF-8, the offline UUID Velocity and Paper use (`AgentSkinLookup.java:46-47`).
- Tests (fail when reverted): `OfflineUuid.of("Adam")` equals the UUID the coder computes from the same recipe in the test and `LifeIds` accepts and rejects the same table as `EventEnvelope` (the coder copies 6 sample names from `EventEnvelopeTest`); `rcon.password` key redacted; an RFC 1918 IPv4 literal, a documentation-range IPv6 literal and a bracketed loopback IPv6 with a port scrubbed from text; a chat line with no address is byte-identical; 40,000-byte text is capped to 32,768 bytes with the marker and stays valid UTF-8 (cut inside a 3-byte char); a 100-byte text is the same instance.
- Checks: `:ledger-core:test`. S4, S5.
- Commit: `PT-03f Redactor and content cap (plugin)`.
- Do NOT: log the redacted value; use regexes with catastrophic backtracking (the coder runs the IPv6 test on a 50 KB adversarial string and requires under 200 ms); touch gateway rules (PT-12).

## PT-03n: newer TypeScript redaction rules in the Java free-text scrub

- Loader: Neutral. Depends on: PT-03m (`CredentialScrub`) and T-06d1b (PR #606). Size: S.
- Goal: the Java free-text scrub hides what the TypeScript `scrubText` hides after #606, with the same ordinary-text exceptions.
- Files: CREATE `CORE/FlagScrub.java`; EDIT `CORE/CredentialScrub.java`, `CORE/KeyValueScrub.java`, `CORE/CredentialKeys.java`; tests `CORE_T/CredentialScrubFlagsTest.java`, `CORE_T/CredentialScrubLinearTest.java`.
- Rules: (1) `--password`, `--passwd`, `--token`, `--secret`, `--api-key`, `--apikey` followed by a space or tab and a value (bare or quoted) hide the value when it looks secret; `--password-file /x`, `--secret-name abc`, `use --token option` and a value starting with `-` stay; `-p VALUE` is not a rule. (2) lower-case `curl -u` / `--user name:secret` keeps the name and hides the secret; a secret starting with `/` stays. (3) URL query (after `?` or `&`): `sig`, `X-Amz-Credential`, `X-Amz-Signature` always hidden; `key` and `code` only with a value of 16 or more characters. (4) `AccountKey` (pair `account` + `key`) hidden anywhere. All scanners are single hand-written passes (no regex on user text).
- Checks: `:ledger-core:test`.
- Commit: `PT-03n Port the newer TypeScript redaction rules (plugin)`.

## PT-03g: OpenTelemetry binding (`OtelLedger`)

- Loader: Neutral. Depends on: PT-03 api, 03d, 03e, 03f (code against the frozen API meanwhile). Size: M.
- Goal: the `Ledger` implementation over the OpenTelemetry **API**: metrics through `Meter`, events through the logs bridge `Logger`, no SDK, no exporter. Without an agent the API is a no-op and the binding allocates no queue growth (S12).
- Files: CREATE `CORE/OtelLedger.java`, `CORE/OtelEventSink.java` (implements `Sink` from PT-03d, runs on the emitter thread, applies `Redactor` and `AttrKeys.allowed`), `CORE/LedgerBootstrap.java` (`create(LedgerConfig, HostInfo, Logger) -> Ledger`, picks `GlobalOpenTelemetry.get()`, reports `agentPresent` by comparing with `OpenTelemetry.noop()`); tests `CORE_T/OtelLedgerTest.java` (using only the API plus a recording `Sink`; no SDK test dependency is added: use the recording Sink and test counters through a fake `Meter` shim only if the API allows; else test the redaction and drop logic against `Sink` and leave metric export to PT-15).
- Steps: 1. Metrics: `counter()`/`histogram()` create instruments; `bind(values)` builds `Attributes` once, validated by `AttrKeys.metricAllowed` (S7: throws at bind, never at record). 2. Events: `EventLog.record` offers to the ring when `config.enabled` and the event's token bucket allows; `OtelEventSink` builds the log record on the emitter thread (`logger.logRecordBuilder().setBody(eventName)`, attribute `event.name`, severity, only allow-listed attributes, values through `Redactor.redactAttr`; when `geldar.life_id` is present and `LifeIds.isLifeId` accepts it, add `minecraft.player.uuid` = `OfflineUuid.of(name)`; when it is not a life id, drop `geldar.life_id`). 3. `ContentLog.record`: caps with `ContentCap`, then `Redactor.scrub`, then the same ring. 4. If no agent is present: `record` returns at once without touching the ring (S12). 5. Master switch off (`config.enabled=false`): same early return.
- Tests (fail when reverted): with `agentPresent=false`, 1,000 `record` calls leave the ring empty; a `password` attribute never reaches the sink; a content text over 32 KiB reaches the sink capped; binding a metric attribute `geldar.life_id` throws; a sink that blocks leaves `record` returning in under 1 ms (S6).
- Checks: `:ledger-core:test`; `NoLoaderImportsTest`. S4, S5, S6, S7, S12.
- Commit: `PT-03g OpenTelemetry binding for the core (plugin)`.
- Do NOT: depend on the SDK or an exporter; call `forceFlush`; set resource attributes here (the agent does, PT-02b); log content text anywhere except the OTel record.

## PT-03h: Paper adapter shell, collector and listener registry

- Loader: Paper. Depends on: PT-03 api, 03c (frozen API meanwhile). Size: M.
- Goal: the Paper plugin that loads, never takes the server down, builds the core, starts collectors by name and removes every listener on disable.
- Files: CREATE `PAPER/LedgerPlugin.java`, `PAPER/PaperHostScheduler.java`, `PAPER/PaperHostInfo.java`, `PAPER/PaperCollectors.java`, `PAPER/ListenerRegistry.java`; tests `PAPER_T/LedgerPluginTest.java`, `PAPER_T/ListenerRegistryTest.java`.
- Steps: 1. `LedgerPlugin.onEnable` wraps everything in `try/catch (Throwable)`: on failure log once and `getServer().getPluginManager().disablePlugin(this)`; **never** `shutdown()` (0351 point 1). 2. Config path `<dataFolder>/ledger.properties`; no `saveDefaultConfig`; create nothing on disk. 3. `PaperHostScheduler`: `everyTicks` -> `Bukkit.getScheduler().runTaskTimer`, `everyMillis` -> `runTaskTimerAsynchronously` (period converted, min 1 tick). `PaperHostInfo`: `serverTick()` -> `Bukkit.getCurrentTick()`, `isMainThread()` -> `Bukkit.isPrimaryThread()`, `loaderName()` -> `"paper"`. 4. `PaperCollectors`: a fixed `List<String>` of collector class names (all planned collectors of PT-04b to PT-10b, fully qualified, listed once here), loaded with `Class.forName`, instantiated by no-arg constructor, `ClassNotFoundException` skipped silently; each started inside `try/catch (Throwable)` that disables only that collector. 5. `ListenerRegistry.register(Listener, ...)` records every registered listener; `unregisterAll()` calls `HandlerList.unregisterAll(listener)` for each; `onDisable` and a config flip to `enabled=false` call `unregisterAll()` and `stop()` on every collector, in reverse order. 6. Config-driven: `ConfigWatcher` callback starts or stops collectors per `collector.<id>.enabled`.
- Tests (fail when reverted): a collector whose `start` throws is disabled and the others still start; `onEnable` with a throwing core factory disables the plugin and does not call `shutdown`; after `unregisterAll()` every `HandlerList` of the registered event classes has zero Ledger listeners (S10); flipping master off through the watcher stops every collector; a missing collector class name is skipped.
- Checks: `:ledger:test`. S8, S9, S10.
- Commit: `PT-03h Paper adapter shell and collector registry (plugin)`.
- Do NOT: register any command or permission; call `Bukkit.shutdown`; load chunks; write to disk; add a collector implementation (only names in `PaperCollectors`).

## PT-03i: test fixtures

- Loader: Neutral. Depends on: PT-03 api (starts only when it is on the integration branch). Size: S. Start: immediately.
- Goal: shared fakes so collector cards test without the agent: `RecordingLedger`, `FakeHostScheduler`, `FakeHostInfo`, `FakeClock`.
- Files: CREATE under CORE_F: `RecordingLedger.java` (records every counter add, histogram record, `EventLog.record` and `emitMap` call, content record; exposes `counter(name, attrValues)`, `events(name)`), `FakeHostScheduler.java` (manual `advanceTicks(n)`, `advanceMillis(n)`, records cancels), `FakeHostInfo.java`, `FakeClock.java`; test `CORE_T/RecordingLedgerTest.java`.
- Steps: implement the frozen API with no OTel; `FakeHostInfo.isMainThread()` is settable so tests can assert that a gauge reader or `emitMap` is not called on the main thread.
- Tests (fail when reverted): recording captures what was bound; `FakeHostScheduler` fires `everyTicks(20)` once per 20 advanced ticks; main-thread flag works.
- Checks: `:ledger-core:test`.
- Commit: `PT-03i Ledger test fixtures (plugin)`.
- Do NOT: put fixtures in `src/main`; depend on the real binding.

## PT-03j: scratch.sh accepts `telemetry` and per-run ports

- Loader: scratch tooling. Depends on: nothing. Size: S. Start: immediately.
- Goal: the owner's rule: the scratch project is `scratch-telemetry`, separate from `scratch-a`. Finding: `deploy/scratch/scratch.sh` allows a suffix of at most 8 characters and `telemetry` has 9.
- Files: EDIT `deploy/scratch/scratch.sh` (suffix limit and the two messages and the header comment, lines 4 and 33 to 38); EDIT `tools/repo-checks/src/scratch-overlay.test.ts` (the test at line 532 uses `toolongsuffix`, which stays too long at 9; add a case that `telemetry` is accepted and `toolongsuffix` (13) is refused); CREATE `deploy/scratch/telemetry.env` (plain `KEY=value` lines, committed, no secrets): `SCRATCH_PG_PORT=25432`, `SCRATCH_NATS_PORT=24222`, `SCRATCH_NATS_MON_PORT=28222`, `SCRATCH_MC_PORT=45565`, and any other published port in `compose/opt-in/scratch.yml` (the coder reads that file and offsets each by +10000 from the default so none equals a `scratch-a` default).
- Steps: 1. Change the limit from 8 to 9 everywhere it appears (regex message `[a-z0-9]{1,9}`). 2. Add the env file; document in the file header that it is sourced by the operator, never by the script. 3. Add the test that every port value in `telemetry.env` differs from the default in `scratch.yml` (parse both).
- Tests (fail when reverted): `up telemetry` passes the suffix check and reaches the compose call (use the existing stub harness in the test file); `up toolongsuffix` still exits 2 with no docker call; the port-disjointness test fails if a default port is copied.
- Checks: `pwsh -NoProfile -File ./geldar.ps1 pnpm check:repo` and the vitest file `scratch-overlay`: `pwsh -NoProfile -File ./geldar.ps1 pnpm test scratch-overlay`. S12 n/a.
- Commit: `PT-03j scratch.sh: allow the telemetry project and its own ports (deploy)`.
- Do NOT: change any `scratch-a` default; start a stack; edit `compose/opt-in/scratch.yml` here (PT-03k does).

## PT-03k: scratch-telemetry overlay, OTLP sink, verify script

- Loader: scratch tooling. Depends on: PT-03j. Size: M.
- Goal: a second overlay used only with the `telemetry` project: the Ledger jar mounted into Paper, an optional agent mount, Paper's 15 GiB limit (only here, never live), a throwaway OTLP/HTTP receiver reachable as `geldar-gateway:4318`, and a script that counts what arrived.
- Files: CREATE `compose/opt-in/scratch-telemetry.yml`; CREATE `deploy/scratch/telemetry-verify.sh`; EDIT `deploy/scratch/scratch.sh` (append `-f "$ROOT/compose/opt-in/scratch-telemetry.yml"` to both compose lines when `PROJECT = scratch-telemetry`; the file is edited by PT-03j too, so stack this branch on PT-03j); CREATE `tools/repo-checks/src/scratch-telemetry.test.ts`; CREATE `docs/runbooks/scratch-telemetry.md` (short: start, verify, stop, the 15 GiB note).
- Steps: 1. Overlay: service `paper`: `deploy.resources.limits.memory: 15360m`, `memswap_limit: 15360m`, `cpus: "6"` (PROPOSED; the coder keeps the existing scratch CPU if the host has fewer), env `MEMORY: ${PAPER_MEMORY:-10G}`, `JAVA_AGENTS` only from `${SCRATCH_OTEL_AGENT_JAR}` when set, bind mounts read-only: `plugin/ledger/build/libs/ledger.jar -> /plugins/ledger.jar`, the agent jar, `compose/paper/otel-agent.properties` (from PT-02b), and a Ledger config file `deploy/scratch/ledger.properties` (CREATE, defaults with `enabled=true`). 2. Service `otel-sink`: an OTLP/HTTP receiver image pinned by digest (at least two weeks old; the coder chooses and records the digest and the date), network alias `geldar-gateway`, listens on 4318, **no published ports**, writes JSON lines to a bind mounted host directory `${SCRATCH_TELEMETRY_OUT:?set}`, memory 512m, `restart: "no"`, label `geldar.scratch: "true"`. 3. `telemetry-verify.sh <kind> <name> [expect]`: `kind` is `metric` or `event`; greps the sink's JSON lines for the name, prints the count and the last value, exits 1 when the count is 0. Also `telemetry-verify.sh absent <string>` exits 1 when the string occurs (used for secrets and addresses, S4, S5). 4. Test file: parses the overlay (YAML) and asserts: Paper limit is exactly 15360m only in this overlay, no `ports:` on `otel-sink`, the sink alias is `geldar-gateway`, no key or value looks like an IP other than `127.0.0.1`, every service has the scratch label and `restart: "no"`, `compose/opt-in/scratch.yml` itself is unchanged (reads it and asserts Paper memory there is still 3072m).
- Tests (fail when reverted): above; plus the verify script run against a fixture JSONL: found, not found, absent.
- Checks: `pwsh -NoProfile -File ./geldar.ps1 pnpm check:repo`, vitest `scratch-telemetry` and `scratch-overlay`; `docker compose -p scratch-telemetry -f compose/phase0.yml -f compose/opt-in/scratch.yml -f compose/opt-in/scratch-telemetry.yml config` succeeds (the coder only runs `config`, never `up`).
- Commit: `PT-03k scratch-telemetry overlay, OTLP sink and verify script (deploy)`.
- Do NOT: raise any limit on a live compose file; publish the sink port; point the scratch Paper at the real gateway; run `up`.

## PT-03l: CI jar and compose mount (HELD)

- Loader: deploy. Depends on: PT-03h. Size: S. Status: PR-only, held until the PT-16 window (touches `compose/colo.yml`; the merge rule excludes colo-images path files).
- Goal: `ledger.jar` is built by CI like the other plugin jars and can be mounted read-only on the live Paper, off until the owner's window.
- Files: EDIT `.github/workflows/plugin-jars.yml` (copy `plugin/ledger/build/libs/ledger.jar` with the other jars and into the sha256 list; pin by commit SHA is already the file's convention); EDIT `compose/colo.yml` (one bind, read-only, `${GELDAR_STATE_DIR}/ledger/ledger.jar` -> `/plugins/ledger.jar`, same style as the Chunky line; the node supplies the jar, so a missing file is the node's step, not CI's); do NOT add `ledger.jar` to `REQUIRED_JARS` in `deploy/genesis/verify-plugin-jars.sh`.
- Tests (fail when reverted): the existing compose and repo-check tests keep passing; add a repo-check assertion that the Ledger bind is `read_only: true` and not listed in any healthcheck.
- Checks: `check:repo`.
- Commit: `PT-03l ledger.jar in CI and a read-only Colo mount, held (deploy)`.
- Do NOT: merge; set `JAVA_AGENTS`; change memory limits (node step); touch the healthcheck.

## PT-02a: agent lock, fetch, mount (HELD)

- Loader: deploy. Depends on: nothing. Size: M. Status: PR-only, held (touches `deploy/common.sh` and `compose/colo.yml`).
- Goal: 0351 PT-02: the OpenTelemetry Java agent 2.33.1 is a verified, read-only file, loaded by `JAVA_AGENTS`, off unless set. The `JAVA_AGENTS` variable (itzg) passes a bare `-javaagent`, and the PT-02b properties file is read only when the agent is given `otel.javaagent.configuration-file`; this card must therefore also set `OTEL_JAVAAGENT_CONFIGURATION_FILE=/otel/agent.properties` (or `-Dotel.javaagent.configuration-file=...`) next to the properties bind, in the same window-only manner as `JAVA_AGENTS`.
- Files: CREATE `deploy/otel-agent.lock.json` (version 2.33.1, URL of the release asset on the project's release page, sha256 and sha512: the coder **downloads the jar once on a dev machine, computes both hashes, and records them**; the download is the one allowed network step; the file the coder computes the hashes from is not committed); EDIT `deploy/common.sh` (a `fetch_otel_agent` function modelled on the BlueMap, Chunky and CoreProtect fetch next to line 238: verify both hashes, write to `$STATE_DIR/otel/opentelemetry-javaagent.jar`, mode 0444, refuse on a mismatch); EDIT `compose/colo.yml` (read-only binds to `/otel/agent.jar` and the PT-02b properties file at `/otel/agent.properties`, the option `otel.javaagent.configuration-file` pointing at it, and `JAVA_AGENTS` **not set**; the node sets it in the window); CREATE `tools/repo-checks/src/otel-agent-lock.test.ts`.
- Steps: follow the three existing jar fetches line by line; add the lock reader with the same JSON-parse style as the others.
- Tests (fail when reverted): the compose file names `otel.javaagent.configuration-file` (or its environment form) with the path of the properties bind; lock file has a 64-hex sha256 and 128-hex sha512 and a pinned version; `colo.yml` contains no `JAVA_AGENTS` value; the bind is read-only; a fetch stub with a wrong hash fails (extend the existing common.sh test harness if there is one; else test the lock only and say so).
- Checks: `check:repo`.
- Commit: `PT-02a OpenTelemetry agent lock, fetch and read-only mount, held (deploy)`.
- Do NOT: set `JAVA_AGENTS`; add an endpoint; change Paper's memory or flags; merge.

## PT-02b: agent properties, OTLP endpoint, resource attributes

- Loader: deploy. Depends on: nothing. Size: S. Start: immediately.
- Goal: the agent's minimal profile as a properties file, with the OTLP/HTTP exporter wired to the gateway on `geldar-colo`.
- Files: CREATE `compose/paper/otel-agent.properties`; CREATE `tools/repo-checks/src/otel-agent-properties.test.ts`.
- Steps: 1. Content (0351 point 2): `otel.instrumentation.common.default-enabled=false`; enable only the OpenTelemetry API bridge (`otel.instrumentation.opentelemetry-api.enabled=true`), runtime telemetry (`otel.instrumentation.runtime-telemetry.enabled=true`; NO JFR-sourced keys and no `emit-experimental-telemetry`, which is deprecated; JFR-sourced metrics come from the plugin's own JFR stream, PT-09a and PT-09b) and log4j appender (`otel.instrumentation.log4j-appender.enabled=true`, `...experimental-log-attributes=true`); `otel.instrumentation.java-util-logging.enabled=false`; `otel.propagators=tracecontext`; `otel.exporter.otlp.protocol=http/protobuf`; `otel.exporter.otlp.endpoint=http://geldar-gateway:4318`; `otel.resource.attributes=service.namespace=geldar`; `otel.service.name=geldar-paper`; `otel.sdk.disabled=true` with a comment line saying the node flips it with the window; `otel.metric.export.interval=15000`; batch processor queue sizes bounded (`otel.bsp.max.queue.size=2048`, `otel.blrp.max.queue.size=2048`). The coder verifies each property name against the agent 2.33.1 documentation; a name that does not exist is reported, not guessed. 2. Test: parse the file as properties; assert the allowed-instrumentation set exactly; `otel.propagators` equals `tracecontext`; endpoint is exactly `http://geldar-gateway:4318` (container `geldar-gateway`, on the geldar-colo and geldar-telemetry networks); no key contains `jfr` or `emit-experimental`; `service.namespace=geldar` present; no value matches an IPv4 or IPv6 literal; no key contains `header`, `token`, `authorization`; `otel.sdk.disabled=true`.
- Tests (fail when reverted): each assertion above (flip one in the file to see the failure).
- Checks: `check:repo`. S4, S5, S12.
- Commit: `PT-02b agent properties with the gateway endpoint and resource attributes (deploy)`.
- Do NOT: add `nats`, `jdbc`, `netty` or other auto-instrumentation; add Baggage; embed a token or an address.
