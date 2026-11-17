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
- No CI lane (a lane needs a separate owner-approved change).

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

Audit is opt-in, like Paper's curated data: absent or anything but `true` means off. It is checked at install and again on every event on whatever thread it arrives (chat and RCON are not server-thread events), so off means no read and no record. Nothing exports until the owner sets a window and the keys.

## Tick (PT-N4a, package `tick`)

Tick lag, overruns, stalls (a watchdog on its own daemon thread) and the per-dimension tick time. On unless `collector.tick.enabled=false` or the master is off; then no listener, gauge or watchdog starts.

## Progress (PT-N9, package `players`, opt-in: `collector.progress.enabled=true`)

`geldar.player.advancement` (earn and grant, two buckets under one `rate.` key) and `geldar.player.stats` (read from the player stats file every 300 s on the async scheduler, never the main thread). Life ids only; a human is never named; stat keys come from a constant allow-list. Advancement events off the server thread are ignored.

## Audit events (PT-N8, package `audit`, opt-in: `collector.audit.enabled=true`)

A rate denial for chat or a command goes to a rate-0 twin event (`<event>._rate_drop`), so the core's rate-drop counter counts it like a core drop. `geldar.operator.change` is not yet in the names table of the Paper plugin README (docs/analysis/telemetry/paper-plugin/README.md, section 4); that table is outside this module.

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
