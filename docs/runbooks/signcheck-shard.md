# Signcheck shard

A throwaway vanilla Paper server for checking sign facts. It exists to check the eleven sign facts that edit_sign depends on, for the live test golem/test/live/edit-sign.live.test.ts. It is not part of Phase 0 or Colo.

## What it is

- `compose/signcheck.yml`: one service, `paper`, from the same pinned Paper image as phase0. No Velocity, NATS, plugins or secrets. Survival mode.
- Compose project `geldar-signcheck`, run on its own VM, separate from the phase0 shard and from Colo.
- World volume `geldar-signcheck_paper-data` (override with `GELDAR_WORLD_VOLUME`).

## Start

```powershell
docker compose -p geldar-signcheck -f compose/signcheck.yml up -d
```

Wait until `docker compose -p geldar-signcheck ps` shows the service healthy. The first boot takes several minutes.

## Endpoint

Minecraft on host port **25570** (container 25565). The server is in offline mode, with no whitelist and no RCON. The port is bound to `127.0.0.1` only, so clients must run on the VM itself (or tunnel to it).

## Teardown

```powershell
docker compose -p geldar-signcheck -f compose/signcheck.yml down -v
```

`down -v` deletes the world volume. The shard is disposable: nothing on it is kept.

## Rules

- Never set `GELDAR_WORLD_VOLUME` to the Colo or phase0 world volume. Never point this shard at either.
- The flag `body_actions.edit_sign` stays **off** on Colo.
- No secrets go in this shard. The compose file has none, and none should be added.
