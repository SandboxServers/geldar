# Geldar plugins

A Gradle multi-project. Java 25 (see `.java-version`), Paper API 26.1.2 build 74. Every version is pinned in `gradle/libs.versions.toml` and locked in `*.lockfile`.

| Subproject | What it is |
|---|---|
| `core` | Geldar-Core, the Paper plugin (spec Appendix F). `velocity-identity` follows in a later packet. |

## Build

```powershell
cd plugin
./gradlew build          # compiles, runs the JUnit tests, writes core/build/libs/geldar-core.jar
```

The jar carries `jnats`; Paper supplies the API. Compose mounts the jar read-only into Paper's plugins directory (`compose/phase0.yml`), so build before `./geldar.ps1 shard up phase0`. Compose does not run the build.

To refresh the dependency locks after changing a version: `./gradlew build --write-locks`.

## Geldar-Core

- **Event export.** `server_tps` every 20 s, plus `damage`, `death` and `sleep`. Each event follows `contract/schemas/event.schema.json`: `source_event_id` (`ev_` plus a ULID), `at`, `shard`, `world_day`, `world_tick`, `type`, optional `agent_id` (set when the player name is a life id), and `payload`. Events go to `geldar.<shard>.<type>` in JetStream stream `GELDAR_EVENTS` (created if missing: subjects `geldar.*.*`, file storage, 30-day retention). The `Nats-Msg-Id` header is the `source_event_id`, so JetStream drops duplicates.
- **Never blocks the server.** Publishing only enqueues. A daemon thread connects with backoff and drains a bounded queue (10 000 by default) that drops the oldest event when full and counts the drops.
- **Recipes.** On join a player discovers every registered recipe, so table crafts work without RCON (decision 0032).
- **Command block.** A command typed by a player is cancelled and logged. Console and RCON are unaffected.
- **Ghosts.** Out of scope: Phase 0 has no ghosts, so there is no ghost handling here.

Settings are in `plugins/GeldarCore/config.yml`; `GELDAR_NATS_URL` and `GELDAR_SHARD` in the environment override the file. Phase 0 runs one open NATS on the compose network, so there is no credential; per-service accounts arrive later (spec 6.5).

## Tests

JUnit 5 tests need no server. Envelopes are validated against `../contract/schemas/event.schema.json` (with `networknt` json-schema-validator). MockBukkit has no release for Paper 26.1, so the listener tests use hand-written `Player` and `Server` doubles (`ListenerDoubles`).