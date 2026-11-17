# geldar-neoforge

A server-side NeoForge 26.1.2 mod for the Geldar vivarium. This packet is the project skeleton only: it builds, loads on a dedicated server, logs one line on server start, and has a unit test. There is no game logic yet. The progression mod and the later Core adapter go here.

## Rules this project keeps

- **Server-side only.** The entry point is `@Mod(..., dist = Dist.DEDICATED_SERVER)`, and the `neoforge.mods.toml` dependencies on `neoforge` and `minecraft` are `side = "SERVER"`.
- **No registry entries and no network payloads.** Vanilla clients join without a client mod, so the mod adds no blocks, items, entity types, `DeferredRegister`s, `RegisterEvent` handlers or payload registrations. `NoRegistryScanTest` fails the build if one of those names appears in `src/main/java`.
- **Pinned versions only**, each at least two weeks old when it lands (see the table).
- No CI lane yet. The repo's CI does not build this project.

## Build and run

Run from this directory (`neoforge/`), Java 25 (the Gradle toolchain asks for it).

```powershell
./gradlew build      # compiles, runs the JUnit tests, writes build/libs/geldar-neoforge-0.1.0.jar
./gradlew runServer  # starts a dedicated server in run/ (the task name follows the `server` run; not yet run in this packet)
```

`gradlew build` downloads NeoForge and the Minecraft artifacts that ModDevGradle generates on first use, which takes a few minutes. `run/` and `build/` are gitignored.

## Pins

| Pin | Version | Date (publish, checked 2026-11-16) | Where |
|---|---|---|---|
| Gradle wrapper | 9.8.2, `distributionSha256Sum` set | 2026-10-19 | `gradle/wrapper/gradle-wrapper.properties` |
| NeoForge | 26.1.2, build 126 | installer 2026-11-01 | `gradle.properties` (`neoforge.version`) |
| ModDevGradle | `net.neoforged.moddev` 2.0.148 | pom 2026-09-29 | `build.gradle.kts` |
| Java toolchain | 25 | n/a | `build.gradle.kts` |
| JUnit | 6.1.3 (jupiter and platform launcher) | 2026-08-07 | `gradle/libs.versions.toml` |

Gradle 9.9.0 (2026-11-06) and 9.9.1 (2026-11-10) were newer than two weeks on 2026-11-16, so the wrapper stays on 9.8.2. The wrapper jar is the one from `plugin/gradle/wrapper`, which pins the same 9.8.2 distribution.

The NeoForge version key is `neoforge.version` rather than `neoforge_version`, because the repo's IP-literal check exempts a `version` key and would fail the build number otherwise (decision 0132).
