# Signcheck shard

A throwaway vanilla Paper server for checking sign facts. It exists to check the eleven sign facts that edit_sign depends on, for the live test golem/test/live/edit-sign.live.test.ts. It is not part of Phase 0 or Colo.

## What it is

- `compose/signcheck.yml`: by default one service, `paper`, from the same pinned Paper image as phase0. No Velocity, NATS, plugins or secrets. Survival mode.
- Profile `core`: adds `nats` (internal only, no host ports) and `paper-core` (the same Paper with geldar-core loaded). Used for the bubble and proximity probes below.
- Compose project `geldar-signcheck`, run on its own VM, separate from the phase0 shard and from Colo.
- World volume `geldar-signcheck_paper-data` (override with `GELDAR_WORLD_VOLUME`).

## Start

```powershell
docker compose -p geldar-signcheck -f compose/signcheck.yml up -d
```

Wait until `docker compose -p geldar-signcheck ps` shows the service healthy. The first boot takes several minutes.

## Endpoint

Minecraft on host port **25570** (container 25565). The server is in offline mode, with no whitelist and no RCON. The port is bound to `127.0.0.1` only, so clients must run on the VM itself (or tunnel to it).

## Core profile (geldar-core probes)

The `core` profile runs the same Paper with geldar-core loaded, plus a private NATS for its life registry and bus. `paper` and `paper-core` share the `paper-data` world volume, so run only one of them at a time. Stop `paper` before you start `paper-core`.

1. Build the jar from main, in the repo root:

   ```powershell
   (cd plugin; ./gradlew build)
   Copy-Item plugin/core/build/libs/geldar-core.jar compose/plugins/geldar-core.jar
   ```

   `compose/plugins/` is not gitignored. Never `git add` the jar. Set `GELDAR_CORE_JAR` to use a jar from elsewhere.

2. Create the RCON password file by hand, outside git: `compose/secrets/signcheck-rcon.txt` (gitignored; or `GELDAR_RCON_FILE`). Use a random value. Do not commit it or paste it into a log.

3. Start NATS and paper-core:

   ```powershell
   docker compose -p geldar-signcheck -f compose/signcheck.yml --profile core up -d nats paper-core
   ```

   Wait until `paper-core` is healthy. Its host port is **25571** (`127.0.0.1` only). NATS publishes no host port.

### Probes

Log each event with its timestamp from the server log, and keep the log lines with the result.

1. **Speech bubble marker expiry.** Make a bot speak. Watch the BlueMap marker set `geldar-speech` and record the timestamp when the marker is added and when it is removed. The gap should match the bubble lifetime.
2. **Proximity chat.** Place two bots in line at 20, 31, 33 and 40 blocks apart. Repeat with a wall between them at each distance. For each case, record which bot receives the chat line and which bot receives the death message.
3. **Sealed-room listener.** Put one bot in a room with no openings and one speaker outside. Record whether the listener still receives the chat. There is no occlusion today, so the listener is expected to still receive it. A change here means the occlusion behaviour has changed.

### Teardown

```powershell
docker compose -p geldar-signcheck -f compose/signcheck.yml --profile core down -v
```

`down -v` deletes the world volume and the NATS data. Nothing on this shard is kept.

## Teardown

```powershell
docker compose -p geldar-signcheck -f compose/signcheck.yml down -v
```

`down -v` deletes the world volume. The shard is disposable: nothing on it is kept.

## Rules

- Never set `GELDAR_WORLD_VOLUME` to the Colo or phase0 world volume. Never point this shard at either.
- The flag `body_actions.edit_sign` stays **off** on Colo.
- The default profile has no secrets. The `core` profile reads one RCON password file from `compose/secrets/` (gitignored). Create it by hand and never commit it.
