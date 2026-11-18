# The NeoForge BlueMap web service (bluemap-web-nf)

## What it is

`bluemap-web-nf` is a read-only static Caddy that serves the BlueMap tiles of the live NeoForge shard (project
`geldar-nf`) on loopback port `127.0.0.1:8110`. It is a separate overlay of the live project, not part of
`compose/nf-live.yml`:

- `compose/nf-live-bluemap-web.yml`: this overlay (the service, the port, the mount, the hardening).
- `compose/bluemap-web-nf/Caddyfile` and `compose/bluemap-web-nf/README.md`: the BlueMap team's snippet and Caddyfile,
  used unchanged. The Caddyfile bind in the overlay is relative to `compose/`, which is why the overlay lives there.

The container sees only the subpath `bluemap/web` of the volume `neoforge-data`, read only, at `/srv`. It never mounts
`/data`, so the world, `server.properties` (the RCON password), the mod jars and the mod configs are not visible to it.
It joins no network that reaches NATS, the game server or RCON: it has its own network, `bluemap-web-nf`, and it is not on
`nf` or `nf-human`. It has no secret and no `depends_on`.

## Precondition: bring it up only after BlueMap has rendered

The directory `bluemap/web` inside `neoforge-data` must exist before the container starts. BlueMap creates it on its first
render, so the first start of this service comes after that render. Nothing creates the directory by hand, and the overlay
has no `depends_on` on `neoforge`: a static file server does not need the game server, and the alone render (which CI and
`geldar.ps1` run with no environment) has no `neoforge` service to depend on.

## Bring-up

This packet changes no deploy script. The overlay is brought up by an explicit `docker compose` call, with the same
`NF_SERVICE_UID` and `NF_SERVICE_GID` that `deploy/nf-deploy.sh` exports for the project:

```
docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-bluemap-web.yml up -d --no-deps bluemap-web-nf
```

Always pass `--no-deps` and name only `bluemap-web-nf`. With `--no-deps`, compose acts on that one service and does not
recreate `neoforge`, `velocity` or any other service, even though this call's file list is not the one the project's
other overlays (telemetry, human lane, probe, extra mods) use. Without `--no-deps`, or with a file list that differs from
the running project's in a way that changes another service, compose may recreate that service. A later `nf-deploy.sh`
verb should carry this overlay in the project's file list; that verb is not in this packet.

Check the render first, without contacting a daemon:

```
docker compose -f compose/nf-live-bluemap-web.yml config --quiet
docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-bluemap-web.yml config --quiet
```

## The port and the edge

The only published port is `127.0.0.1:8110` (literal, loopback only; the loopback rule rejects interpolation). Nothing else
in `compose/*.yml` publishes 8110 (`nf-live-bluemap-web.test.ts` checks that). The deploy script's port gate counts only the
`velocity` rows of the project, so this container's row does not affect it.

The public name and TLS are not set here. `deploy/caddy/map-neoforge.caddy` is the edge site for `map.neoforge` and points
at this port; it is in the repo, is not loaded anywhere, and belongs to the BlueMap team's edge packet.

## Rollback

Stop and remove the one container. The named volume `neoforge-data`, its `bluemap/web` subpath and the Caddyfile are not
changed by this:

```
docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-bluemap-web.yml rm -sf bluemap-web-nf
```

## UNVERIFIED

Nothing in this packet has been started. Everything below is unverified until a run on the node:

- Whether Docker refuses a volume `subpath` that does not exist, or creates it. The docs and the Compose spec were not
  checked against a run here. The precondition above assumes the first start comes after BlueMap's first render.
- That the Compose version on the node reads `volume.subpath` and mounts it as this overlay expects (the local
  `docker compose` v2.40.3 renders it; a run was not made).
- That Caddy runs as `NF_SERVICE_UID:NF_SERVICE_GID` with a read-only root and a `/tmp` tmpfs, and reads the BlueMap files
  that the `neoforge` service writes under that uid.
- The memory budget (128 MiB, 0.25 CPU, 64 pids) under real tile traffic.
- That the BlueMap team's edge site serves `map.neoforge` through this port. Nothing here loads the edge.
- The multi-row port-gate fixture (a `bluemap-web-nf` row beside `velocity`) for `deploy/test/nf-deploy-port.test.ts` is
  not in this packet, because `deploy/**` is out of scope. The awk gate counts only `velocity` rows, so the row is ignored
  by reading the script; the fixture test was not run with it.
