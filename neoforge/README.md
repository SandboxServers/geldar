# geldar-neoforge

A server-side NeoForge 26.1.2 mod for the Geldar vivarium. It builds, loads on a dedicated server, carries the NATS export lifecycle, and exports four event types (damage, death, sleep, server_tps; see below). There is no game logic yet. The progression mod and the later Core adapter go here.

## Export: config and publisher lifecycle (P3-2)

The mod starts a NATS publisher when the server starts and closes it when the server stops. It is **off by default**: with no config the mod logs `geldar_neoforge export disabled` and connects to nothing, so existing scratch runs are unchanged.

**Not done yet:** the scratch-stack proof of the exported events (a later packet, see Events) and maintenance notices (P3-4). Drops and respawn are not exported.

Config file: `config/geldar_neoforge.properties`, read from the server's working directory (its `config/` directory). A plain properties file is used instead of NeoForge's `ModConfigSpec`, because that API is UNVERIFIED for 26.1 and a properties file can be unit-tested without a server. Environment variables win over the file, as on Paper.

| Key | Environment (wins) | Default | Meaning |
|---|---|---|---|
| `export.enabled` | `GELDAR_NEOFORGE_EXPORT` | `false` | `true` turns the export on (only `true` enables it) |
| `nats.url` | `GELDAR_NATS_URL` | `nats://nats:4222` | `nats://` or `tls://`, with no credentials in the URL |
| `shard` | `GELDAR_SHARD` | none; required when enabled | one NATS subject token, `^[a-z][a-z0-9-]{1,31}$` (no `phase0` default, so the mod never writes Paper's shard by accident) |
| `nats.user` | `GELDAR_NATS_USER` | unset | the NATS user; set together with `nats.password.file` |
| `nats.password.file` | `GELDAR_NATS_PASSWORD_FILE` | unset | path to a file holding the password. Read at connect time; its content is never logged or kept |
| `queue.capacity` | none | `10000` | the bounded queue; the oldest event is dropped when it is full |

Rules:
- Any problem while enabled (a bad or credentialed URL, a missing or bad shard, a user without a password file, an unreadable password file, a bad capacity) leaves the export off. Each problem logs one warning that names the key, never the value or the path. The server keeps running.
- Credentials: core-common's `NatsEventPublisher` reads `GELDAR_NATS_USER` and `GELDAR_NATS_PASSWORD_FILE` from the environment, or from system properties of the same names. When the properties file supplies them and the environment does not, the mod sets those system properties. This is process-wide JVM state; it is the only seam core-common offers without editing it.
- Operator log lines (never agent-visible): `geldar_neoforge export disabled`, `geldar_neoforge export enabled, shard <token>`, `geldar_neoforge export stopped, dropped <n>`. A NATS outage logs one warning, and the next only after a reconnect.
- Threading: `publish` only enqueues. The connection, the retries (500 ms doubling to 30 s) and the flush run on core-common's daemon thread. Stop flushes for a bounded time (about 3 s) and then closes. While NATS is down the server keeps running and events are counted as dropped.
- Start hook: `ServerStartingEvent`, the event this mod already uses. `ServerStartedEvent` is not used anywhere in the repo, so it is UNVERIFIED. Stop hook: `ServerStoppingEvent` (VERIFIED in `neoforge-ledger`).

Tests: `ExportConfigTest` (defaults, env over file, bad or credentialed URL, missing password file, shard rule, capacity, `toString` without the path), `ExportLifecycleTest` (order, factory failure, publish without waiting for NATS, NATS down with drops and a bounded stop, no password or user in the log), `OperatorLogBridgeTest` (one warning per outage). The NATS-up path needs a live NATS and is not covered by a unit test; it belongs to the live lane.

## Events (P3-3)

When the export is on, the mod publishes these events on the subject `geldar.<shard>.<type>`. The payload fields are Paper's, so a NeoForge shard and a Paper shard publish the same shape. The NeoForge classes below were checked with `javap` against the 26.1.2 jars.

| Type | NeoForge event (verified) | Payload | Notes |
|---|---|---|---|
| `damage` | `LivingDamageEvent.Post`: `getInflictedDamage()`, `getSource()` | `player`, `cause`, `amount` | `ServerPlayer` only |
| `death` | `LivingDeathEvent`: `getSource()` | `player`, `cause`, `x`, `y`, `z`, `dimension` | `ServerPlayer` only; no drops, no respawn |
| `sleep` | `CanPlayerSleepEvent`: `getProblem()`, `getEntity()` | `player` | see below |
| `server_tps` | `ServerTickEvent.Pre` and `.Post`: `getServer()` | `tps`, `players`, `dropped`, `connected` | every 400 ticks (20 s) |

The listeners are registered only when the export is enabled. With the export off, the mod registers no listener at all (`ExportListenersTest`). The tick type uses two listeners (Pre starts the clock, Post ends it), so five listeners are registered in all.

- **Sleep.** `PlayerSleepInBedEvent` does not exist in 26.1.2, so the mod uses `CanPlayerSleepEvent`. Its `getProblem()` is the reason the game refuses the sleep. `allowed` is not a field: a `sleep` event is written only when `getProblem()` is `null`, which is how an allowed sleep is mapped. A refused sleep writes nothing. The payload is the player only, as on Paper. UNVERIFIED: that a `null` problem means a bed was really used, and that the event fires only for an actual attempt.
- **Damage.** The `amount` is `getInflictedDamage()`, which may differ from Paper's final damage (`getFinalDamage()`). UNVERIFIED on 26.1.2; check it with a GameTest or the first scratch run.
- **Cause.** A best-effort table from the vanilla damage type's message id to Bukkit's cause names; an unknown id is written as `CUSTOM`.
- **Not exported.** Drops: `LivingDropsEvent` is not listened to, because its order against the death event is UNVERIFIED, so death is written from `LivingDeathEvent` alone. Respawn: no listener yet. The schema allows both absent. Both are open for the owner.
- **Shard token.** Read from config (`GELDAR_SHARD` or the properties file), with no default. The live NeoForge shard will be `nf` and the scratch shard `nf-scratch`; both are set in config and never written in code. A bad token leaves the export off.
- **`server_tps`.** The `tps` field is derived from tick time on NeoForge, not Bukkit's TPS: the mean tick duration over the last 1200 ticks, capped at 20. The name and shape are Paper's. `contract/` has no payload schema for this type (Q8). The Paper payload shape is used, and no schema was invented; the owner decides whether one is needed.
- **`source_event_id`.** A fresh ULID per envelope, as on Paper (`EventEnvelope.create`). It is reused only when the same envelope is retried, so it is not stable across a restart.
- **Proof on the scratch stack.** Not done in this packet (`live: pending`). A later probe-style check, using read-only verbs, will confirm that an exported event appears in the NATS stream.

## Rules this project keeps

- **Server-side only.** The entry point is `@Mod(..., dist = Dist.DEDICATED_SERVER)`, and the `neoforge.mods.toml` dependencies on `neoforge` and `minecraft` are `side = "SERVER"`.
- **No registry entries, no network payloads, no mixins.** Vanilla clients join without a client mod, so the mod adds no blocks, items, entity types, `DeferredRegister`s, `RegisterEvent` handlers or payload registrations. `NoRegistryScanTest` fails the build if one of those names appears in `src/main/java` or `src/main/resources` (matched case-insensitively), or if a mixin config is in the resources.
- **Pinned versions only**, each at least two weeks old when it lands (see the table).
- No CI lane yet. The repo's CI does not build this project.

## Build and run

Run from this directory (`neoforge/`), Java 25 (the Gradle toolchain asks for it).

```powershell
./gradlew build      # compiles, runs the JUnit tests, writes build/libs/geldar-neoforge-0.1.0.jar
./gradlew runServer  # starts a dedicated server in run/ (the task name follows the `server` run). NOT RUN: a dedicated-server start has not been run in this packet
```

`gradlew build` downloads NeoForge and the Minecraft artifacts that ModDevGradle generates on first use, which takes a few minutes. `run/` and `build/` are gitignored.

## Loader version

`neoforge.mods.toml` declares `modLoader = "javafml"` and `loaderVersion = "[11,)"`. The javafml language provider is FML version 11.0: the fancymodloader `loader` 11.0.15 jar has the manifest `Implementation-Version: 11.0`, and FML checks `loaderVersion` against that. An earlier draft carried `[26.1,26.2)`, which can never match 11.0, so a dedicated server would refuse the mod. The mods.toml docs page (checked 2026-11-16) still says javafml is "currently version 1", which is older than the loader this NeoForge build ships, so the range comes from the loader jar, not the docs. `ModInfoTest` reads the toml and checks that the range accepts 11.0.

The `neoforge` and `minecraft` dependency ranges stay `[26.1,26.2)` with `side = "SERVER"`. `ModInfoTest` checks that each accepts the pinned 26.1.2.

## Repositories

- `settings.gradle.kts`, `pluginManagement`: the Gradle plugin portal, and the NeoForged maven for the `net.neoforged` groups only.
- `settings.gradle.kts`, `dependencyResolutionManagement`: `PREFER_PROJECT`, with no repository declared in settings. Settings-level repositories were dead under `PREFER_PROJECT` (the project's repositories win), so they were removed rather than left as a false record.
- Project repositories in effect: the ones ModDevGradle adds (Mojang libraries and meta, the NeoForged maven, and Minecraft Forge for mergetool). `build.gradle.kts` adds Maven Central as an `exclusiveContent` repository for `org.junit`, `org.opentest4j` and `org.apiguardian` only, so the test libraries come from Central and not from the NeoForged mirror.

## Shared code and jnats

- `settings.gradle.kts` includes `../plugin` as a composite build and substitutes `dev.geldar:core-common` with `:core-common`. The plugin build is not edited and nothing is copied or published. This is the pattern `neoforge-ledger/` uses for `ledger-core`.
- `core-common` is packed into `geldar-neoforge-0.1.0.jar` as a jar-in-jar (`jarJar("dev.geldar:core-common")`, strict range `[0.1.0]`, preferred `0.1.0`). The server has neither core-common nor its libraries.
- **jnats has one owner: this module.** `neoforge/build.gradle.kts` nests `io.nats:jnats` (`jarJar`, strict range `[2.26.4]`, preferred `2.26.4`). This module publishes the jar the server loads for the export, so it is the one that carries the library. `core-common` declares jnats as an `implementation` dependency and does not nest it; `neoforge-ledger/` does not nest it either. `tools/repo-checks/src/neoforge-jarjar-owner.test.ts` fails if a second NeoForge module nests jnats, and checks that the jnats pin matches `plugin/gradle/libs.versions.toml`.
- The core-common sources are on the scan list of `NoRegistryScanTest`, because they are packed into this jar.
- The jar-in-jar nesting of jnats on the server (module layer, signed jars) is unverified until a `runServer` smoke. This packet changes wiring only; the mod still adds no payloads or registry entries.

## Dependency verification and locking

- `gradle/verification-metadata.xml` holds sha256 checksums for the resolved artifacts. It is written by `./gradlew --write-verification-metadata sha256 build` and is not hand-edited. Verification is on for every build; nothing in this project turns it off. Its line cap is an exemption in `tools/repo-checks/src/line-cap-exemptions.json` ("generated dependency checksums").
- `dependencyLocking { lockAllConfigurations() }` writes `gradle.lockfile` and `settings-gradle.lockfile`. Regenerate them with `./gradlew build --write-locks` after a dependency change, and commit them. The lock files are generated by Gradle and are exempt from line caps by name.
- Gap: signatures are not verified (`verify-signatures` is `false`), so the checksums pin what was resolved on the day, not who signed it.

## Pins

| Pin | Version | Date (publish, checked 2026-11-16) | Where |
|---|---|---|---|
| Gradle wrapper | 9.8.2, `distributionSha256Sum` set | 2026-10-19 | `gradle/wrapper/gradle-wrapper.properties` |
| NeoForge | 26.1.2, build 126 | installer 2026-11-01 | `gradle.properties` (`neoforge.version`) |
| ModDevGradle | `net.neoforged.moddev` 2.0.148 | pom 2026-09-29 | `build.gradle.kts` |
| Java toolchain | 25 | n/a | `build.gradle.kts` |
| JUnit | 6.1.3 (jupiter and platform launcher) | 2026-08-07 | `gradle/libs.versions.toml` |
| jnats | 2.26.4 (the pin `plugin/gradle/libs.versions.toml` already uses) | as that file | `gradle/libs.versions.toml` |

Gradle 9.9.0 (2026-11-06) and 9.9.1 (2026-11-10) were newer than two weeks on 2026-11-16, so the wrapper stays on 9.8.2. The wrapper jar is the one from `plugin/gradle/wrapper`, which pins the same 9.8.2 distribution.

The NeoForge version key is `neoforge.version` rather than `neoforge_version`, because the repo's IP-literal check exempts a `version` key and would fail the build number otherwise (decision 0132). The four-number NeoForge build appears only under that key and in the generated verification metadata, which the IP-literal check excludes.
