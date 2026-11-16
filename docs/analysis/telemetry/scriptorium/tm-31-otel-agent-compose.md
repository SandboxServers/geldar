# TM-31: otel-agent compose file, the shared network and the opt-in player overlay (scriptorium repo)

Repo: geldar-scriptorium. Depends on: TM-30. Unblocks: TM-32, TM-33, TM-34. Mind redeploy: none until the overlay is used (opt-in). `colo-images` path: n/a. Node step: none (N13 uses these files).

## Goal

Package the agent so the owner can run exactly one per Mind host, reachable from every player's supervisor and from nothing else, holding the token alone. Plus an overlay that adds the endpoint to a player only when asked.

## Files (exactly these)

- `image/compose/otel-agent.yml` (new)
- `image/compose/player-otel.yml` (new)
- `image/compose/otel-compose.test.ts` (new)

## `otel-agent.yml` (shape)

- Project name is chosen by the caller (`-p geldar-otel-agent`), not set in the file.
- Service `otel-agent`: `image: otel/opentelemetry-collector-contrib@sha256:<digest>`; the digest is resolved at implementation time and compared with the gateway pin in `docs/analysis/telemetry/collector-design.md` section 2 of the geldar repository (survey digest `sha256:340c9ca6a36617084c6661bdc4f0fe92b7cda5a805d61673ec8db375fddc522b`, version 0.164.0, UNVERIFIED; if they differ, stop and report). Never a tag.
- `command: ["--config=/etc/otelcol/config.yaml"]`, volume `../otel-agent/config.yaml:/etc/otelcol/config.yaml:ro`.
- `environment`: the NAMES `GELDAR_INGEST_HOST` and `GELDAR_INGEST_TOKEN` with no values (taken from the caller's environment or a `--env-file` the owner holds, mode 0600, outside the repo). Use the `${NAME:?}` required form so an unset value stops `compose up`.
- `networks: [otel, egress]`: `otel` is `external: true`, `name: geldar-otel` (created once by the owner as `docker network create --internal geldar-otel`); `egress` is a normal project network with outbound access (the HTTPS to the Colo).
- `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `read_only: true`, `tmpfs: [/tmp]`, `user` the image's non-root user (read from the image's config; UNVERIFIED, report it), `cpus: 0.25`, `mem_limit: 256m`, `pids_limit: 64`, `restart: unless-stopped`, json-file logging with `max-size: 10m`, `max-file: 3`.
- NO `ports:`, no Docker socket, no volume other than the config. No healthcheck (the image has no shell; state it in a comment).

## `player-otel.yml` (overlay, merged by the launcher only when enabled)

```yaml
services:
  player:
    environment:
      - GELDAR_TELEMETRY_URL=http://otel-agent:4318
      - GELDAR_PLAYER_ID=${GELDAR_ID:?}
    networks: [inside, otel]
networks:
  otel:
    external: true
    name: geldar-otel
```

The overlay touches only the `player` service (never `keeper`, never the proxies) and never carries the token or the host name.

## Steps

1. Read `image/compose/player.yml` (the `player` service, networks, the `${GELDAR_ID:?}` pattern) and `image/compose/session.test.yml` for the test-compose style.
2. Resolve and record the image digest as above; write both files.
3. Tests (`otel-compose.test.ts`, parse YAML as in TM-30):
   - (a) `otel-agent.yml`: no `ports`, no `volumes` other than the config bind, no `docker.sock`, `read_only: true`, `cap_drop` contains `ALL`, the image has `@sha256:` and no tag, caps present (`cpus`, `mem_limit`, `pids_limit`).
   - (b) the token appears only as the NAME `GELDAR_INGEST_TOKEN` in the agent's `environment`; no value; and the string `GELDAR_INGEST` appears nowhere in `player.yml`, `player-otel.yml`.
   - (c) the overlay defines only the `player` service and adds exactly the two environment names and the `otel` network.
   - (d) merging `player.yml` and `player-otel.yml` (a plain object merge in the test, not Docker) leaves `keeper` and both proxy services unchanged and `player` still has `cap_drop: [ALL]` and the existing environment names.
   - (e) the `otel` network is `external` in both files, never created by the player project.
4. The ops agent runs `docker compose -f image/compose/otel-agent.yml config` with dummy values, and the merged player config with `-f player.yml -f player-otel.yml`, and records both results (no live start).
5. Revert check: add `ports: ["4318:4318"]`; (a) must fail. Add `GELDAR_INGEST_TOKEN` to the overlay; (b) must fail.

## Checks and commit

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:repo`, `git diff --check`. Commit: `T-13 TM-31: otel-agent compose, shared internal network and opt-in player overlay (image)` plus the two trailers.

## Do NOT

- Do not edit `player.yml`.
- Do not publish a port, mount a socket, or give the agent a volume for telemetry data.
- Do not put the agent on a network with the `keeper` or on a player's `inside` network.
- Do not make the overlay part of the default launcher path (TM-32 and TM-33 gate it).
- Notes for the report: all players on `geldar-otel` can reach the agent's unauthenticated port 4318; a model has no network tool, so this is accepted, but say so. The agent cannot be reached from the internet.
