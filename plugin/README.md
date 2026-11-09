# Geldar plugins

A Gradle multi-project. Java 25 (see `.java-version`), Paper API 26.1.2 build 74. Every version is pinned in `gradle/libs.versions.toml` locked in `*.lockfile` and checksummed in `gradle/verification-metadata.xml` (refresh both with `./gradlew build --write-locks --write-verification-metadata sha256`). The Paper repository is consulted only for the Paper groups.

| Subproject | What it is |
|---|---|
| `core` | Geldar-Core, the Paper plugin (spec Appendix F). |
| `velocity-identity` | The Velocity bot-ingress identity plugin (spec Appendix F, 8.4): on `LoginEvent` it admits only usernames in the JetStream KV bucket `geldar-life-registry` (key: lowercase username, value `{life_id, registered_at}`; a deleted key revokes). A local cache fed by a watcher answers the check; the gate fails closed until the first sync and while the bucket is absent (Golem creates it). One fixed deny message. Drops `geldar:cmd` messages from connections that were not admitted. Velocity API 3.5.1; its `velocity-brigadier` 1.0.0-SNAPSHOT dependency is excluded (no release exists, and it would make the locks float). Output `velocity-identity/build/libs/geldar-velocity-identity.jar`; reads `GELDAR_NATS_URL`. |

## Build

```powershell
cd plugin
./gradlew build          # compiles, runs the JUnit tests, writes core/build/libs/geldar-core.jar
```

The jar carries `jnats`; Paper supplies the API. Compose mounts the jar read-only into Paper's plugins directory (`compose/phase0.yml`), so build before `./geldar.ps1 shard up phase0`. Compose does not run the build; `shard up` stops with a message when the jar is not a file (Docker would otherwise create a directory at that path and Paper would boot without the plugin).

To refresh the dependency locks after changing a version: `./gradlew build --write-locks`.

## Geldar-Core

- **Event export.** `server_tps` every 20 s, plus `damage`, `death` and `sleep`. Each event follows `contract/schemas/event.schema.json`: `source_event_id` (`ev_` plus a ULID), `at`, `shard`, `world_day`, `world_tick`, `type`, optional `agent_id` (set when the player name is a life id), and `payload`. Events go to `geldar.<shard>.<type>` in JetStream stream `GELDAR_EVENTS` (created if missing: subjects `geldar.*.*`, file storage, 30-day retention). The `Nats-Msg-Id` header is the `source_event_id`, so JetStream drops duplicates.
- **Never blocks the server.** Publishing only enqueues. A daemon thread connects with backoff and drains a bounded queue (10 000 by default) that drops the oldest event when full and counts the drops. A failed publish goes back to the head of the queue and is retried (`Nats-Msg-Id` keeps that idempotent). On disable the queue is flushed for up to two seconds. The `server_tps` payload carries `dropped` and `connected`, and the plugin logs the drop count (at most once a minute). The `server_tps` timer runs on wall-clock time, so lag does not thin it out.
- **Recipes.** On join a player discovers every registered recipe, so table crafts work without RCON (decision 0032).
- **Reserved and validated.** The event type `dlq` is reserved for the event sink and rejected here. `GELDAR_SHARD` must match `^[a-z][a-z0-9-]{1,31}$` or the plugin fails to enable.
- **Command block.** A command typed by a player is cancelled (at `HIGHEST` priority) and logged, truncated to 100 characters. Console and RCON are unaffected.
- **Ghosts.** Out of scope: Phase 0 has no ghosts, so there is no ghost handling here.

Settings are in `plugins/GeldarCore/config.yml`; `GELDAR_NATS_URL` and `GELDAR_SHARD` in the environment override the file. Phase 0 runs one open NATS on the compose network, so there is no credential; per-service accounts arrive later (spec 6.5).

## Tests

JUnit 6 tests need no server. Envelopes are validated against `../contract/schemas/event.schema.json` (with `networknt` json-schema-validator). MockBukkit has no release for Paper 26.1, so the listener tests use hand-written `Player` and `Server` doubles (`ListenerDoubles`).