---
title: Bring up the Phase 0 shard
type: how-to
audience: operators
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, scratch-stack.md, signcheck-shard.md, backup-and-restore.md, rotate-secrets-by-role.md, ../reference/compose-stacks.md, ../reference/cli-tools.md, ../reference/skills-and-agents.md, ../architecture/system-overview.md]
sources: [.claude/skills/run-shard/SKILL.md, compose/phase0.yml, compose/rcon-host.yml, compose/.env.example, compose/paper/paper-entrypoint.sh, compose/velocity/velocity.toml, geldar.ps1, golem/src/config.ts, sql/README.md, plugin/core/src/main/java/dev/geldar/core/GeldarCore.java, plugin/velocity-identity/src/main/java/dev/geldar/identity/IdentityPlugin.java, plugin/velocity-identity/src/main/java/dev/geldar/identity/RegistryClient.java, CLAUDE.md, .github/workflows/ci.yml, ../decisions/0002-phase0-host-and-models.md, ../decisions/0003-task-runner.md, ../decisions/0021-velocity-from-phase0.md, ../decisions/0029-rcon-reply-framing.md, ../decisions/0056-first-migration-runner-and-least-privilege-grants.md]
---

# Bring up the Phase 0 shard

Start the local Phase 0 stack (Postgres with pgvector, NATS JetStream, Paper, the Velocity bot ingress and the eventsink), prove every part is healthy, and take it down again.

This is the operator copy of the `run-shard` skill ([`.claude/skills/run-shard/SKILL.md`](../../.claude/skills/run-shard/SKILL.md)). The skill stays the source of truth for agents running the procedure; when the two differ, the skill and `compose/phase0.yml` win, and this page is stale.

**Owner:** the operator running the local Phase 0 stack (a contributor, or the `ops` agent). Phase 0 runs on one PC ([decision 0002](../decisions/0002-phase0-host-and-models.md)). This page does not cover the Colo node: see [colo-deploy](colo-deploy.md).

**Tested?** No. Every command below exists in the repo at `03c1f5de` (checked 2026-11-16), but none was run for this page: the documentation freeze forbids starting the stack. Treat each step as unverified until someone runs it and records the result.

## Before you start

- PowerShell 7, Docker with Compose v2, and the workspace set up (`./geldar.ps1 setup`). Run every command from the repo root.
- Nothing else holds the shard's host ports. `compose/phase0.yml` publishes `127.0.0.1:5432` (Postgres, line 27), `127.0.0.1:4222` and `127.0.0.1:8222` (NATS, lines 44 to 45) and `127.0.0.1:25565` (Velocity, line 121). With `--rcon-host`, `compose/rcon-host.yml` adds `127.0.0.1:25575`.
- **Do not run `adam up` (or `adam up --help`) before live cases.** `adam up` holds port 7410, the Thinker socket; the live cases start their own Mind and Body and fail to bind if the port is held ([CLAUDE.md](../../CLAUDE.md), "Live runs start their own stack"). The live cases are 8B-only. The 32B run is manual: `adam up --model strong` once, with no live cases alongside it.
- `bench` and `test:live` change the shard (tick rate, whitelist, world). Run them one at a time, never alongside each other ([CLAUDE.md](../../CLAUDE.md), Commands).

## Steps

1. **Build both plugin jars.** Compose bind-mounts them and does not build them.

   ```powershell
   cd plugin; ./gradlew build; cd ..
   ```

   This writes `plugin/core/build/libs/geldar-core.jar` and `plugin/velocity-identity/build/libs/geldar-velocity-identity.jar`, the two paths `compose/phase0.yml` mounts (lines 91 and 118).

2. **Start the shard.**

   ```powershell
   ./geldar.ps1 shard up phase0
   ```

   Add `--rcon-host` when a host tool needs RCON: the body benchmark, the live lane, `players`, and the removal step of `adam`, `mcp-tokens` and `players-cli` (`geldar.ps1` line 456; `compose/rcon-host.yml` lines 1 to 5). Without it, RCON is not published to the host.

   ```powershell
   ./geldar.ps1 shard up phase0 --rcon-host
   ```

   What `shard up` does, in order (the `up` branch of `Invoke-Shard`, which starts at `geldar.ps1` line 429; the branch is lines 445 to 457):

   - refuses to start if either jar is missing or is a directory (`Assert-PluginJar`, lines 195 to 207);
   - creates any missing secret file and never overwrites one (`Initialize-ShardSecrets`, lines 252 to 298): the Postgres superuser password, the RCON password and the Velocity forwarding secret, in the repo's git-ignored dev secrets folder;
   - runs `docker compose build`, so the eventsink image is rebuilt from the layer cache (a no-op when nothing changed);
   - runs `docker compose up -d --wait`, which returns when every healthcheck passes;
   - reads the Paper and Velocity logs and fails unless they hold `Geldar-Core enabled` and `Geldar identity enabled` (`Assert-PluginsEnabled`, lines 211 to 221).

   Paper's first start generates the world and can take minutes. Its healthcheck has a 10-minute start period (`compose/phase0.yml` lines 8 to 12). Do not treat a slow first start as a failure before then.

3. **Show container health.**

   ```powershell
   ./geldar.ps1 shard status phase0
   ```

   `postgres`, `nats`, `paper` and `velocity` must show `healthy`. `eventsink` has no healthcheck (`compose/phase0.yml` lines 138 to 154), so it shows only as running; step 4 proves it works.

4. **Walk the health rows.** Define the helper once per shell:

   ```powershell
   function dc { docker compose -f compose/phase0.yml -p geldar-phase0 @args }
   ```

   Report every row, not just "it's up".

   | Part | Command | Healthy when |
   |---|---|---|
   | Postgres | `dc exec postgres pg_isready -h 127.0.0.1 -U geldar -d geldar` | exits 0 |
   | pgvector | `dc exec postgres psql -U geldar -d geldar -tAc "select extversion from pg_extension where extname='vector'"` | prints a version |
   | Migrations | `dc exec postgres psql -U geldar -d geldar -tAc "select max(version) from schema_migrations"` | prints the highest `NNNN` under `sql/` (`0065` at `03c1f5de`, from `git ls-files sql`) |
   | NATS JetStream | `curl -fsS "http://localhost:8222/healthz?js-enabled-only=true"` | `{"status":"ok"}` |
   | Paper behind the proxy | `docker inspect -f '{{.State.Running}}' geldar-phase0-paper-1`, then `dc port paper 25565` | the first prints `true`; the second fails with `no port 25565/tcp`. Paper publishes no game port (`compose/phase0.yml` lines 92 to 93) |
   | Velocity bot ingress | `Test-NetConnection 127.0.0.1 -Port 25565` | the port answers |
   | RCON (only with `--rcon-host`) | `Test-NetConnection 127.0.0.1 -Port 25575` | the port answers |
   | Geldar-Core loaded | `docker logs geldar-phase0-paper-1 2>&1 \| Select-String "Geldar-Core enabled"` | prints `Geldar-Core enabled for shard phase0` |
   | Identity plugin loaded | `docker logs geldar-phase0-velocity-1 2>&1 \| Select-String "Geldar identity enabled\|Watching bucket\|Bucket .* is absent"` | prints `Geldar identity enabled` (`IdentityPlugin.java` line 102) and `Watching bucket geldar-life-registry` (`RegistryClient.java` line 219). Until Golem creates that bucket the plugin logs `Bucket geldar-life-registry is absent, retrying in <N> ms` (line 96) and denies everyone; a refused login logs `Denied <name>` |
   | Events flowing | `curl -fsS "http://localhost:8222/jsz?streams=true"` | stream `GELDAR_EVENTS` exists and its `state.messages` count grows (a `server_tps` event every 20 s) |
   | Events reach Postgres | `dc exec postgres psql -U geldar -d geldar -tAc "select type, count(*) from events group by type"` | a `server_tps` row whose count grows; `dc logs --tail 50 eventsink` shows no repeated errors |

   The rows come from the skill's health table. The migrations row is this page's own: the skill compares a table count, and `sql/README.md` lines 15 to 17 say every migration records its version in `schema_migrations`, which is easier to compare. The skill also lists body-record and Ollama rows; they matter only after a Body has run or before an Adam run.

5. **If the database volume is older than the newest migration**, apply the pending ones. Postgres runs `sql/` only on a fresh volume (`compose/phase0.yml` lines 24 to 25; `sql/README.md` line 6).

   ```powershell
   ./geldar.ps1 db migrate --dry-run
   ./geldar.ps1 db migrate
   ```

   `db migrate` connects to `127.0.0.1:5432` as `geldar` with the shard's Postgres password and never prints it (`Invoke-PgNode`, `geldar.ps1` lines 505 to 522). Re-run the migrations row of step 4. [Decision 0056](../decisions/0056-first-migration-runner-and-least-privilege-grants.md) says to take a backup first; the repo has no tool for that on the local stack ([backup and restore](backup-and-restore.md), conflict 6), so a migration on a volume you care about is the owner's call.

## Verify

The shard is ready when step 3 shows four `healthy` services and a running eventsink, and every row in step 4 passes. Golem connects through `127.0.0.1:25565` and reads `GELDAR_MC_HOST`, `GELDAR_MC_PORT`, `GELDAR_RCON_PORT` and `GELDAR_RCON_PASSWORD_FILE` (`golem/src/config.ts`). The bench CLI and the live lane default `GELDAR_NATS_URL` to `nats://127.0.0.1:4222`; any other Golem run needs it set, or the identity gate denies the bot.

## Stop and roll back

```powershell
./geldar.ps1 shard down phase0
```

This stops the shard and keeps every volume: the world, the database and the NATS state survive (`geldar.ps1` line 458 runs `docker compose down` with no `-v`).

- **Never** run `docker compose down -v` or remove a volume without the owner's word. A volume holds the world and the record, and nothing backs it up ([backup and restore](backup-and-restore.md)).
- **Never** fix a problem by acting in the world (teleporting a bot, giving items, running a command as an agent). Fix the infrastructure (spec Principle 1 and section 11). RCON test control is for test fixtures and ops tooling only ([decision 0029](../decisions/0029-rcon-reply-framing.md); the skill's "Logs and restarts").

## When a step fails

| Symptom | Cause | Fix |
|---|---|---|
| `... is not a file: it is a directory` | An earlier start without the jar made Docker create a directory at the mount path (`geldar.ps1` lines 202 to 205) | Delete that directory, run step 1, then step 2 |
| `paper did not log 'Geldar-Core enabled'` (or the Velocity line) | The plugin did not load; a healthy container alone does not prove it | `./geldar.ps1 shard logs phase0 paper` (or `velocity`), fix the cause, rebuild the jar |
| Postgres password authentication fails | The volume was initialised with another secret; a Postgres volume keeps its first password | Use the secret files that created the volume. When you copy the dev secrets folder between worktrees, copy all of it or none (the skill's "Secrets and volumes") |
| `paper-entrypoint: ... is empty` or `holds characters outside [A-Za-z0-9_-]` | The Velocity forwarding secret file is empty or malformed (`compose/paper/paper-entrypoint.sh` lines 12 to 22) | The script names the fix: `./geldar.ps1 shard secrets phase0`, which creates only a missing file. An empty file must be deleted first (`geldar.ps1` line 267) |
| `--wait` reports Paper unhealthy within minutes of a first start | World generation is still running | Wait out the 10-minute start period, then check `shard status` again |
| A host tool cannot reach RCON | The shard was started without `--rcon-host` | Run step 2 again with `--rcon-host`. That Compose then recreates `paper` with the extra port is inferred from Compose behaviour, not tested here |
| A live case cannot bind port 7410 | `adam up` is running | `./geldar.ps1 adam status`, then `./geldar.ps1 adam down` |
| A Golem bot is denied at the proxy | Its username is not in the life registry, or `GELDAR_NATS_URL` is unset for a run that is not the bench or the live lane | Set `GELDAR_NATS_URL`; see `golem/README.md` |

Restart one service without touching the others:

```powershell
./geldar.ps1 shard logs phase0 paper
docker compose -f compose/phase0.yml -p geldar-phase0 restart paper
```

## Notes and conflicts

1. `compose/.env.example` line 1 says "CI and `shard up` use a copy named compose/.env". CI does copy it (`.github/workflows/ci.yml` lines 89 to 91); `geldar.ps1` at `03c1f5de` contains no `.env` copy step. With no `compose/.env`, `PAPER_MEMORY` falls back to `6G` (`compose/phase0.yml` line 63), the same value, so nothing breaks. Flagged for a fix to the comment or the script.
2. The container names `geldar-phase0-paper-1` and `geldar-phase0-velocity-1` come from Compose's default naming for project `geldar-phase0`; the skill uses them. They are not set in `compose/phase0.yml`.
3. **Velocity log lines.** The `run-shard` skill's health table expects `Watching the life registry` and, before the bucket exists, `Life registry unavailable`. Neither string is in `plugin/velocity-identity/src/main` at `03c1f5de` (`git grep`, 2026-11-16). The plugin logs `Watching bucket <bucket>` and `Bucket <bucket> is absent, retrying in <N> ms` (`plugin/velocity-identity/src/main/java/dev/geldar/identity/RegistryClient.java` lines 96 and 219). Step 4 uses the code's strings. The skill needs the same fix.
4. The spec's runbook says `make shard SHARD=baseline up` (spec section 11). In this repo that is `./geldar.ps1 shard up <name>` (`geldar.ps1` lines 7 to 8; [decision 0003](../decisions/0003-task-runner.md)).

## Related

- The wave test procedure (shard up, live lane, eventsink integration tests, benchmark) is in the `run-shard` skill; the benchmark is the `body-bench` skill ([skills and agents](../reference/skills-and-agents.md)).
- A throwaway stack beside this one: [scratch-stack](scratch-stack.md).
- Every compose file and overlay: [compose stacks](../reference/compose-stacks.md). Every `geldar.ps1` verb: [CLI tools](../reference/cli-tools.md).
- Secrets this stack creates, by role: [rotate secrets by role](rotate-secrets-by-role.md).
- What happens to the data in these volumes: [backup and restore](backup-and-restore.md).
