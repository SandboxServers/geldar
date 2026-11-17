# NeoForge adapter design (P3): event export and maintenance notices

Date 2026-11-17. Status: design note, docs only. P3 is on hold in [RESUME.md](RESUME.md); this note does not start it.

Tags: **VERIFIED** = read in [neoforge-api-notes.md](neoforge-api-notes.md) or in this repo (path given). **UNVERIFIED** = needs a GameTest, a first server run, or a source read this note did not do. Nothing else is claimed.

## 1 Scope and non-goals

In scope: a NeoForge 26.1.2 (build 126) dedicated server running `neoforge/` (server-side only, no registry entries, no payloads) exports the same event types as the Paper shard to the same subjects, `geldar.<shard>.<type>`, in the stream `GELDAR_EVENTS` (the event export stream and sink decision, [docs/decisions/0041-event-export-stream-and-sink.md](../../decisions/0041-event-export-stream-and-sink.md)). It also takes the maintenance notice subscription.

Non-goals:
- Progression (P6 to P8, on hold for the owner's policy decisions in [progression-design.md](progression-design.md)).
- Own block-owner log, gravestones and owner queries (P4).
- BlueMap and pregeneration (P5).
- Anything agent-visible: no chat, title, action bar, sound or book reaches a Body or a player's perception. No payloads, no registry entries, no mixins.
- Paper unchanged: no behaviour change in `plugin/core` or `plugin/core-common`. The only Paper-side touch is moving Bukkit-free code into core-common (P3-3), guarded by the existing jar-contents golden test.

## 2 What Geldar-Core exports today

Four event types leave Paper. Source of truth column: whether the logic that decides the payload is platform-neutral (core-common) or Bukkit-specific.

| Paper source (file) | Event type, subject | Payload fields | Source of truth |
|---|---|---|---|
| `EventExporter.onDamage`: `EntityDamageEvent`, MONITOR, `ignoreCancelled` (`plugin/core/src/main/java/dev/geldar/core/EventExporter.java`) | `damage`, `geldar.<shard>.damage` | `cause` (Bukkit `DamageCause` name), `amount` (`getFinalDamage`), `player` | Bukkit-specific (event and cause types) |
| `EventExporter.onDeath`: `PlayerDeathEvent` (same file) | `death`, `geldar.<shard>.death` | `cause` (last damage cause or `UNKNOWN`), `x`, `y`, `z`, `dimension` (overworld, nether, end, other), `drops`, `drop_items[{item, count, x, y, z}]`, `respawn_x`, `respawn_y`, `respawn_z` | Bukkit-specific (`Location`, `World.Environment`, `ItemStack` and `Material` key). `dimension()` and `addDrops()` are logic over plain `Drop` records, but their inputs are Bukkit types |
| `EventExporter.onSleep`: `PlayerBedEnterEvent`, only `BedEnterResult.OK` | `sleep`, `geldar.<shard>.sleep` | `player` only | Bukkit-specific |
| `GeldarCore.requestTpsExport` calls `EventExporter.exportTps` from a scheduler task (`tpsIntervalSeconds`; javadoc says 20 s) | `server_tps`, `geldar.<shard>.server_tps` | `tps` (`Bukkit.getTPS()[0]`, one-minute window), `players`, `dropped`, `connected` | `tps` is Bukkit-specific. `dropped` and `connected` come from the publisher (core-common) |

Shared path, platform-neutral (core-common, `plugin/core-common/src/main/java/dev/geldar/core/`):
- `EventExporter.emit` (in `plugin/core`, Bukkit-free body) adds `player` to the payload and sets `agent_id` only when `EventEnvelope.isLifeId(name)`. The rule itself is in `EventEnvelope`.
- `EventEnvelope.create` builds the envelope; `EventEnvelope.subject()` returns `"geldar." + shard + "." + type`.
- `EventPublisher` (interface), `NatsEventPublisher`, `BoundedEventQueue`, `Ulid`, `TraceHook`: platform-neutral, no Bukkit imports (the core-common build file says so).

Schemas: `contract/schemas/event.schema.json` (envelope), `death-event.schema.json` (death). No schema file for `damage` or `sleep` was found by name (`mcp-common.schema.json` names `damage` and `death` as enum values; `sovereign-call-event.schema.json` names `sleep` as a verb): which schema the Paper tests check `damage` and `sleep` against is UNVERIFIED.

Listeners that do not export, and why they are out of P3:
- `ProximityChatListener`, `ProximityDeathListener`: speech and death lines to agents within 32 blocks (the proximity chat and deaths decision, [docs/decisions/0198-proximity-chat-and-deaths.md](../../decisions/0198-proximity-chat-and-deaths.md)). Agent-visible: out.
- `GhostListener`: a Velocity plugin message channel. A channel needs a registered payload, which the rule forbids. Out.
- `CommandBlockListener`: cancels command-block commands; no export. Out.
- `RecipeGrantListener`: recipes on join (off by default). Out.
- `GravestoneListener`, `BlockChangeListener` (block owners): P4.
- `KinoBlockListener`, `BlockUpdateListener`, `LakituFeed`: agent perception. Out.

## 3 NeoForge equivalents

Target: NeoForge 26.1.2 (build 126), Java 25, Mojang names. Event names come from [neoforge-api-notes.md](neoforge-api-notes.md) section 2 where it has them; the rest are candidates.

| Paper source | NeoForge candidate | Side, cancellable | Data available | Missing or doubtful | Tag |
|---|---|---|---|---|---|
| `EntityDamageEvent` (MONITOR) | `LivingDamageEvent.Post` (name and phase UNVERIFIED for 26.1) | game bus; server thread (UNVERIFIED per event) | entity, damage source, final damage | No Bukkit `DamageCause`. A map from the damage source's type key is needed (accessor UNVERIFIED). "Final" versus post-armour amount: UNVERIFIED | UNVERIFIED |
| `PlayerDeathEvent` | `LivingDeathEvent` (cancellable: UNVERIFIED) and `LivingDropsEvent` for the stack list (UNVERIFIED) | server | entity, source, drop list | Last damage cause and bed spawn point: accessors UNVERIFIED. Drops event fires before stacks land: UNVERIFIED | UNVERIFIED |
| `PlayerBedEnterEvent` (OK only) | `PlayerSleepInBedEvent` (cancellable: UNVERIFIED) | server | player, bed position, problem result | Mapping "OK" to the NeoForge result: UNVERIFIED | UNVERIFIED |
| `server_tps` (`Bukkit.getTPS()[0]`) | `ServerTickEvent.Pre` and `Post` with `System.nanoTime()`, or the per-dimension tick-time buffer `MinecraftServer#getTickTime(dim)` | server | 100-entry nanosecond ring per dimension; may be null for an unknown dimension | No Bukkit TPS. The candidate is `min(20, 1000 / mean MSPT over one minute)`. This is a derived value, not Bukkit's; see Q4 | VERIFIED accessor (patch, neoforge-api-notes section 9); formula semantics UNVERIFIED |
| Envelope `tick` (`GeldarCore::overworldTick`) | overworld game time | | | Accessor name for 26.1 | UNVERIFIED |
| Dimension | `level.dimension()` against the overworld, nether and end keys | | | Key constant names | UNVERIFIED |
| `player` name and life id | `ServerPlayer` profile name | | | The name the server sees behind Velocity is a P0 open item ([RESUME.md](RESUME.md)) | UNVERIFIED |
| Block events (not in P3) | `BreakBlockEvent` replaces `BlockEvent.BreakEvent` | client and server | | Not used by P3 | VERIFIED (neoforge-api-notes section 2) |

Paper events with no clean NeoForge equivalent:
- Respawn point at death: no single event. Read the player's respawn configuration at death (UNVERIFIED accessor).
- Bukkit one-minute TPS: derived as above; the number changes meaning.
- Velocity ghost channel (`GhostListener`): needs a payload; forbidden. Stays on the Velocity side.
- `ItemCraftedEvent` cannot cancel and does not expose the recipe ([neoforge-api-notes](neoforge-api-notes.md) section 2). Not used by P3.

## 4 Architecture

### 4.1 Reusing core-common

Options for `neoforge/` to consume `plugin/core-common`:
- (a) Composite build, as `neoforge-ledger/` does for `plugin/ledger-core` (`includeBuild("../plugin")`, substitution of the module coordinate; VERIFIED in `neoforge-ledger/README.md`). Recommended. Core-common is not published alone (its build file says core's jar packs it), so a composite is the only route that needs no new publish step.
- (b) A local published jar: needs a publish step and a version channel that does not exist. Rejected.
- (c) Copying sources: drifts. Rejected.

Core-common's dependencies: `gson` (compileOnly; NeoForge's bundled gson version is UNVERIFIED), `jnats` (implementation, so it is runtime and packed). Test-only libraries stay out of the mod.

### 4.2 Jar-in-jar

`jarJar` nests `jnats` and its transitive jars with strict ranges, following `neoforge-ledger/build.gradle.kts`. The pattern is VERIFIED for `ledger-core` and `opentelemetry-api`, `-common` and `-context` on NeoForge 26.1.2 (build 126): the loader listed all nested jars and reached `Done` (neoforge-ledger README, observed 2026-11-17). For jnats it is UNVERIFIED: its module layout and signed jars under the NeoForge module layer need a `runServer` smoke. Shadow relocation is the alternative; UNVERIFIED for 26.1; not preferred.

### 4.3 Verification and locking

`neoforge/` uses lenient lock mode (`lockMode = LENIENT`, comment in `neoforge/build.gradle.kts`: strict cannot work because Linux resolves netty epoll natives a Windows lockfile lacks) plus `verification-metadata.xml` sha256 checksums. Consequences:
- Adding core-common brings `jnats` and `gson` into `neoforge/`. The checksums must be written on Linux (CI) with `--write-verification-metadata sha256`, and the locks regenerated with `--write-locks`.
- Lenient mode lets a dependency missing from the lock resolve silently to a version in range. The strict jarJar range and the sha256 checks limit this, but do not stop a new version. P3-1 adds a test that the lock names the `jnats` coordinate and its exact version.
- Signatures are not verified (`verify-signatures` is false, per the `neoforge/README.md`). Unchanged by P3.

### 4.4 Threading and drop policy

Paper behaviour, copied as is (`NatsEventPublisher`, core-common):
- `publish` only enqueues into `BoundedEventQueue`. A full queue drops the oldest event and counts it.
- A daemon thread connects (5 s connect timeout; backoff 500 ms doubling to 30 s), creates `GELDAR_EVENTS` if missing, and drains the queue. A failed send goes back to the head of the queue; `Nats-Msg-Id` makes the retry idempotent.
- After `MAX_CONSECUTIVE_FAILURES` failed sends the worker reconnects and re-checks the stream. Drop counts are logged at most once per 60 s. On shutdown it sends what is left for a bounded time.
- While NATS is down the server keeps ticking. The `server_tps` payload carries `dropped` and `connected`, so an outage shows.

NeoForge rules:
- Handlers call `publish` and nothing else. No NATS call, no blocking I/O and no sleep on the server thread. The mod never opens its own connection.
- The publisher starts when the server starts and closes on `ServerStoppingEvent` (the close event is VERIFIED in `neoforge-ledger/README.md`; the start event is UNVERIFIED).
- Server-thread delivery of server events is UNVERIFIED per event (the telemetry plan says the same, [neoforge-telemetry.md](../telemetry/neoforge-telemetry.md) section 1.2 item 4).

### 4.5 Configuration

Paper: `config.yml` keys `nats.url`, `shard`, queue capacity; environment overrides `GELDAR_NATS_URL` and `GELDAR_SHARD`; `CoreConfig` checks the shard against `^[a-z][a-z0-9-]{1,31}$`. Credentials: `GELDAR_NATS_USER` and `GELDAR_NATS_PASSWORD_FILE` (a path; `NatsEventPublisher` reads the file).

NeoForge (proposed, same semantics):
- A mod config file under the server's config directory, through NeoForge's config API (UNVERIFIED for 26.1), with the same keys. Environment variables win, as on Paper.
- Credentials: a file path only. The mod reads the file and never logs its contents or the path's value. Logs say "credentials file: set" or "not set".
- Scratch versus live: the shard token is the switch. Scratch shards use a suffix (the P0 run uses `nf`). The mod refuses to start with a live shard name when a scratch flag is set (proposal; the flag name is for the owner).
- No file under `compose/secrets/` or `skins/` is read by the mod.

## 5 Maintenance notices

Paper today:
- `NatsMaintenanceSubscriber` (core-common) subscribes to `geldar.<shard>.maintenance` on its own thread. `MaintenanceNotice.parse` checks the payload against `maintenance-notice.schema.json` (fields `id`, `kind`, `scope`, `seconds`) and returns empty for anything invalid.
- `MaintenanceNotices.receive` runs on the NATS thread: it validates, builds the line, and hands the broadcast to the server thread (`runTask`). The line is `Server maintenance in N seconds.`, `Server maintenance soon.`, `Server maintenance finished.` or `Brief maintenance: some players may drop and return.`. Restarts of Bodies or the MCP are silent by design.
- `MaintenanceSetup` sets the broadcast with `server.broadcastMessage`, which reaches every connected player. `maintenance.broadcast` (default true) is re-read every 5 s.
- `eventsink` acks and skips `geldar.<shard>.maintenance` and never dead-letters it (`eventsink/src`, test names "acks a maintenance notice").
- Who publishes the notice is UNVERIFIED: no publisher found under `tools/` or `.github/` in this tree.

Agent visibility, the rule this must respect: spec section 5.8 says speech reaches agents only within 32 blocks, "There is no global chat", and spec section 5.9 says death is announced only to agents nearby (the proximity chat and deaths decision, [docs/decisions/0198-proximity-chat-and-deaths.md](../../decisions/0198-proximity-chat-and-deaths.md)). Bodies are vanilla-protocol clients, so a broadcast reaches them. Whether a Body's perception reads system chat is UNVERIFIED. The Paper broadcast may therefore be an agent-visible channel. This is a finding for the owner; Paper is not changed here.

NeoForge needs a server-side message path. Options:
- A. The same broadcast, restricted to human players (a predicate that excludes Body connections). Body identification is UNVERIFIED (the body-model note says a golem Body's UUID is derived as "Goldar:" plus its id; P0 reports what the server sees).
- B. Log line and stream only; no in-game line. Safest.
- C. A login or disconnect message to humans while a notice is active. Needs a login event (UNVERIFIED name) and the same Body predicate as A.

Recommendation: B by default for P3-4; A behind a config switch that is off by default, and only after the Body predicate has a live check. No option lets a vanilla client that is a Body receive a line. Text carries no agent name or id.

## 6 Testing plan

Unit tests (JUnit 6.1.3, `neoforge/src/test`, no server):
- Config: env over file, shard pattern, missing credentials file, credentials absent from `toString` and logs (the test captures the log output).
- Mapping: the three dimensions and an unknown one; empty stacks skipped; death fields; the `server_tps` formula over a fixed tick-time ring, including an unfilled (zero-padded) ring.
- Publisher lifecycle: close during a backlog; start failure leaves the server running; NATS down increments `dropped` and never blocks the caller (uses core-common fakes).
- Maintenance: the Body predicate; switch off means no line; invalid JSON means no line; text matches `MaintenanceNotice`.
- Each packet: a revert check (fails without the change) and abort, close and error-path tests where it has a counter, queue or timer.
- Inherited: `NoRegistryScanTest` and `ModInfoTest`.

GameTests (all UNVERIFIED):
- Registration through `RegisterGameTestsEvent` on the mod bus; test functions are `Consumer<GameTestHelper>` in `BuiltInRegistries.TEST_FUNCTION`; structures under `data/<ns>/structure/` (neoforge-api-notes section 7).
- Run with `gradlew runGameTestServer`; the exit code is the number of failed required tests (VERIFIED from the docs statement in neoforge-api-notes).
- Cases: a damage and a death on a probe player, a sleep, a tick-time read. Needs a harness to fake a player: UNVERIFIED.
- Server-backed unit tests need `net.neoforged:testframework` and `EphemeralTestServerProvider` (package UNVERIFIED).

Scratch lane (scratch only, ops-run after the owner's go; this is a write action, so it is not run by a coder):
- A p0-probe style script, in the same style as the P0 probe ([p0-findings.md](p0-findings.md)): subscribe to `geldar.<nf shard>.death` on the scratch stack, perform one probe action, assert one envelope with the expected shard and `agent_id`, and clean up.
- Starts from a clean journal for the test's life; filters on the shard subject, because the stream is shared.
- Check: no line from a maintenance notice reaches a Body (log check).
- Probes use read-only verbs (`data get`, `execute if`, `tick query`, `version`, `list`, `gamerule`) except the one action.

CI: the `neoforge` job in `.github/workflows/ci.yml` already builds `neoforge/` and `neoforge-ledger/` (line 76). A `runGameTestServer` step is added only with P3-5.

## 7 Packet breakdown

Colo-images paths are `golem/`, `eventsink/`, `tools/admin/`, `contract/`, `sql/`. None of these packets needs them. A change under one of them would trigger the colo image path; P3-6 is the only one at risk.

| Packet | Scope and files | Size | Tests | Depends on | Colo path |
|---|---|---|---|---|---|
| P3-1 Build | Composite include of `plugin/` for core-common; `jarJar` of jnats; locks; `verification-metadata.xml`; `neoforge/README.md`. `neoforge/build.gradle.kts`, `settings.gradle.kts` | S | Jar-in-jar metadata test (like `JarJarVersionTest`); lock names jnats and its version; `runServer` smoke (the jar loads and reaches `Done`) | none | no |
| P3-2 Config and lifecycle | `neoforge/src/main/java`: config reader, publisher start and stop, credentials file. No event code | S to M | Unit config tests; close during backlog; NATS down drop count; revert check on the shard-token rule | P3-1 | no |
| P3-3 Event export | Move the Bukkit-free dimension and drops logic into core-common (new named class, not a utils name); NeoForge handlers for damage, death, sleep, `server_tps`. `plugin/core` golden jar unchanged | M | Mapping unit tests; revert check on dimension mapping; `verifyJarContents` golden test passes unchanged; abort and error tests on the handlers | P3-2 | no (stop and report if a schema change is needed: `contract/`) |
| P3-4 Maintenance | Subscriber reuse; Body predicate; default log-only; optional human-only line behind a switch | S | Body predicate; switch off; invalid JSON; the revert check on the predicate | P3-2; owner answer to Q3 | no |
| P3-5 GameTests | `RegisterGameTestsEvent` cases; `runGameTestServer` step in the `neoforge` CI job (`.github/` only) | M | The GameTests themselves; exit code check | P3-3 | no |
| P3-6 Scratch probe | Probe script and assertion; scratch only; placed under scratch tooling, not `tools/admin/` | S to M | Dry run of the assertion against a recorded envelope; the live run is ops' | P3-3; owner go | Only if placed in `golem/`, `eventsink/` or `tools/admin/`, which would trigger an auto deploy. Place it outside those |

## 8 Risks and open questions

Open questions for the owner:
- Q1. Shard names. Subjects are `geldar.<shard>.<type>` in one stream with the filter `geldar.*.*`, so any valid shard token works (VERIFIED in code). Should the live NeoForge shard have its own token? (Owner.)
- Q2. Does a NeoForge shard write to the same Postgres `events` table? The table has a `shard` column (`sql/0001_init.sql`, VERIFIED). The sink reads the stream and writes by envelope, so yes is the expectation; any shard filter in the sink is UNVERIFIED. (Owner, lead.)
- Q3. Maintenance line for humans on NeoForge: none (B), or a human-only line (A)? And is the Paper broadcast, which may reach Bodies, acceptable as it is? (Owner, agent-visibility.)
- Q4. The NeoForge `tps` is derived from tick time. Keep the field name `tps` and document the difference, or rename it? (Lead, contract.)
- Q5. Scratch and live shards share one stream and one `events` table, each with its shard value. Is that acceptable for the NeoForge scratch shard, given the 30-day retention? (Owner.)
- Q6. The telemetry plan names `geldar.maintenance.*` and `geldar.blockowner.*` as PROPOSED (its A10 row). The code uses `geldar.<shard>.maintenance`. The lead should settle which is the contract before the ledger mod counts them. (Lead.)
- Q7. jnats in both mods on one NeoForge server: each nests its own copy. Whether `neoforge-ledger` also needs jnats is UNVERIFIED. One owner per shared library, and a version check across both mods, is the proposal. (Lead.)
- Q8. The `server_tps` and the maintenance payloads: is the `server_tps` schema (none found by name) defined for the NeoForge shard? (Lead.)

Dependency on the telemetry session ([neoforge-telemetry.md](../telemetry/neoforge-telemetry.md), sibling module `neoforge-ledger/`, merged on `origin/main` per its card list):
- Separate mods, separate jars, separate mod ids (`ledger` and `geldar_neoforge`). Both are server-side, with no registry entries and no payloads.
- Both use the same composite of `plugin/` and the same rule on pins: the ledger reads the NeoForge pin from `neoforge/gradle.properties`, so a change to the pin touches both builds.
- The ledger has its own copy of the no-registry scan. This packet does not duplicate the ledger's work and does not read its metrics.
- The ledger's OpenTelemetry jar-in-jar and our jnats jar-in-jar are separate; their interaction is Q7.
- Both use the NeoForge game-bus server thread (UNVERIFIED per event); both must keep off-thread work away from it.

Risks:
- R1. A NeoForge `damage` event may fire for cancelled or pre-armour amounts that differ from Paper's MONITOR amount. Same event name, different number. Needs a GameTest.
- R2. Death drops on NeoForge may be read before or after a totem or keep-inventory change; the drop list may differ from Paper's.
- R3. The NeoForge `tps` (Q4) is not comparable with the Paper `tps` on the same dashboard without a label.
- R4. A Body that reads system chat would see the Paper broadcast (section 5). Paper's behaviour is a finding, not a change in this packet set.
- R5. Lenient lock mode (section 4.3).

UNVERIFIED claims (collected):
1. `LivingDamageEvent.Post`, `LivingDeathEvent` (cancellable), `LivingDropsEvent`, `PlayerSleepInBedEvent` (cancellable) exist in 26.1 with these names and phases.
2. Accessors for damage type, last damage cause, respawn configuration, dimension keys, game time, player profile name.
3. Server-thread delivery for each server event; the start event for the publisher; the login event (option C).
4. NeoForge config API (`ModConfigSpec`) for 26.1; bundled gson version.
5. jnats (and transitive jars) under the NeoForge module layer; shadow relocation.
6. Composite build substitution of core-common (the mechanism is VERIFIED for ledger-core; core-common is untested this way).
7. Body predicate: how a Body's UUID or name is seen by the server behind Velocity (P0 open item).
8. Whether a Body reads system chat (agent visibility of the Paper broadcast).
9. Which schema the Paper tests use for `damage` and `sleep`; whether the sink filters by shard.
10. Who publishes `geldar.<shard>.maintenance` (no publisher in `tools/` or `.github/`).
11. The GameTest harness for a fake player, and the `EphemeralTestServerProvider` package.
12. Whether `server_tps` has a schema for the NeoForge shard.
