---
name: run-shard
description: Bring a Geldar shard's Docker Compose stack up (Paper, Postgres with pgvector, NATS JetStream and the Geldar services), check that every part is healthy, read its logs, and take it down. Use when asked to "start the shard", "bring the stack up", "is the shard healthy", "restart Paper", or before any live test, benchmark or Adam run.
---

# Run a shard

Usable once packet P0-06 has added `compose/phase0.yml`; until then `./geldar.ps1 shard up` says the file does not exist. Phase 0 runs everything on this one PC (`docs/decisions/0002-phase0-host-and-models.md`); Ollama runs on the host, not in compose, so it can use the GPU. The connection path matches production (`docs/decisions/0021-velocity-from-phase0.md`): bots join through the Velocity bot ingress on `127.0.0.1:25565`, Paper accepts only forwarded connections, and secrets are files in `compose/secrets/` that `shard up` generates when missing.

## Start

```powershell
./geldar.ps1 shard up phase0       # docker compose up -d --wait: returns when every healthcheck passes
./geldar.ps1 shard status phase0
```

`--wait` fails if a container is unhealthy after its start period. Paper's first start generates the world and can take minutes; don't treat a slow start as a failure until its healthcheck's start period has passed.

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
| Paper | compose healthcheck (the image's `mc-health`) | `healthy` in `shard status` |
| Paper is behind the proxy | `dc port paper 25565` | fails with `no port 25565/tcp` (exit 1): Paper has no published game port |
| Velocity bot ingress | compose healthcheck, and `Test-NetConnection 127.0.0.1 -Port 25565` | `healthy`, and the port answers |
| Ollama (host) | `curl -fsS http://localhost:11434/api/tags` | lists the models in `shards/phase0.yaml` |

Ports, users and database names come from `compose/phase0.yml` and its `.env.example`; if they differ from the table, the compose file wins. Update this table in the same PR.

## Logs and restarts

```powershell
./geldar.ps1 shard logs phase0 paper
docker compose -f compose/phase0.yml -p geldar-phase0 restart paper
```

Never fix a problem by acting inside the world (teleporting a bot, giving items, running a command as an agent). Fix the infrastructure (spec Principle 1 and section 11).

## Stop

```powershell
./geldar.ps1 shard down phase0     # keeps volumes: the world and the database survive
```

Deleting volumes destroys the world and the record. Deleting `compose/secrets/` makes the next `shard up` generate new secrets, which an existing Postgres volume won't accept. Ask the owner before `docker compose down -v` or removing a volume.
