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