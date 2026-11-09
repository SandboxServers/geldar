---
name: run-shard
description: Bring a Geldar shard's Docker Compose stack up (Paper, Postgres with pgvector, NATS JetStream and the Geldar services), check that every part is healthy, read its logs, and take it down. Use when asked to "start the shard", "bring the stack up", "is the shard healthy", "restart Paper", or before any live test, benchmark or Adam run.
---

# Run a shard

Phase 0 runs everything on this one PC (`docs/decisions/0002-phase0-host-and-models.md`); Ollama runs on the host, not in compose, so it can use the GPU. The connection path matches production (`docs/decisions/0021-velocity-from-phase0.md`): bots join through the Velocity bot ingress on `127.0.0.1:25565`, Paper accepts only forwarded connections, and secrets are files in `compose/secrets/` that `shard up` generates when missing.

## Start

Build both plugin jars first; compose bind-mounts them and does not run the build:

```powershell
cd plugin; ./gradlew build; cd ..   # writes core/build/libs/geldar-core.jar and velocity-identity/build/libs/geldar-velocity-identity.jar
./geldar.ps1 shard up phase0       # docker compose up -d --wait: returns when every healthcheck passes
./geldar.ps1 shard status phase0
```

`shard up` stops before starting when either jar is not a file (Docker would create a directory at that path and the server would boot without the plugin; delete that directory and build). After `--wait` it also reads the Paper and Velocity logs and fails unless they hold `Geldar-Core enabled` and `Geldar identity enabled`, because a healthy container alone does not prove the plugin loaded (the Velocity gate would admit anyone). The Paper and Velocity healthchecks check the same lines.

`--wait` fails if a container is unhealthy after its start period. Paper's first start generates the world and can take minutes; don't treat a slow start as a failure until its healthcheck's start period has passed. The `eventsink` service has no healthcheck: `shard status` shows it running, and the events rows below show it works.

## Health: what "healthy" means

Every row must pass before a benchmark or an Adam run. Report each one, not just "it's up". The `dc` commands below assume, in the repo root:

```powershell
function dc { docker compose -f compose/phase0.yml -p geldar-phase0 @args }
```

| Part | Check | Healthy when |
|---|---|---|
| Postgres 16 | `dc exec postgres pg_isready -h 127.0.0.1 -U geldar -d geldar` | exits 0 (TCP, so it fails until init scripts have run) |
| pgvector | `dc exec postgres psql -U geldar -d geldar -tAc "select extversion from pg_extension where extname='vector'"` | prints a version |
| Migrations | `dc exec postgres psql -U geldar -d geldar -tAc "select count(*) from information_schema.tables where table_schema='public'"` | the table count from `sql/` |
| NATS JetStream | `curl -fsS http://localhost:8222/healthz?js-enabled-only=true` | `{"status":"ok"}` |
| Paper | compose healthcheck (the image's `mc-health` and the `Geldar-Core enabled` log line) | `healthy` in `shard status` |
| Paper is behind the proxy | `dc port paper 25565`, run only while paper is running (`docker inspect -f '{{.State.Running}}' geldar-phase0-paper-1` prints `true`) | fails with `no port 25565/tcp` (exit 1): Paper has no published game port. A stopped paper also fails this command, so the check is meaningless unless the inspect line shows `true` first |
| Velocity bot ingress | compose healthcheck (the `Geldar identity enabled` log line and the port), and `Test-NetConnection 127.0.0.1 -Port 25565` | `healthy`, and the port answers |
| RCON (test control) | `Test-NetConnection 127.0.0.1 -Port 25575` (published at `127.0.0.1:25575` by the `paper` service's `ports` in `compose/phase0.yml`) | the port answers; Paper enforces the whitelist, so any bot that joins (Golem whitelists its own over RCON) must be whitelisted first. Check this row before `test:live` |
| Geldar-Core plugin loaded | `docker logs geldar-phase0-paper-1 2>&1 \| Select-String "Geldar-Core enabled"` | prints the line `Geldar-Core enabled for shard phase0` (the jar is built first: `cd plugin; ./gradlew build`) |
| Identity plugin loaded, unregistered name denied | `docker logs geldar-phase0-velocity-1 2>&1 \| Select-String "Geldar identity enabled\|Watching the life registry\|Denied"` | prints `Geldar identity enabled` and `Watching the life registry` (the jar is built first: `cd plugin; ./gradlew build`; until Golem creates the `geldar-life-registry` bucket the plugin logs "Life registry unavailable" and denies everyone); a login with an unregistered username is refused at the proxy and logs `Denied <name>` |
| Events flowing | `curl -fsS "http://localhost:8222/jsz?streams=true"` | stream `GELDAR_EVENTS` exists (under `account_details[].stream_detail[]`) and its `state.messages` count grows (a `server_tps` event arrives every 20 s) |
| Events reach Postgres (eventsink) | `dc exec postgres psql -U geldar -d geldar -tAc "select type, count(*) from events group by type"` | has a `server_tps` row whose count grows (one per 20 s); `dc logs --tail 50 eventsink` shows no repeated errors or dead letters (the sink writes failed events to the `geldar.<shard>.dlq` subject) |
| Ollama (host) | `curl -fsS http://localhost:11434/api/tags` | lists the models in `shards/phase0.yaml` |

Ports, users and database names come from `compose/phase0.yml` and its `.env.example`; if they differ from the table, the compose file wins. Update this table in the same PR.

## Logs and restarts

```powershell
./geldar.ps1 shard logs phase0 paper
docker compose -f compose/phase0.yml -p geldar-phase0 restart paper
```

Never fix a problem by acting inside the world (teleporting a bot, giving items, running a command as an agent). Fix the infrastructure (spec Principle 1 and section 11). The carve-out: RCON test control is for test fixtures and ops tooling only (decision 0029, spec 5.1), never a fix for a running Adam.

## Golem connection settings

Golem reads these from the environment (`golem/src/config.ts`): `GELDAR_MC_HOST` (must be `127.0.0.1` or `localhost`), `GELDAR_MC_PORT` (default 25565), `GELDAR_RCON_PORT` (default 25575) and `GELDAR_RCON_PASSWORD_FILE` (default `compose/secrets/rcon.txt` under the repo root). Secrets live in the starting worktree's `compose/secrets/`: if another checkout started the stack, point `GELDAR_RCON_PASSWORD_FILE` at that checkout's file.

The Phase 0 stack now runs the Velocity identity gate: a bot is admitted only if Golem registered its username in NATS first. The bench CLI and the live lane default `GELDAR_NATS_URL` to `nats://127.0.0.1:4222` when it is unset; any other Golem run needs it set, or the gate denies the bot and Golem stops with a message naming `GELDAR_NATS_URL`. See `golem/README.md`.

## Secrets and volumes

Build the plugin jars (`cd plugin; ./gradlew build`) before `shard up`; the shard-up check refuses to start without them. When you copy `compose/secrets/` between worktrees, copy all of it or none: a mix gives a password mismatch. A password mismatch means the volume was initialised with another secret (a Postgres volume keeps the first password), so use the secrets that created the volume. `GELDAR_NATS_URL` defaults to the loopback NATS (`nats://127.0.0.1:4222`) for the bench CLI and the live lane.

## Stop

```powershell
./geldar.ps1 shard down phase0     # keeps volumes: the world and the database survive
```

Deleting volumes destroys the world and the record. Deleting `compose/secrets/` makes the next `shard up` generate new secrets, which an existing Postgres volume won't accept (a Postgres password failure on an old volume means it was initialised with another secret). When you move between worktrees, copy every file in `compose/secrets/` or none: `shard secrets` never overwrites, but a partial copy pairs new secrets with old volumes. Ask the owner before `docker compose down -v` or removing a volume.
