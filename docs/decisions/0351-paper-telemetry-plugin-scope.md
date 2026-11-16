# 0351: Paper telemetry plugin scope

Status: Proposed
Date: 2026-11-15
Spec: section 7 (monitoring), section 2 (principle 1). Builds on 0350 (telemetry scope, full capture; its point 9 and cards T-11, T-12, T-17 and T-19 are refined here for Paper) and 0082 (Colo limits). Does not edit `docs/spec.md` (0073).

## Context

Paper is the one JVM in the Colo stack that 0350 covers only in outline. The Paper telemetry survey of 2026-11-15 (read-only, not in the repo) read Paper 26.1.2 build 74 (`ver/26.1.2@e4e17fc`, Temurin 25, the JDK in the pinned image) and the Colo node. Facts the design depends on:

- Paper's cgroup was CPU-throttled in 97,473 of 390,555 CFS periods (25%) since its start at 14:00 UTC, about 8,997 s in total. The 15 s sample at 00:58 UTC (2026-11-16) showed no new throttling. Nothing records this today.
- Memory is 12.7 of 14 GiB (91%) in the same read. The JVM flags are `-Xms10G -Xmx10G` only, so the collector is the JVM default (G1 expected, unverified).
- bStats is enabled (`plugins/bStats/config.yml`, `enabled: true`): third-party usage egress from Paper and its plugins.
- spark runs as Paper's bundled build. Its background profiler is off by C2-07n, and `colo-spark.test.ts` enforces it.
- Paper has 457 `*Event` classes. Listening to some of them changes server behaviour: 14 events are built only when a listener exists, a listener on the legacy chat events moves chat onto the legacy path, and a listener on `PlayerLoginEvent` triggers Paper's login workaround. An "every event" listener therefore cannot be written as a blanket registration.
- Cost of one log record per Bukkit event: about 5,000 to 15,000 events/s with 19 bots (estimate, unmeasured), which is 86 to 260 GB/day raw. That is out of budget.
- The Minecraft username is the life id (`golem/src/players/main.ts:143`). The UUID is the offline UUID of that name (`AgentSkinLookup.java:46-47`; Velocity runs offline mode with modern forwarding).

The owner ruled on 2026-11-15, directly, on the points below. This record turns those rulings into scope. Numbers marked *proposal* are the survey's and need the owner's sign-off at PT-00.

## Decision

1. **A separate Paper plugin with a neutral name.**
   - It is its own jar, visible in `/plugins` under a neutral name. The name is **Ledger** unless the owner names it. No telemetry word appears in the name, the description or `plugin.yml` (0350 point 7).
   - It bundles `opentelemetry-api` 1.67.0 unrelocated. Without the agent every call is a no-op, so the plugin loads and runs safely with no agent present.
   - It is not a module of Geldar-Core. A telemetry failure must never stop the server (Geldar-Core's `enableOrStop` stops the server on a failed enable). It has its own kill switch and can be removed by unmounting one jar.
   - Geldar-Core gets only its own counters and NATS trace propagation (0350 T-12, second half), in its own jar.
   - The Gradle subproject follows the plugin name (default `plugin/ledger`). The survey's `plugin/telemetry` is replaced for this reason. *Proposal.*

2. **The OpenTelemetry Java agent is the single SDK, if the overhead test accepts it.**
   - The agent is `opentelemetry-javaagent` 2.33.1 in a minimal profile. It is the only SDK and exporter in the JVM. It is mounted read-only with a lock file, following the BlueMap, Chunky and CoreProtect pattern in `deploy/common.sh`, and started with `JAVA_AGENTS`.
   - The profile (survey 3.4, condensed):
     - `otel.instrumentation.common.default-enabled=false`, then enable only:
       - the OpenTelemetry API bridge;
       - runtime telemetry, with the experimental JMX metrics and the four JFR-sourced metrics;
       - the log4j appender, with experimental log attributes.
     - `otel.propagators=tracecontext` (no Baggage);
     - the JUL instrumentation off (JUL already reaches log4j);
     - `otel.sdk.disabled=true` until the gateway endpoint exists (T-02).
   - No `nats`, `jdbc`, `netty` or other auto-instrumentation. jnats is bundled unrelocated and would match.
   - The fallback is option (b): a relocated SDK inside the plugin (SDK 1.67.0, exporter sender-jdk, runtime-telemetry and log4j appender at 2.33.1-alpha, Shadow 9.6.1). It is used only if PT-15 rejects the agent, and that choice is the owner's.

3. **Events: counters for every safe class, logs for about 70 curated classes.**
   - **Census (counters).** One counter per concrete event class, by cancelled flag, from an allow-list generated from paper-api at build time (PT-06). It is not a reflective listener on every class. Each registration is `EventPriority.MONITOR`.
   - **Excluded from the census.** These are never registered, because listening changes server behaviour or chat and login paths:
     - the 14 listener-gated events: `BlockPhysicsEvent`, `EntityMoveEvent`, `InventoryMoveItemEvent`, `HopperInventorySearchEvent`, `PlayerChunkLoadEvent`, `PlayerChunkUnloadEvent`, `PlayerTrackEntityEvent`, `PlayerUntrackEntityEvent`, `BlockDestroyEvent`, `PlayerInventorySlotChangeEvent`, `PlayerRecipeBookClickEvent`, `PlayerSignOpenEvent`, `ItemTransportingEntityValidateTargetEvent`, `AsyncPlayerConnectionConfigureEvent`;
     - the legacy chat events `AsyncPlayerChatEvent` and `PlayerChatEvent`;
     - `PlayerLoginEvent`;
     - every other `@Deprecated` event.
     - A test holds this list (PT-06, PT-18).
   - **Duty-cycled census.** The high-rate families are counted in duty cycles: `GenericGameEvent`, `EntityAirChangeEvent`, `PlayerStatisticIncrementEvent`, `EntityPathfindEvent`, `EntityTargetEvent`, `EntityTargetLivingEntityEvent`, `PlayerMoveEvent`, `ClientTickEndEvent`, `EntityExhaustionEvent`, `BlockFromToEvent`, `VehicleUpdateEvent`, `VehicleMoveEvent`. The rates are estimates until PT-01 measures them.
   - **Curated logs (about 70 classes, structured).** A token bucket per class (for example 20/s; the excess is counted and dropped). The families are:
     - blocks and items: break, place, multi-place, harvest, bucket, item consume, item break, craft, furnace extract, enchant, item pickup and drop by players;
     - containers: open and close, with container type and position;
     - sleep: bed enter with every `BedEnterResult`, bed leave, deep sleep;
     - animals and trade: trade, breed, tame, shear, fishing;
     - combat and deaths: player-involved damage, death with a player killer, player death, respawn, post-respawn;
     - movement: teleport with cause (COMMAND means an operator), world change, portal, game-mode change;
     - text (content, below): `AsyncChatEvent`, `SignChangeEvent`, `PlayerEditBookEvent`;
     - operator actions and broadcasts: `RemoteServerCommandEvent`, `ServerCommandEvent`, `BroadcastMessageEvent`, whitelist events;
     - tab completion, raids, plugin enable and disable, and the server exception family;
     - connection, progress and advancement events, as the survey's section 2.4 lists them.
   - **Content (0350 point 2).** During development, content is captured in full: RCON command text, chat, sign text and book text. Outside players are captured too, which is the 0350 point 3 known gap. No outside player's agent runs until that gap is closed.

4. **JFR streamed in-process, off the server thread.**
   - A `jdk.jfr.consumer.RecordingStream` runs on its own thread with an explicit settings map, a bounded max age and size, and no recording on disk (the on-disk recording is the post-mortem option C, not in this decision).
   - Always-on events cover:
     - GC and pauses, safepoints;
     - per-thread-group CPU (`jdk.ThreadCPULoad`), so "Server thread" saturation is visible;
     - contention (`JavaMonitorEnter`, `ThreadPark`, counted and sampled);
     - container CPU throttling and container memory;
     - file I/O latency, exceptions, RSS.
   - "CPU-time" in the owner's ruling means `jdk.ThreadCPULoad` and container CPU usage. Continuous JEP 509 CPU-time sampling is card PT-14 and needs the owner's yes.
   - JEP 520 method timing is card PT-13 and is off on the Colo until the owner approves it.
   - The agent's `jvm.*` metrics are the owner of JVM metrics. JFR cards must not duplicate them (PT-09).

5. **spark only through `SparkProvider` summaries.**
   - Access is `me.lucko.spark.api.SparkProvider.get()`, guarded by class presence, with compile-only `me.lucko:spark-api:0.1-20240720.200737-2`. It is not read from `ServicesManager`.
   - The plugin reads TPS, MSPT, CPU and GC windows only.
   - The background profiler stays off (C2-07n, `plugins/spark/config.json`, enforced by `colo-spark.test.ts`).
   - The plugin never starts a profiler, reads profiler output or calls a heap dump. Profiler, health and heap-dump commands are operator tools on the scratch shard.
   - Memory allocation and player ping need a newer spark-api than Paper ships, so they are not read (survey 2.1).

6. **Main-thread budget, with automatic shut-off.** Owner ruling, with the survey's collector budgets as the plan.
   - **Budget:** 50 µs of main-thread work per tick on average (0.1% of a 50 ms tick), and 250 µs in any single tick.
   - **Guard:** each collector measures its own time. Event capture is timed on 1 call in 1,024. A collector over its budget switches itself off, sets the gauge `geldar_paper_collector_disabled{collector}`, and logs once. It stays off until the config re-enables it or the plugin restarts. *Proposal.*
   - **Collector budgets (proposal):** census increment 0.1 µs or less per event; curated capture 0.5 µs on average and 1 µs at p99; tick-end histogram 0.3 µs per tick; world samplers 200 µs in a sampling tick; player snapshots at most 2 players per tick and 50 µs per tick.

7. **Off switch with no restart.**
   - One config file holds a master switch and a switch per collector. It is re-read every 5 s, as Kino's poll reads its config.
   - Off unregisters the census and curated listeners (`HandlerList.unregister`) and stops the samplers. The PT-18 test checks that no listener remains.
   - The plugin has no command and no permission. The config file is the only control.

8. **Export is bounded, non-blocking and dropping.**
   - Main-thread work is O(1): primitives are copied into preallocated ring slots.
   - One emitter thread drains the rings into logs and spans. The agent's batch processors export. The JFR stream thread does its own work.
   - Every queue is bounded and drops, with a drop counter per queue. There is no `forceFlush`, no blocking queue and no synchronous I/O on the main thread.
   - Dropping never stalls the tick. A NATS or gateway outage drops data and has no main-thread effect (survey 7, extra cases).

9. **Overhead must not worsen the node's known problems.** The overhead case (PT-15, run on a scratch shard) must include the throttling and memory findings in Context. The plugin and the agent must not worsen either. Targets:
   - MSPT overhead under 2% of the tick (1 ms at 20 TPS), on live Paper.
   - The plugin and agent together add at most 1 CPU on live Paper.
   - The throttled-period ratio does not rise above its baseline.
   - RSS stays at or below 90% of the memory limit in force (15 GiB after the raise in point 11).

   The survey's scratch bounds are stricter and apply as the acceptance at 20 TPS (*proposal*):
   - MSPT p50 up by 0.2 ms or less, p95 by 0.5 ms or less, p99 by 1.0 ms or less;
   - TPS unchanged;
   - CPU up by 0.2 CPU or less, and throttled time not up;
   - heap after GC up by 300 MiB or less; RSS up by 400 MiB or less;
   - startup up by 10 s or less;
   - the bench's 20 TPS gate at 100%, and action latency p95 within ±5% or the bench's noise;
   - no drops at steady state, and the guard never trips.
   The 10 and 5 TPS rows are findings only (decision 0038).

10. **Principle 1: the plugin only reads.**
    - No command, permission or capability is given to players. `plugin.yml` has no `commands:` and no `permissions:`.
    - No `dispatchCommand`, RCON, chat, title, action bar, boss bar, scoreboard, tab-list change, plugin message, sign, book, entity or block change.
    - No `getChunkAt` (it loads chunks), no forced save, no tick-manager setters, and no mutating BlueMap or Chunky call (only the read-only APIs in survey 2.12).
    - Alerts notify operators only (0350 point 8).
    - The static forbidden-API scan of PT-18 holds.

11. **Nothing reaches any agent.**
    - No data is returned to any agent. Telemetry writes to logs, metrics and spans only. It never writes a player-visible channel or an agent-readable NATS subject.
    - Trace context rides NATS headers at the four plugin seams (survey 3.6), and only `traceparent` and `tracestate` are propagated:
      - block-owner query and reply (`NatsBlockOwnerLink`): extract, and inject into the reply headers;
      - hearing notice (`NatsHearingSink`): inject, with the speaker's life id and a speech hash;
      - event export (`NatsEventPublisher`): inject only when a span is current;
      - maintenance notice (`NatsMaintenanceSubscriber`): extract.
    - Kino gets metrics only, with no agent or viewer attribute (0075, 0139).
    - The reply to a block-owner query carries only the trace header; the reply data is unchanged.

12. **Correlation keys.**
    - `geldar.life_id` is the player name when it matches the life-id pattern (`EventEnvelope.isLifeId`).
    - `minecraft.player.uuid` is the offline UUID. 0350 point 1 allows `player_id`; the UUID is taken as one.
    - Time is `geldar.world_tick` (overworld full time), `geldar.server_tick` (`Bukkit.getCurrentTick()`) and `geldar.world`.
    - `geldar.mc_session` is a ULID minted at join and emitted in the join log.
    - Per-player data goes to logs and span attributes only, never to metric labels (0350 point 1).
    - Never: addresses (`Player#getAddress()`), owner identities, tokens. The log appender and the collector both redact addresses.

13. **Node changes that come with this decision.** These are node steps, not repo changes, and each needs its own approval.
    - bStats is disabled (`plugins/bStats/config.yml`, `enabled: false`). It is third-party egress and the owner ruled it off.
    - The Paper container memory limit goes from 14 GiB to 15 GiB (15,032,385,536 bytes to 16,106,127,360 bytes). This is a compose change. The 0082 budget file (`shards/colo.yaml`, `memory_limit`) must be checked first to see whether it holds this limit (open item).
    - Heap stays at `-Xms10G -Xmx10G` in this decision. Any change to it is a separate proposal.

14. **Process: scratch first, then one owner-approved window.**
    - **Scratch test.** A throwaway Colo compose project, with its own project name and volume, loopback binds only, and no production ports (25565 and 25566 are never published). It runs at 20, 10 and 5 TPS, with and without the plugin and agent, in a quiet window. The load is the 19 scripted Bodies (no Minds) plus `./geldar.ps1 bench`. The bench and `test:live` run one at a time (CLAUDE.md). The results go to a results document.
    - **Live restart (PT-16).** Needs the owner's approval, given through the orchestrator, with: the jar sha256, the window, and the rollback. Rollback is to unmount the jar, unset `JAVA_AGENTS` and restart Paper once. One Paper window takes the agent, the plugin and Geldar-Core together.
    - No live restart happens before PT-15 passes and the owner approves.

## Cards

Each card is one line: the survey's card text, then its flags in brackets. Flags: **repo**, **jar** (manual jar step or mount), **restart** (Paper restart), **config** (env, JVM, compose or plugin config), **scratch** (tested on the scratch shard first), **owner** (owner approval). A card with no flag needs nothing beyond the repo.

- PT-00: Decision record "Paper telemetry" (amends 0350 point 9): sources and tiers, the new plugin and its neutral name, the main-thread budget and guard, the census exclusions, JFR (stream yes; method timing and CPU-time sampling per the owner), spark operator-only (C2-07n unchanged), per-player data in logs only, content (chat, sign, book, RCON text) per 0350 point 2. [repo, owner]
- PT-01: Event census on the scratch shard: a throwaway build that writes per-class counts every 60 s to its log (no exporter); 19 scripted Bodies plus the bench plus one Chunky run; output is a rate table per class at 20, 10 and 5 TPS and measured ns per dispatch. Feeds PT-06 and PT-07. [branch only, scratch, owner (scratch window)]
- PT-02: Agent wiring, off by default: lock JSON (sha256, sha512), fetch in `deploy/common.sh` to `$STATE_DIR/otel/`, read-only compose mount, `JAVA_AGENTS`, `compose/paper/otel-agent.properties`, `otel.sdk.disabled=true` unless the gateway endpoint is set; a repo-check test (allowed instrumentations only, `tracecontext` only, no endpoint literals or addresses). [repo, jar, restart, config, owner]
- PT-03: Plugin skeleton (`plugin/ledger` by default): Gradle subproject; pinned API-only dependencies and spark-api compileOnly; `plugin.yml` with no commands or permissions; config file re-read every 5 s; budget guard; bounded rings; unit tests; read-only compose mount, not part of the healthcheck. [repo, jar, restart, config]
- PT-04: Tick collectors: tick-end histogram (`geldar_tick_lag_ms`), `geldar_tps`, tick manager, overruns, slow-tick logs, stall detector; spark bridge (guarded by class presence). [repo, scratch; restart with PT-16]
- PT-05: World, chunk, entity, scheduler and server samplers; operators-count alarm metric; config snapshot at enable. [repo, scratch]
- PT-06: Census in production from PT-01's allow-list, with duty cycles for hot families; a test that the exclusion list holds every gated, deprecated and behaviour-changing class. [repo, scratch]
- PT-07: Curated event logs (about 70 classes, token bucket per class), operator audit, `ServerExceptionEvent`. [repo, scratch, owner (content)]
- PT-08: Players: 60 s snapshots, stats-file reader, progress events, connection lifecycle, client tick cadence, command-tree audit. [repo, scratch]
- PT-09: JFR stream: thread-group CPU and allocation, GC and safepoints, contention, container throttling, file I/O, exceptions, RSS; one owner per metric, no duplicates of the agent's `jvm.*`. [repo, scratch]
- PT-10: Chunky, BlueMap and CoreProtect bridges (read-only APIs), on-disk sizes. [repo, scratch]
- PT-11: Geldar-Core seams (0350 T-12, second half): API jar, publisher, hearing, block-owner and Kino counters, NATS inject and extract at the four seams in Decision 11, speech hash. [repo, jar (Geldar-Core jar), restart, scratch]
- PT-12: Collector rules (with 0350 T-02): drop RCON thread lines, sample Chunky progress, redact addresses, drop process command-line attributes, cap body size, map severities, keep the RCON echo audit stream. [repo, config (gateway)]
- PT-13: JFR method timing (JEP 520) for tick phases and Geldar listeners; method names checked on the scratch shard; off on the Colo until approved. [repo, scratch, owner]
- PT-14: Continuous CPU-time profiling (JEP 509) as per-minute folded summaries plus CPU share by plugin package; tested together with a spark profiler run. [repo, scratch, owner]
- PT-15: Overhead A/B on the scratch shard (survey section 7, and Decision 9): a results document; the gate for the Colo. [results document, scratch (jar, restart, config), owner]
- PT-16: Colo enablement window: one Paper restart takes the agent, the plugin and Geldar-Core after 0350 T-02; check that series arrive; rollback by unmounting the jar and unsetting `JAVA_AGENTS`. [jar, restart, config, owner (window, jar sha, rollback)]
- PT-17: Paper dashboards and alerts (with 0350 T-17): TPS under 12 for 5 min (spec 7), MSPT p95 over 50 ms, throttled ratio over 5%, heap after GC over 85%, RSS over 90% of the limit, watchdog warnings, exception rate, operators above 0, agent commands blocked above 0, publisher and export drops, data absence. [repo, config (SigNoz import), owner (alert channel)]
- PT-18: Leak and Principle 1 checks (with 0350 T-19): forbidden-API scan of the plugin (`sendMessage`, `broadcast`, `dispatchCommand`, scoreboard, boss bar, title, tab list, plugin messaging, `getChunkAt`, world and entity mutators, BlueMap and Chunky mutators); no commands or permissions in `plugin.yml`; census exclusions; no telemetry words in anything agent-visible. [repo]

**Order.**

1. PT-00.
2. PT-01 (scratch) and PT-03, in parallel.
3. PT-04 to PT-11, in parallel after PT-03.
4. PT-02 and PT-12 once 0350 T-02 exists.
5. PT-15.
6. PT-16 (one Paper window, owner approved).
7. PT-17. PT-18 lands with PT-03 and PT-07.
8. PT-13 and PT-14 only after PT-15, and only with the owner's yes.

## Consequences

- `docs/spec.md` is not edited (0073). This record is the amendment for the owner's reconciliation.
- 0350 point 9 is refined for Paper: the agent is the SDK, the domain collectors live in a separate neutral-name plugin, and Geldar-Core gets only its own seams.
- 0350 T-11 (agent on the scratch shard first), T-12 (Geldar-Core tick and world metrics), T-17 (alerts) and T-19 (leak tests) gain the cards above.
- Paper adds about 1,000 to 1,600 metric series with no life labels, about 55 to 190 MB/day of logs before compression, and about 12k to 25k spans/day (survey section 6). That is about 17 to 66 MB/day stored, or 6 to 24 GB/year, on top of 0350's 37 to 55 GB/year. The top of the range passes 0350's 70 GB alarm, so the estimate must be measured in PT-01 before PT-16.
- Nothing in this decision changes an agent-visible surface. The plugin adds no command, no permission and no message.
- The Paper limit raise and bStats change are node steps, each with its own approval.

## Open items

- **Plugin name.** Ledger unless the owner names it. The Gradle subproject follows the name.
- **Agent.** The owner's approval of OpenTelemetry Java agent 2.33.1 as the SDK is conditional on PT-15. The relocated-SDK fallback is the owner's choice if PT-15 fails.
- **Continuous CPU-time sampling (PT-14)** and **JEP 520 method timing (PT-13)** need the owner's yes. Until then they stay off, including on the scratch shard in production-like runs.
- **CPU-time reading.** The owner's "CPU-time" is read as thread-group CPU and container CPU (always on). Confirm that JEP 509 is not included.
- **Memory.** The Paper limit is raised to 15 GiB. The survey's 90% RSS check runs against the new limit. Confirm which file holds the Paper limit (`shards/colo.yaml` `memory_limit`, or the node's own compose), since 0082 says every service's ceiling comes from that budget.
- **Throttling threshold.** PT-17 proposes 5% of periods throttled. Confirm, including whether it is acceptable during pregeneration and building (survey question 8).
- **Overhead targets.** The 2% MSPT and 1 CPU targets from the owner are the ceiling; the survey's scratch bounds (0.2 ms p50, 0.2 CPU at 20 TPS) are stricter and proposed as the acceptance. The owner may choose either.
- **Outside players.** The 0350 point 3 gap (erasure of captured content) must be registered, and the terms text and `open-signup.md` procedures written, before any outside player's agent runs with this plugin.
- **Shared SigNoz tenant.** The 0350 point 4 risk applies unchanged. Paper data reaches SigNoz only through the authenticated route, which needs the owner's approval.
- **Unverified (PT-01 and PT-15).** Agent overhead on Paper 26.1.2 with Java 25 and its ByteBuddy use under Paper's plugin classloaders; every ns and µs cost and event rate; whether mineflayer sends the client tick-end packet (`ClientTickEndEvent`); whether vanilla `minecraft.*` JFR events can be enabled by an in-process stream; the JEP 520 method names for 26.1.2; whether spark's async-profiler (itimer) and JFR CPU-time sampling can run together; whether stats files are written atomically; the JUL-to-log4j bridge path; Netty direct-memory accessors; Chunky 1.5.3's API surface and `CoreProtectPreLogEvent`; agent property names for disabling resource providers.
- **Release dates.** The 2.33.1-alpha library artifacts (fallback) and whether a spark 1.10.187 Bukkit/Paper build exists are unchecked. Re-check every pin at pin time; 1.68.0 of the OpenTelemetry API is too new (1.67.0 is pinned).
