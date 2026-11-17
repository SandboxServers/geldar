# neoforge-ledger

Server-side NeoForge 26.1.2 (build 126) adapter for the loader-neutral `plugin/ledger-core` (PT-N1 in `docs/analysis/telemetry/neoforge-telemetry.md`). It is a sibling Gradle build, not part of `plugin/` or `neoforge/`; neither is edited.

## Rules

- No registry entries, no network payloads, no mixins (`NoRegistryScanTest`). The `ledger` mod id is server-only (`Dist.DEDICATED_SERVER`, `side = "SERVER"`).
- No Paper types (`NoPaperImportsTest`); `NoLoaderImportsTest` mirrors the ledger-core test and also runs over the ledger-core tree.
- One copy of each pin: the NeoForge build is read from `../neoforge/gradle.properties` (`neoforge.version`), the ModDevGradle version from `../neoforge/build.gradle.kts`, the wrapper is a copy checked by `ModInfoTest`. The toolchain is Java 25. JUnit and `opentelemetry-api` pins are in `gradle/libs.versions.toml`.
- `ledger-core` comes in as a composite build (`includeBuild("../plugin")`, substituting `dev.geldar:ledger-core`).
- Jar-in-jar: ledger-core and opentelemetry-api, -common and -context are nested in the mod jar through `jarJar` with strict ranges (works with the composite-substituted ledger-core); `JarContentTest` opens the built jar. A real dedicated-server load is the PT-N3 spike.
- Fail-safe: any startup failure (bad config, missing class) leaves the ledger off and never stops the server; the ledger is closed on ServerStoppingEvent.
- Logging uses java.util.logging. PT-N3 result: records print on stderr (root ConsoleHandler) but are NOT in `logs/latest.log`. See `docs/analysis/telemetry/neoforge-otel-spike.md`, which also records that the jar-in-jar API and the agent's `GlobalOpenTelemetry` work under a real server load (`OtelLoadTest` covers the no-agent half).
- Own `gradle/verification-metadata.xml` and lockfiles.
- CI: the `neoforge` job in `.github/workflows/ci.yml` runs `./gradlew build` here and in `neoforge/` (Java 25, dependency verification on, no server start) and feeds `ci gate`.

## Build

```powershell
cd neoforge-ledger
./gradlew build
```

Config is `config/ledger.properties`; a missing file means defaults. The keys are the core's (`enabled`, `collector.<id>.enabled`, `rate.<eventName>`, budgets); the collector ids differ from Paper's. The master `enabled=false` stops every collector.

| Key | Default | Covers |
|---|---|---|
| `collector.tick.enabled` | on | tick lag, overruns, stalls, per-world tick time (as Paper's tick) |
| `collector.progress.enabled` | off | advancements and the 300 s stats read |
| `collector.curated.enabled` | off | the curated block, item and container events |
| `collector.audit.enabled` | off | every audit family below: chat text, console and RCON command text, combat, operator change |
| `collector.combat.enabled`, `collector.operator.enabled` | on, but only matter once audit is on | switch one audit family off |

Audit is opt-in, like Paper's curated data: absent or anything but `true` means off. It is checked at install and again on every event on whatever thread it arrives (chat and RCON are not server-thread events), so off means nothing is recorded and no chat or command text is read. The wiring handlers may still read player names, the dimension, the damage cause and the command source name before the gate (only when audit is on but `collector.combat.enabled` or `collector.operator.enabled` is false); none of that is recorded. Nothing exports until the owner sets a window and the keys.

## Tick (PT-N4a, package `tick`)

Tick lag, overruns, stalls (a watchdog on its own daemon thread) and the per-dimension tick time. On unless `collector.tick.enabled=false` or the master is off; then no listener, gauge or watchdog starts.

## World, server and snapshot (PT-N4b)

| Key | Default | What |
|---|---|---|
| `collector.world.enabled` | on (as Paper) | `geldar_world_loaded_chunks`, `geldar_world_entities`, `geldar_world_players`, attribute `world` = dimension name |
| `collector.server.enabled` | on (as Paper) | `geldar_players_online`, `geldar_operators_count`, `geldar_mods_loaded` (count of loaded mods only: no names or versions; the mod-list event of plan P-N1 is not implemented), one `geldar.server.config_snapshot` event 5 s after start |
| `collector.snapshot.enabled` (Paper's spelling `collector.snapshots.enabled` also works) | off (opt-in; Paper's is on) | `geldar.player.snapshot` for each online agent every 60 s |

- **World counts are approximate and unverified.** They are running counts from chunk load and unload and entity join and leave events (the server has no verified total accessor), and the gauge descriptions say so. They start counting in the mod constructor so spawn chunks are included. Known drift: a mod that cancels `EntityJoinLevelEvent` after our listener leaves +1 for an entity that never enters the level and never fires a leave. Our listener runs at LOWEST priority and a cancelled join is not delivered to it, which should remove the cancel-before-us case, but that is unverified too. The zero clamp hides only downward drift; upward drift is invisible. Until scratch row NF-W1 (`docs/analysis/telemetry/paper-plugin/scratch-test-plan.md`: gauge versus a real count after restart, idle, a mob-farm run and a dimension change) has been run on a live server, treat entity and chunk counts as indicative; players per dimension is the least fragile. A dimension created after server start gets no gauge. At most 16 dimensions, names up to 64 characters. The `world` value is the dimension id (`minecraft:overworld`), not a Paper world name.
- The config snapshot reads an allow-list only: `server_version`, `view_distance`, `simulation_distance`, `max_players`, `online_mode`, `jvm_xmx`. No `rcon.*`, `query.*`, address or seed key is ever read.
- Snapshots carry life ids only (`geldar.life_id`, world, block position, health, food, xp level, game mode); a player whose name is not a life id is never read past the name. No session id (waits for the connection collector), ping, UUID or address. A stop or restart makes a fresh queue, so an old drain task cannot touch the new run.
- `jvm_xmx` in the config snapshot is the last `-Xmx` or `-XX:MaxHeapSize=` among the JVM arguments, else `MaxRAMPercentage=<n>`, else `unknown`.
- No scheduler-pending-tasks gauge: NeoForge has no such count.

## Progress (PT-N9, package `players`, opt-in: `collector.progress.enabled=true`)

`geldar.player.advancement` (earn and grant, two buckets under one `rate.` key) and `geldar.player.stats` (read from the player stats file every 300 s on the async scheduler, never the main thread). Life ids only; a human is never named; stat keys come from a constant allow-list. Advancement events off the server thread are ignored.

## Audit events (PT-N8, package `audit`, opt-in: `collector.audit.enabled=true`)

A rate denial for chat or a command goes to a rate-0 twin event (`<event>._rate_drop`), so the core's rate-drop counter counts it like a core drop. The `._rate_drop` twins are internal: they carry no text and no attributes and must not be configured (do not set `rate.<event>._rate_drop`; a nonzero rate would emit an empty event). `geldar.operator.change` is in the names table of the Paper plugin README (docs/analysis/telemetry/paper-plugin/README.md, section 4).

| Event | Source | Notes |
|---|---|---|
| `geldar.combat.damage` | `LivingDamageEvent.Post` | player victim or attacker only; pvp keeps the victim |
| `geldar.combat.player_death` | `LivingDeathEvent` | cause and dimension only, no message |
| `geldar.combat.kill` | `LivingDeathEvent` | player killer, non-player victim |
| `geldar.chat` | `ServerChatEvent` | raw typed text, scrubbed and capped; speaker only as a life id; `rate.geldar.chat` (default 20/s) |
| `geldar.console.command`, `geldar.rcon.command` | `CommandEvent` | only the console (the server itself as source) and RCON (an `RconConsoleSource`) with no entity and the matching name; player and command-block commands are not exported, even a block renamed `Server` or `Rcon`; `rate.<event>` per event (default 20/s) |
| `geldar.operator.change` | `PermissionsChangedEvent` | online players only; `geldar.flag` 1 = opped, 0 = deopped (a literal in the family, not in `Names`) |

Every listener runs at LOWEST priority and does not receive cancelled events. `/say`, `/msg` and `/me` do not fire `ServerChatEvent`, so private messages are not captured. Whitelist changes, kick reasons, prelogin, sign and book edits have no known NeoForge event: nothing is emitted for them.

## Curated events (PT-N7, opt-in: `collector.curated.enabled=true`)

Emitted on the NeoForge game bus at lowest priority, cancelled events included; each event has a bucket at `rate.<eventName>` (default 20/s) taken before any reading, and a denial is counted by the core rate-drop counter like any structured event.

| Event | Position | Name attribute |
|---|---|---|
| `geldar.block.break`, `geldar.block.place` | the block | `geldar.block` |
| `geldar.block.break_cancelled`, `geldar.block.place_cancelled` | the block | `geldar.block` |
| `geldar.item.craft`, `geldar.item.smelt` | the acting player's block (as Paper craft) | `geldar.item` |
| `geldar.container.open`, `geldar.container.close` | none (slots skipped) | `geldar.container_type` |

All carry `geldar.life_id` only when the player name is a life id (humans recorded without an id) and `geldar.world`.

Names: `break`, `place`, `craft`, `container.open`, `container.close` match Paper. NeoForge-only: `smelt` (Paper has `furnace_extract`, which is not emitted here), `break_cancelled`, `place_cancelled` (Paper drops cancelled events). A Paper alert on `furnace_extract` never fires on NeoForge.

Positions follow D2 as built on Paper. The card line "item events without position" disagrees with Paper (craft carries the actor's block); the owner decides D2. Container events carry no position because the menu does not expose its location safely (Paper carries the container's).

Privacy note: `geldar.container_type` is the menu class simple name, capped at 48 characters, and `unknown` when empty. `ChestMenu` is shared by chests, ender chests, barrels and minecarts, so they cannot be told apart. A modded menu class name discloses part of the mod stack, which is the mod-list question in the plan (P-N1).

Not emitted (UNVERIFIED in the API spike or without a VERIFIED row): furnace extract, enchant, buckets, harvest, consume, pickup, drop, and placements by non-players.

## Connections and mc_session (PT-N6)

| Key | Default | Emits |
| --- | --- | --- |
| `collector.connections.enabled` | on (as Paper) | `geldar.player.join` (`amount` = roster size), `geldar.player.quit` (`duration_ms`) |

- A name with the life id shape gets `geldar.life_id` and a per-connection ULID `geldar.mc_session` (opened at login, closed at logout, keyed by the player object, so a late logout of an old connection never closes a reconnected agent's session). The snapshot event carries the same `mc_session`.
- A human gets neither, and no name, UUID or address is read or exported. Behind Velocity the server sees the same name as the Body and the standard offline UUID, which is reversible by dictionary, so no UUID is used. A human-client join is untested.
- Gaps: no verified event for prelogin or kick reasons (nothing is emitted), and no quit cause.
- Not yet wired to `mc_session`: the advancement event (follow-up; the progress collector is keyed by UUID).
