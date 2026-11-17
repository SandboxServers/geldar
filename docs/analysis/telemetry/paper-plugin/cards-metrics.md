# Cards: metrics and samplers (PT-04, PT-05, PT-09, PT-10)

Read [README.md](README.md) first (aliases, frozen API and names, inherited rules). Safety rules: [safety-rules.md](safety-rules.md). All names below are the frozen names. Each Paper collector implements `Collector` from the frozen API, lives in its own package under `PAPER`, is listed by class name in `PaperCollectors` (created by PT-03h; the coder of these cards does not edit it) and guards its main-thread work with `CollectorGuard` (`begin`/`end`).

Verification of every metric on the scratch shard is in [scratch-test-plan.md](scratch-test-plan.md); each card names the row.

---

## PT-04a: tick statistics (pure logic)

- Loader: Neutral (lives in `ledger-core`). Depends on: PT-03 api (starts only when it is on the integration branch). Size: S. Start: immediately.
- Goal: the arithmetic of tick timing with no Paper types, so a port reuses it.
- Files: CREATE `CORE/tick/TickStats.java`, `CORE/tick/StallDetector.java`; tests `CORE_T/tick/TickStatsTest.java`, `CORE_T/tick/StallDetectorTest.java`.
- Steps: 1. `TickStats.onTick(double durationMs)`: counts overruns (over 50.0 ms), returns `true` when the tick is "slow" (over a configured `slow_tick_ms`, default 100). Holds no allocation. 2. `StallDetector(thresholdMs, nanoClock)`: `heartbeat()` called from the main thread each tick end (volatile long write); `check()` called from an async thread returns `true` once per stall (when `now - lastHeartbeat > threshold` and not yet reported; resets on the next heartbeat). 3. Bucket bounds constant `TickStats.BOUNDS = {1,2,5,10,20,30,40,50,75,100,250,1000}`.
- Tests (fail when reverted): 50.0 is not an overrun, 50.1 is; slow threshold boundary; stall reported exactly once per stall and again after a heartbeat then a second stall; no report when heartbeats continue.
- Checks: `:ledger-core:test`; boundary test. S6.
- Commit: `PT-04a Tick statistics and stall detector (plugin)`.
- Do NOT: read a clock inside `onTick`; import anything loader-specific.

## PT-04b: tick listener, TPS, tick manager, stall events

- Loader: Paper. Depends on: PT-03h, PT-04a (frozen API meanwhile). Size: M.
- Goal: `geldar_tick_lag_ms`, `geldar_tick_overruns_total`, `geldar_tick_stalls_total`, `geldar_tps{window}`, `geldar_tick_rate_target`, `geldar_tick_frozen`, plus events `geldar.server.slow_tick` and `geldar.server.stall`.
- Files: CREATE `PAPER/tick/TickCollector.java`, `PAPER/tick/TickEndListener.java`, `PAPER/tick/TpsGauges.java`; tests `PAPER_T/tick/TickEndListenerTest.java`, `PAPER_T/tick/TpsGaugesTest.java`.
- Steps: 1. `TickEndListener` handles Paper's `ServerTickEndEvent` at `EventPriority.MONITOR`, `ignoreCancelled=false`; reads the tick duration the event carries (`getTickDuration()`, milliseconds; confirm the unit when compiling), calls `guard.begin()`, records into a `BoundHistogram` bound once, `TickStats.onTick`, `StallDetector.heartbeat()`, `guard.end()`. On a slow tick calls `EventLog.record(slowTickId, serverTick, durationMs, overrunCount, world, "", "")`; the event is registered with the allow-listed keys `geldar.server_tick`, `geldar.duration_ms`, `geldar.tick_overruns` (added to `AttrKeys` in the T98 fix pass) and `geldar.world`; bare field names are dropped by the sink. 2. `TpsGauges`: `gaugeDouble` with `geldar_tps{window}` reading `Bukkit.getTPS()` (1m, 5m, 15m), cached by reading on the async scheduler every 5 s into a volatile array (the reader returns the cached value; `Bukkit.getTPS()` is not called on the exporter thread). 3. `geldar_tick_rate_target` and `geldar_tick_frozen`: read `Bukkit.getServerTickManager()` getters only (`getTickRate()`, `isFrozen()`), sampled on the main thread every 100 ticks through `everyTicks(100, ...)`. Never call a setter. 4. Stall: a dedicated daemon watchdog thread `ledger-stall-watchdog` (owned by `TickCollector`, sleeps 500 ms, bounded join of 1 s in `stop()`) calls `StallDetector.check()`; on `true`, `Counter.add` and one `EventLog.emitMap("geldar.server.stall", WARN, ...)` (the watchdog thread may call `emitMap`, and never touches Bukkit state). Deviation from the original card (`everyMillis(500)`): Bukkit dispatches async repeating tasks from the main thread's scheduler heartbeat, so that timer cannot fire while the main thread hangs, which is exactly the case to detect. 5. `stop()` unregisters through `ListenerRegistry`, cancels tasks.
- Tests (fail when reverted): firing the event 10 times with a 55 ms duration yields histogram count 10 and overrun 10; the listener class has `EventPriority.MONITOR`; a duration of 120 ms writes one slow_tick record, 10 ms writes none; the guard is invoked once per event (`begin`/`end` pairing); `TpsGauges` reader does not call `Bukkit.getTPS` (test substitutes a counter through a supplier seam the coder adds); no setter of the tick manager is referenced (S11 source scan in PT-18a also covers this).
- Checks: `:ledger:test`; scratch rows T1 to T5. S6, S8, S11.
- Commit: `PT-04b Tick, TPS and stall collectors (plugin)`.
- Do NOT: call `getChunkAt`; read `Bukkit.getTickTimes()` on the main thread; add a listener on `ServerTickStartEvent` (not needed); call `Bukkit.getAverageTickTime` from the exporter thread without caching.

## PT-04c: spark bridge

- Loader: Paper. Depends on: PT-03h. Size: S.
- Goal: `geldar_spark_tps`, `geldar_spark_mspt_ms`, `geldar_spark_cpu_ratio`, `geldar_spark_gc_ms` from spark's API summaries only (0351 point 5).
- Files: CREATE `PAPER/spark/SparkCollector.java`, `PAPER/spark/SparkReader.java`; test `PAPER_T/spark/SparkReaderTest.java`.
- Steps: 1. `SparkReader` loads `me.lucko.spark.api.SparkProvider` by `Class.forName` guard; absent class or `IllegalStateException` from `SparkProvider.get()` means the collector reports nothing and retries every 60 s. 2. On an async `everyMillis(15000)` task read `spark.tps()`, `spark.mspt()` and `spark.cpuUsage()` statistics and GC collector windows through the `DoubleStatistic`/`GenericStatistic` types the API offers (the coder maps windows 10s, 1m, 15m to the `window` attribute; a window the API lacks is skipped). Store into volatile doubles; gauge readers return them. 3. Never call profiler, health report, heap summary or heap dump methods. 4. Dependency pin (spark-api was deferred out of PT-03a: a `-SNAPSHOT` declaration is not checksum-verified by Gradle): this card is the first to use spark and pins `me.lucko:spark-api` with a verified artifact, either a repository scoped to the exact timestamped file with Gradle dependency verification, or a vendored jar with a recorded sha256 (the coder records the version, hash and source in the card report). It adds `compileOnly(libs.spark.api) { isTransitive = false }` to `plugin/ledger/build.gradle.kts` and the pin to `libs.versions.toml`; it is the only card besides PT-03a allowed to touch those two files.
- Tests (fail when reverted): with the class absent (classloader without spark) the collector starts and emits nothing and does not throw; with a fake provider object (the test defines a minimal stand-in only if spark-api is on the test classpath; else test `SparkReader` through an interface seam) the gauges show the values; a test scans the class's constant pool/source (via PT-18a pattern) for `profiler`, `heap`, `healthReport` and fails when present.
- Checks: `:ledger:test`; scratch row T6 (spark present on scratch Paper). S9, S11.
- Commit: `PT-04c spark summary bridge (plugin)`.
- Do NOT: start a profiler; touch `plugins/spark/config.json`; read `ServicesManager`.

## PT-05a: world, chunk, entity and player-count samplers

- Loader: Paper. Depends on: PT-03h. Size: S.
- Goal: `geldar_world_loaded_chunks`, `geldar_world_entities`, `geldar_world_players` per world, sampled cheaply.
- Files: CREATE `PAPER/world/WorldCollector.java`; test `PAPER_T/world/WorldCollectorTest.java`.
- Steps: 1. `everyTicks(config.sample.world_every_ticks)` (default 200) on the main thread: for each `Bukkit.getWorlds()` read `getChunkCount()`, `getEntityCount()`, `getPlayerCount()` (counts only: never `getLoadedChunks()`, `getEntities()` or `getPlayers()` which allocate); write into per-world volatile longs; gauges read them. World label is the world name. 2. Guard: `begin/end` around the whole sample; budget 200 us in a sampling tick (config key).
- Tests (fail when reverted): a fake world list with two worlds yields two series with the counted values; adding a world adds a series without restart; the source does not reference `getLoadedChunks`, `getEntities` or `getChunkAt` (string scan inside the test of its own source file path read from a system property is acceptable; the PT-18a scan is the lasting check).
- Checks: `:ledger:test`; scratch row W1. S6, S11.
- Commit: `PT-05a World and entity count samplers (plugin)`.
- Do NOT: load chunks; call `getChunkAt`; iterate entities.

## PT-05b: server samplers, operators alarm, config snapshot

- Loader: Paper. Depends on: PT-03h. Size: S.
- Goal: `geldar_players_online`, `geldar_operators_count`, `geldar_plugins_enabled`, `geldar_scheduler_pending_tasks`, and one `geldar.server.config_snapshot` event at enable.
- Files: CREATE `PAPER/server/ServerCollector.java`, `PAPER/server/ConfigSnapshot.java`; tests `PAPER_T/server/ConfigSnapshotTest.java`, `PAPER_T/server/ServerCollectorTest.java`.
- Steps: 1. Main-thread sample every 1,200 ticks: `Bukkit.getOnlinePlayers().size()`, `Bukkit.getOperators().size()`, `Bukkit.getPluginManager().getPlugins()` enabled count, `Bukkit.getScheduler().getPendingTasks().size()` (allocates a list: once per minute is the budget). 2. `ConfigSnapshot`: at `start()` (off the main thread via `everyMillis` one-shot semantics: schedule with a 5 s delay and cancel after the first run) builds `Attrs` from an **allow-list of keys**: server version, view distance, simulation distance, max players, online-mode flag, tick rate, JVM `-Xmx` from `ManagementFactory`; never iterates all of `server.properties`; never includes any key that starts with `rcon`, `query`, or any key `Redactor.keyIsCredential` flags. 3. Emit with `EventLog.emitMap("geldar.server.config_snapshot", INFO, attrs)`.
- Tests (fail when reverted): a fake properties source containing `rcon.password=hunter2`, `rcon.port=25575`, `level-seed=123` produces a snapshot with none of those keys or values (the test greps the Attrs map for `hunter2`); operators count equals the fake list size; the snapshot is emitted once.
- Checks: `:ledger:test`; scratch rows S1, S2. S4, S5.
- Commit: `PT-05b Server samplers and config snapshot (plugin)`.
- Do NOT: read `rcon.*`, `server-ip`, `query.port`; emit the world seed; add a command.

## PT-09a: JFR stream runner

- Loader: Neutral (JFR is JVM, not loader). Depends on: PT-03 api (starts only when it is on the integration branch). Size: M. Start: immediately.
- Goal: an in-process `RecordingStream` on its own thread, explicit settings, no disk (0351 point 4), with a handler registry the mapper cards (PT-09b) plug into.
- Files: CREATE `CORE/jfr/JfrRunner.java`, `CORE/jfr/JfrHandler.java`, `CORE/jfr/JfrSettings.java`; test `CORE_T/jfr/JfrRunnerTest.java`.
- Steps: 1. `JfrRunner.start(List<JfrHandler>, LedgerConfig, Logger)`: creates `new RecordingStream()`, `setMaxAge(Duration.ofSeconds(30))`, `setMaxSize(8 MiB)`, never `dump`/`setDestination`; enables only the event names the handlers request, each with an explicit `withPeriod` or `withThreshold` from `JfrSettings`; `onEvent(name, handler)`; `startAsync()`; daemon thread named `ledger-jfr`. 2. If `jdk.jfr` is unavailable or `FlightRecorder.isAvailable()` is false, log once and do nothing. 3. `stop()` closes the stream, idempotent. 4. Handler exceptions are caught and counted (`geldar_ledger_dropped_total{queue=jfr}`), never rethrown.
- Tests (fail when reverted): start with a handler for `jdk.GarbageCollection`... use `jdk.JavaMonitorEnter` threshold 0 and a synthetic contention to see one event; `stop()` leaves no `ledger-jfr` thread; a throwing handler does not kill the stream; no file is created in the temp dir or working dir (list before and after); a test asserts the settings map names only events requested by handlers.
- Checks: `:ledger-core:test`; scratch row J1. S6.
- Commit: `PT-09a JFR stream runner (plugin)`.
- Do NOT: write a recording to disk; enable events no handler asked for; use `jdk.ExecutionSample`, `jdk.CPUTimeSample` or method timing (PT-13, PT-14 are owner-gated).

## PT-09b: JFR mappers

- Loader: Neutral. Depends on: PT-09a. Size: M.
- Goal: the JFR-owned metrics: `geldar_jfr_thread_group_cpu_ratio{group}`, `geldar_jfr_safepoint_ms`, `geldar_jfr_monitor_contention_total{class_group}`, `geldar_jfr_file_io_ms{op}`, `geldar_jfr_exceptions_total{kind}`. **GC and heap metrics belong to the agent's `jvm.*`; this card must not emit them.**
- Files: CREATE `CORE/jfr/ThreadCpuHandler.java`, `CORE/jfr/SafepointHandler.java`, `CORE/jfr/ContentionHandler.java`, `CORE/jfr/FileIoHandler.java`, `CORE/jfr/ExceptionHandler.java`; test `CORE_T/jfr/JfrHandlersTest.java` (one test class; uses synthetic `RecordedEvent` through a small seam: handlers take a `Function` accessor interface so the test needs no real JFR).
- Steps: 1. Each handler implements `JfrHandler` (`eventNames()`, `period/threshold`, `handle(accessor)`). 2. `ThreadCpuHandler` maps `jdk.ThreadCPULoad` (period 10 s) to thread groups by name prefix: `Server thread` -> `server`, names starting `Paper` or `Netty` -> `io`, `ledger-` -> `ledger` (the plugin's own cost), `C2 CompilerThread`/`C1 CompilerThread` -> `jit`, `G1`/`GC` -> `gc`, else `other`; ratio = user+system. 3. `SafepointHandler` histogram from `jdk.SafepointBegin`/`jdk.SafepointEnd` durations (threshold 10 ms). 4. `ContentionHandler` counts `jdk.JavaMonitorEnter` with threshold 20 ms by class group (first package segment pair). 5. `FileIoHandler` `jdk.FileRead`/`jdk.FileWrite` threshold 10 ms, `op=read|write`. 6. `ExceptionHandler` counts `jdk.JavaExceptionThrow` is **not** enabled (very high rate); use `jdk.ExceptionStatistics` (period 60 s) delta into `geldar_jfr_exceptions_total{kind=thrown}`.
- Tests (fail when reverted): thread-name mapping table; ratio math; ledger own threads go to `group=ledger`; a metric-name list test asserts none of the names starts with `jvm_` or `jvm.` or equals an agent metric (list of the agent's names in the test, from the survey; the coder keeps it small and notes the source); handler event names do not include `jdk.ExecutionSample`, `jdk.CPUTimeSample`, `jdk.MethodTiming` or `jdk.MethodTrace`.
- Checks: `:ledger-core:test`; scratch rows J2 to J5. S7 (groups are not player data).
- Commit: `PT-09b JFR metric handlers (plugin)`.
- Do NOT: emit GC, heap or allocation metrics; add per-thread labels (cardinality).

## PT-09c: container CPU throttling and memory

- Loader: Neutral. Depends on: PT-03 api (starts only when it is on the integration branch). Size: S. Start: immediately.
- Kind: the three cumulative cgroup values (periods, throttled periods, throttled seconds) are exported as monotonic GAUGES (the frozen API has no observable counter); the memory pair are plain gauges. README section 4 says the same.
- Goal: the missing evidence for the 25% throttled-period finding: `geldar_container_cpu_periods_total`, `..._throttled_periods_total`, `..._throttled_seconds_total`, `geldar_container_memory_bytes`, `geldar_container_memory_limit_bytes` from cgroup v2 files.
- Files: CREATE `CORE/container/CgroupReader.java`, `CORE/container/CgroupCollector.java`; tests `CORE_T/container/CgroupReaderTest.java`; test resources `plugin/ledger-core/src/test/resources/cgroup/cpu.stat`, `memory.current`, `memory.max`.
- Steps: 1. `CgroupReader(Path root)`: parses `cpu.stat` (`nr_periods`, `nr_throttled`, `throttled_usec`), `memory.current`, `memory.max` (`max` means unlimited -> 0). v1 layout or a missing file means unavailable: the collector emits nothing and logs once. 2. `CgroupCollector` implements `Collector`; reads on an async `everyMillis(15000)` into volatile longs; counters are exported as observable counters through `gaugeLong` with monotonic semantics documented (the frozen API has no observable counter; name keeps `_total` and the binding exports a gauge of the monotonic value, noted in the dashboard card). 3. Default root `/sys/fs/cgroup` from config key `container.cgroup_root` (tests use a temp dir).
- Tests (fail when reverted): parsing the three fixture files yields exact values; `memory.max=max` yields 0; a missing `cpu.stat` yields unavailable without throwing; throttled seconds equals `throttled_usec / 1e6`.
- Checks: `:ledger-core:test`; scratch row C1. S6 (reads on an async thread only).
- Commit: `PT-09c Container CPU throttling and memory reader (plugin)`.
- Do NOT: read process command lines or environment (S4); read from the main thread.

## PT-10a: on-disk sizes

- Loader: Neutral. Depends on: PT-03 api (starts only when it is on the integration branch). Size: S. Start: immediately.
- Goal: `geldar_disk_bytes{area}` for world, plugin data, logs, BlueMap, Chunky, every 10 minutes, off the main thread.
- Files: CREATE `CORE/disk/DiskCollector.java`, `CORE/disk/DirSize.java`; test `CORE_T/disk/DirSizeTest.java`.
- Steps: 1. `DirSize.of(Path, long maxEntries)` walks with `Files.walkFileTree`, does not follow symlinks, returns bytes and a `truncated` flag at `maxEntries` (default 2,000,000); errors per file are skipped. 2. `DiskCollector` takes a map `area -> Path` from config keys `disk.area.<name>.path` (relative paths resolve against the server working directory given by the adapter); runs on an async `everyMillis(600000)`, one area per run to spread I/O. 3. Skip any path that is not a directory.
- Tests (fail when reverted): temp tree sums exactly; symlink not followed (loop-safe); `maxEntries` stops the walk and sets the flag; an unreadable subdirectory does not abort.
- Checks: `:ledger-core:test`; scratch row D1. S6, S11.
- Commit: `PT-10a On-disk size sampler (plugin)`.
- Do NOT: read file contents; run on the main thread; add a path key whose value could be a secrets directory (the test rejects any path containing `secret`).

## PT-10b: Chunky, BlueMap and CoreProtect bridges

- Loader: Paper. Depends on: PT-03h. Size: M.
- Goal: read-only presence and activity gauges: `geldar_bridge_chunky_running`, `geldar_bridge_coreprotect_queue`, `geldar_bridge_bluemap_enabled`.
- Files: CREATE `PAPER/bridge/ChunkyBridge.java`, `PAPER/bridge/CoreProtectBridge.java`, `PAPER/bridge/BlueMapBridge.java`, `PAPER/bridge/BridgeCollector.java`; test `PAPER_T/bridge/BridgeCollectorTest.java`.
- Steps: 1. Each bridge is a small class loaded only when `Bukkit.getPluginManager().getPlugin(name) != null` and its API class exists (`Class.forName` guard), so a missing plugin or a changed API never throws (S8). 2. Chunky: read the task state through the Chunky API's read-only calls (running tasks count); if Chunky 1.5.3's API surface lacks a read-only call the coder finds, the bridge reports presence only and says so in the commit body (0351 lists the surface as unverified). 3. CoreProtect: `CoreProtect.getInstance().getAPI()` is already a compileOnly dependency in `plugin/core`; this card does **not** add it to `plugin/ledger`; use only reflection-free presence (`getPlugin("CoreProtect") != null`) and the queue size if the public API exposes one, otherwise presence. 4. BlueMap: `BlueMapAPI.getInstance().isPresent()` read only. PT-03a already declares `compileOnly(libs.bluemap.api) { isTransitive = false }` in `plugin/ledger/build.gradle.kts`, so this card edits no build file.
- Tests (fail when reverted): with none of the three plugins present the collector starts and emits zeros without throwing; a bridge whose class lookup throws `NoClassDefFoundError` is skipped and the others still work; the source contains no call named `start`, `pause`, `cancel`, `render`, `purge`, `restore`, `rollback`, `lookup` (PT-18a covers this lasting).
- Checks: `:ledger:test`; scratch rows B1 to B3. S1, S9, S11.
- Commit: `PT-10b Read-only plugin bridges (plugin)`.
- Do NOT: call a mutating Chunky, BlueMap or CoreProtect method; query block owners (CoreProtect lookups are I/O heavy); add `plugin.yml` entries beyond the existing `softdepend`.
