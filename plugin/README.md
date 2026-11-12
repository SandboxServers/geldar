# Geldar plugins

A Gradle multi-project. Java 25 (see `.java-version`), Paper API 26.1.2 build 74. Every version is pinned in `gradle/libs.versions.toml` locked in `*.lockfile` and checksummed in `gradle/verification-metadata.xml` (refresh both with `./gradlew build --write-locks --write-verification-metadata sha256`). The Paper repository is consulted only for the Paper groups.

| Subproject | What it is |
|---|---|
| `core` | Geldar-Core, the Paper plugin (spec Appendix F). |
| `velocity-identity` | The Velocity bot-ingress identity plugin (spec Appendix F, 8.4): on `LoginEvent` it admits only usernames in the JetStream KV bucket `geldar-life-registry` (key: lowercase username, value `{life_id, registered_at}`; a deleted key revokes). A local cache fed by a watcher answers the check; the gate fails closed until the first sync and while the bucket is absent (Golem creates it). One fixed deny message. Drops `geldar:cmd` messages from connections that were not admitted. Velocity API 3.5.1; its `velocity-brigadier` 1.0.0-SNAPSHOT dependency is excluded (no release exists, and it would make the locks float). Output `velocity-identity/build/libs/geldar-velocity-identity.jar`; reads `GELDAR_NATS_URL`. |

## Build

```powershell
cd plugin
./gradlew build          # compiles, runs the JUnit tests, writes core/build/libs/geldar-core.jar and velocity-identity/build/libs/geldar-velocity-identity.jar
```

The jars carry `jnats`; Paper and Velocity supply their APIs. Compose mounts each jar read-only into the server's plugins directory (`compose/phase0.yml`), so build before `./geldar.ps1 shard up phase0`. Compose does not run the build; `shard up` stops with a message when either jar is not a file (Docker would otherwise create a directory at that path and the server would boot without the plugin). After the stack is healthy, `shard up` also checks the container logs (`docker logs`) for `Geldar-Core enabled` and `Geldar identity enabled`. The Paper and Velocity healthchecks do not read the rolling server logs: each plugin writes a readiness marker (`/tmp/geldar-core.ready`, `/tmp/geldar-identity.ready`) holding its process's pid and start time on enable and removes it on disable, and the healthcheck requires that marker to match the running process in `/proc`. A plugin that failed to load is never reported as healthy. Decisions: [0040](../docs/decisions/0040-bot-ingress-registry-in-nats-kv.md) (the gate) and [0041](../docs/decisions/0041-event-export-stream-and-sink.md) (the export).

To refresh the dependency locks after changing a version: `./gradlew build --write-locks`.

## Geldar-Core

- **Event export.** `server_tps` every 20 s, plus `damage`, `death` and `sleep`. Each event follows `contract/schemas/event.schema.json`: `source_event_id` (`ev_` plus a ULID), `at`, `shard`, `world_day`, `world_tick`, `type`, optional `agent_id` (set when the player name is a life id), and `payload`. Events go to `geldar.<shard>.<type>` in JetStream stream `GELDAR_EVENTS` (created if missing: subjects `geldar.*.*`, file storage, 30-day retention). The `Nats-Msg-Id` header is the `source_event_id`, so JetStream drops duplicates.
- **Never blocks the server.** Publishing only enqueues. A daemon thread connects with backoff and drains a bounded queue (10 000 by default) that drops the oldest event when full and counts the drops. A failed publish goes back to the head of the queue and is retried (`Nats-Msg-Id` keeps that idempotent). On disable the queue is flushed for up to two seconds. The `server_tps` payload carries `dropped` and `connected`, and the plugin logs the drop count (at most once a minute). The `server_tps` timer runs on wall-clock time, so lag does not thin it out.
- **Recipes.** Recipes unlock through play, as in vanilla (decision [0048](../docs/decisions/0048-recipe-discovery-is-part-of-the-game.md)): the plugin grants nothing on join. `recipes.grant_on_join: true` in `config.yml` brings back the old join-time grant of every recipe (decision 0032), for a test shard only; it is off by default and a failing grant is logged, never thrown into the server thread.
- **Gravestones (no loot).** When an agent character (a player named `ag_*`) dies in a normal-dimension world, the plugin places a stone-brick block with a standing sign at the nearest safe spot within 3 blocks (air to stand in, solid non-liquid ground below, no liquid beside it, open air preferred over a doorway or corridor). The sign reads `Here lies`, the username, `Day <N>` (blank if unknown) and one cause word (`slain`, `shot`, `drowned`, `fell`, `burned`, `starved`, `other`; never a killer's name). It holds no items: drops, XP, inventory, keepInventory and respawn stay exactly as vanilla and decision 0147 describe. It is an ordinary block: players can break it, and a broken sign drops a sign. No spot found is logged at debug and skipped. Config: `gravestones.enabled` (default `true`) and `gravestones.max_per_chunk` (default `4`; counted per run, extra ones are skipped, older ones are never removed). Read at enable, so changing them needs a restart. Ships through the manual plugin deploy (needs-manual in colo-cd).
- **Reserved and validated.** The event type `dlq` is reserved for the event sink and rejected here. `GELDAR_SHARD` must match `^[a-z][a-z0-9-]{1,31}$` or the plugin fails to enable.
- **Command block.** A command typed by a player is cancelled (at `HIGHEST` priority) and logged, truncated to 100 characters. Console and RCON are unaffected. This applies to every player, operators included: Phase 0 has no humans, so debugging in game as an owner goes through RCON or the console (`rcon-cli` in the Paper container), not through typed commands. Log lines are limited to 10 per 10 s window (the rest are counted), and control, format and line-separator characters are replaced by spaces.
- **Ghosts.** Out of scope: Phase 0 has no ghosts, so there is no ghost handling here.

Settings are in `plugins/GeldarCore/config.yml`; `GELDAR_NATS_URL` and `GELDAR_SHARD` in the environment override the file. Phase 0 runs one open NATS on the compose network, so there is no credential; per-service accounts arrive later (spec 6.5).

## Velocity identity: known limits

- **Case and duplicate logins (unverified edge).** The registry key is the lowercase username, so `Alice` and `alice` are the same life. Whether Velocity 3.5.1 folds case when it detects a duplicate login (CONFLICTING_LOGIN) was not verified: the API jar does not contain the proxy's connection map. Offline-mode UUIDs are derived from the exact name, so two logins that differ only in case hold different UUIDs. If Velocity folds case and rejects the second as CONFLICTING_LOGIN, the plugin skips that release and the second UUID's admission is never released; if it does not fold case, both are admitted. Neither outcome is handled in code. Accepted for Phase 0 (one bot per life); to be settled against the proxy source or a live test.
- **Stale cache window.** A bucket deleted or recreated on a live connection is noticed by a probe every 30 s, not at once (see `docs/threat-model.md`).
- **Consumer deleted alone.** A watch consumer deleted on a live bucket is not detected: jnats 2.26.4 exposes no consumer info. Unit-tested only, like a bot's command being cancelled, `death` events reaching Postgres and a NATS outage while the gate runs (`docs/analysis/phase0/retro/wave-3.md`, open items).

## Tests

JUnit 6 tests need no server. Envelopes are validated against `../contract/schemas/event.schema.json` (with `networknt` json-schema-validator). MockBukkit has no release for Paper 26.1, so the listener tests use hand-written `Player` and `Server` doubles (`ListenerDoubles`).
