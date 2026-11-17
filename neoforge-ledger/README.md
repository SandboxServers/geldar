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

Config is `config/ledger.properties` (same keys as the Paper plugin); a missing file means defaults. No collectors are registered yet.
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
