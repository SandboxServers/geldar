# Per-shard event storage design (NeoForge live shard and scratch)

- Status: design note, docs only. Base: origin/main 134bf7f0. First written 2026-11-17 for the lead; revised 2026-11-17 with the lead's decisions (below). Decisions are recorded in `docs/decisions/0380` to `0386`; the owner confirms them.
- Reading rule: **UNVERIFIED** marks a claim I did not confirm in code, config or on a server. Paths are relative to the repo root.
- Owner answer this design implements: "separate stream and table per shard". Plainly: each shard gets its own JetStream stream (on its own NATS) and its own database, which holds its own `events` table. The `events` table itself is unchanged. This is option C of section 2, and it meets the owner's answer by a database per shard rather than a table per shard in one database (decision 0026).

## 0. Decisions in force (lead-accepted 2026-11-17; owner to confirm)

| # | Decision | Record |
|---|---|---|
| D1 | Per-shard storage: a separate database per shard (`events` unchanged), a separate NATS per shard, one sink per shard. Stream names are per shard. | 0380 |
| D2 | Tokens: live NeoForge shard `nf`; scratch `nf-scratch`; the colo shard keeps `colo`. | 0380 |
| D3 | Amends 0041 for per-shard streams; 0041's text is not edited. | 0381 |
| D4 | Shard-mismatch policy: dead-letter, not ack-and-skip. The `validate.ts` gap is an implementation gap with a trigger-path packet. | 0382 |
| D5 | The NeoForge mod connects as a new `neoforge` NATS user (not `paper`). Colo output of `geldar.ps1` is unchanged. The maintenance notice publishes to the NeoForge shard's own NATS as its own deploy user, defined in the same per-shard auth set. | 0383 |
| D6 | `server_tps` has no payload schema (owner decision). The NeoForge mod emits the shape the Paper plugin sends today (section 6). | 0384 |
| D7 | Live retention 30 days and 2 GiB (accepted defaults; the owner can change them). The database has no purge today; the purge is an open assignment (section 8). | 0380 |
| D8 | The live NeoForge shard runs as a new compose project `geldar-nf` on the colo node, separate from `geldar-colo`, with its own file. Budget and headroom in section 7. | 0386 |
| D9 | Keep `golem/` out of the deploy window. | 0380 |
| D10 | Progression (per-shard flag, relaxes Principle 2 for flagged shards only) is recorded in 0385. Proposed; the owner must accept it; nothing is in force. | 0385 |

## 1. Current state

One stream, one subject filter, one table, one sink, one durable consumer.

| Item | Where | What it does today |
|---|---|---|
| Stream name, subjects, retention | `eventsink/src/config.ts` lines 14-20 (`STREAM_CONFIG`) | `GELDAR_EVENTS`, subjects `geldar.*.*`, file storage, `retentionDays` 30, `maxBytes` 2 GiB. Hard-wired constant. |
| Stream creation | `eventsink/src/consumer.ts` `ensureStream` (about lines 318-341) | Creates the stream from the constant if missing; on a create error it re-reads the stream. |
| Plugin creation | `plugin/core-common` `NatsEventPublisher.java` | Creates the same stream with the name hard-coded; "whichever starts first wins". The NeoForge mod reuses this publisher (`docs/analysis/neoforge/p3-adapter-design.md`). |
| Pin between sink, plugin and README | `eventsink/src/stream-config.test.ts` | Fails when the plugin source, `plugin/README.md` or `eventsink/README.md` stop matching the constant. |
| Durable consumer | `config.ts` line 23 `CONSUMER_NAME = 'eventsink'`; `consumer.ts` `ensureConsumer` | Filter is `STREAM_CONFIG.subjects[0]` (`geldar.*.*`). Explicit ack, `max_deliver` from `MAX_DELIVER`. Durable names are scoped to a stream. |
| Served-shard check | `eventsink/src/validate.ts` (lines 24-45) | Checks that the subject `geldar.<shard>.<type>` agrees with the event's own fields. **No served-shard check in the code I read.** Decision 0026 says the sink checks the field against the shard it serves. Implementation gap (record 0382). |
| Table | `sql/0001_init.sql` lines 107-112 | `events`: `event_id`, `source_event_id` TEXT UNIQUE, `at`, `world_day`, `world_tick`, `type`, `agent_id`, `thinker_id`, `payload` JSONB. **No `shard` column.** Later: `sql/0037_events_harness_model.sql`, `sql/0066_events_trace_id.sql`. |
| Insert | `eventsink/src/writer.ts` lines 34-41 | `INSERT INTO events ... ON CONFLICT (source_event_id) DO NOTHING`. The table name is literal. |
| Other writes by the sink | `eventsink/src/projection.ts`, `audit/store.ts`, `xp/pg-xp-store.ts`, `state/service.ts` | Projection tables and a state queue group. A second sink on a shared database would project everything twice. |
| Colo shard token | `compose/colo.yml` line 134 `GELDAR_SHARD: colo` | The token is `colo`. Subjects are `geldar.colo.*`. `shards/colo.yaml` holds no token key (it has `cpu_limit`, `memory_limit`, `minecraft_port`, `bind_address`). |
| Colo database name | `compose/colo.yml` line 44 `POSTGRES_DB: geldar`; `eventsink/src/config.ts` line 62 `env.POSTGRES_DB ?? 'geldar'` | The colo database is `geldar`. |
| Colo services | `compose/colo.yml` (project name `${GELDAR_PROJECT:-geldar-colo}`, line 8) | `postgres`, `nats`, `eventsink` and the rest; per-service CPU and memory budgets in section 7. |
| Scratch services | `deploy/scratch/scratch.sh` line 51 `PROJECT="scratch-$suffix"`; `deploy/scratch/nf.env` lines 8-9 (`SCRATCH_NATS_PORT=34222`, `SCRATCH_NATS_MON_PORT=38222`) | Each scratch stack is its own compose project with its own NATS and Postgres. Today's scratch suffix is `nf`, so its project is `scratch-nf`. |
| NATS users | `geldar.ps1` `Get-NatsUsers` (about lines 390-436) | One table keyed by shard name. Users: body, mind, eventsink, mcp, velocity, paper, kino, deploy, supervisor, register, helper. |
| Eventsink allow list | `geldar.ps1` about line 413 | Pub `geldar.<s>.dlq`, `geldar.<s>.state.>` and the JetStream API; Sub `geldar.<s>.state.*.proficiency` and the inbox. |
| Contract | `contract/src/subjects.ts` | Shard is a parameter in every subject helper; `maintenanceSubject` is `geldar.<shard>.maintenance`. No stream name and no shard list in `contract/`. |
| Log line pinned by CI | `eventsink/src/main.ts` line 159; `.github/workflows/ci.yml` line 357 | The sink logs `eventsink: consuming GELDAR_EVENTS`; CI greps that text. Keep it for the default. |
| Ambient shard variable | `eventsink/src/sink-plan.test.ts`, `main.test.ts` | `GELDAR_SHARD` alone is inert for the sink by design. |

Hard-wired to one shard today: the stream name (config and plugin), the subject filter `geldar.*.*`, the table name `events` (no shard in the row), the CI log string, and the scratch token `nf`.

## 2. Names and where the table lives

Naming (decided, D1 and D2):

- Colo (autonomous shard): unchanged. Token `colo`, stream `GELDAR_EVENTS`, subjects `geldar.*.*` on its own NATS, database `geldar`, table `events`. Nothing here edits it.
- Live NeoForge shard: token `nf`, stream `GELDAR_EVENTS_NF`, subjects `geldar.nf.*`, durable `eventsink`, database `geldar_nf` (a naming proposal; no code reads it yet), its own NATS, its own sink, project `geldar-nf`.
- Scratch: token `nf-scratch` (must match `^[a-z][a-z0-9-]{1,31}$`, the rule in `eventsink/src/xp/outbox.ts` line 47), stream `GELDAR_EVENTS_NF_SCRATCH`, subjects `geldar.nf-scratch.*`, database `geldar_nf_scratch`, project `scratch-nf-scratch` (from `scratch.sh` line 51).
- Stream name rule: upper-case the token, turn `-` into `_`, prefix `GELDAR_EVENTS_`; colo keeps `GELDAR_EVENTS`.
- Consumer name stays `eventsink` in each stream.

Options for the table (the 0026 model):

| Option | Verdict |
|---|---|
| A. `events_nf` table in the shared database | Reject. Writer, projections and foreign keys (`sql/0051`, `sql/0062`, `sql/0040`) hard-code `events`. |
| B. Schema `nf` in the shared database | Reject. Needs `search_path` in the writer and every grant; `sql/0003` and `sql/0005` create roles (re-run safety UNVERIFIED). |
| C. Own database per shard, own Postgres in the shard's compose project | **Chosen (D1).** `events` keeps its name; writer, projections and migrations are unchanged; roles live in their own cluster. |
| D. `shard` column on the existing `events` | Reject. Changes the autonomous table; 0026 says revisit only if one database serves two shards. |

Each shard's compose project holds one NATS, one Postgres, one sink. The NeoForge database runs `sql/` 0001 to 0066 from empty.

## 3. The sink: one instance per shard

Each shard has its own `eventsink` with its own NATS, database and memory cap. Reasons: isolation (a poison message in one stream cannot delay another); a restart after 20 failed fetches (`docs/decisions/0041-event-export-stream-and-sink.md`) restarts one shard only; projections need no change.

Config keys the per-shard sink needs (proposals; none exists today):

- `GELDAR_EVENTS_STREAM` (default `GELDAR_EVENTS`): used by `ensureStream`, `ensureConsumer` and the log line.
- `GELDAR_EVENTSINK_SHARD` (default unset, which keeps today's `geldar.*.*`): the filter becomes `geldar.<shard>.*`. Not `GELDAR_SHARD`, which the sink ignores on purpose.
- `EVENTSINK_STREAM_RETENTION_DAYS` (default 30) and `EVENTSINK_STREAM_MAX_BYTES` (default 2 GiB): optional; the defaults keep colo unchanged.
- `POSTGRES_DB` is already read (`config.ts` line 62); the NeoForge sink sets `geldar_nf`.

Shard mismatch: a message whose shard differs from the served shard is dead-lettered (D4, record 0382).

## 4. Changes by path

Trigger paths (`.github/workflows/colo-images.yml` `paths:`): `golem/**`, `eventsink/**`, `tools/admin/**`, `sql/**`, `contract/**` and the workflow file (the other entries are UNVERIFIED).

### (a) Packets that do NOT touch trigger paths

| # | Path | Change | Pinning test |
|---|---|---|---|
| a1 | this note; `docs/analysis/neoforge/RESUME.md`; `docs/analysis/neoforge/progression-defaults.md` | Pointers to 0380 to 0386 | `pnpm check:repo` |
| a2 | `geldar.ps1` `Get-NatsUsers`, `shard nats-auth` | Accept shard `nf` and `nf-scratch`. The colo table and the colo generated file are unchanged (D5). | the existing test that pins the colo generated file (UNVERIFIED which file) |
| a3 | `compose/nf.yml` (new, self-contained, not an overlay of `colo.yml`) | The `geldar-nf` project: NeoForge server, Velocity, NATS, Postgres, eventsink. Loopback ports only. Memory and CPU caps per service (section 7). | `geldar.ps1 check` runs `docker compose config` on every `compose/*.yml`, so the file is validated there; a cap test (new) that every service has a CPU and memory cap |
| a4 | `deploy/scratch/scratch.sh`, `deploy/scratch/nf.env` | Scratch token `nf-scratch`; stream and database names from env | `deploy/test` scratch tests (names UNVERIFIED) |
| a5 | `deploy/nf-cd.sh` (new, proposal) | Deploy script for `geldar-nf` only (section 7.3) | a dry-run test that the project is `geldar-nf` and the colo file is never named |
| a6 | `tools/repo-checks/src/` (new check) | No two stream subject filters overlap in one project; stream names unique | the new check on a fixture with an overlap |
| a7 | `docs/reference/eventsink.md`, `docs/reference/nats-subjects.md`, `docs/security/authn-authz-map.md`, `docs/runbooks/` | Names, per-shard users, operator steps | `pnpm check:repo` |

### (b) Packets that DO touch trigger paths (one window)

| # | Path | Change | Pinning test |
|---|---|---|---|
| b1 | `eventsink/src/config.ts` | Stream name, subjects and retention from settings; defaults equal today's values | `stream-config.test.ts`: defaults `GELDAR_EVENTS` and `geldar.*.*`; with `nf`, `GELDAR_EVENTS_NF` and `geldar.nf.*` |
| b2 | `eventsink/src/consumer.ts`, `eventsink/src/main.ts` | `ensureStream` and `ensureConsumer` take the name and filter; log text unchanged for the default | `consumer.start.test.ts`: create with the `nf` name and filter; error path: a failed create with no stream still rethrows; a stream created by the plugin is accepted |
| b3 | `eventsink/src/validate.ts`, `eventsink/src/main.ts` | Served-shard check; mismatch dead-lettered (record 0382) | a `geldar.colo.x` message to an `nf` sink is dead-lettered and no row is written; the abort and error paths (write failure, dead-letter publish failure) keep their current behaviour |
| b4 | `eventsink/src/stream-config.test.ts`, `eventsink/README.md`, `plugin/README.md` | The pin reads the new names | itself |
| b5 | `plugin/core-common` `NatsEventPublisher.java`; the NeoForge `ExportConfig.java` | Stream name and filter from config; default `GELDAR_EVENTS` | Java unit test with a fake JetStream: name and filter from config |
| b6 | `tools/admin/**` (and `tools/migrate` if baked into the image: UNVERIFIED) | `migrate` takes the database name, so the one-shot can run against `geldar_nf` | `tools/admin` test: the target is the named database |
| b7 | `sql/` | No change under option C | none |
| b8 | `contract/` | No change. No stream name, shard list or retention constant is in `contract/`. | none |
| b9 | `golem/**` | **Kept out of the window (D9).** The body reads its NATS URL and shard from its env. | none |

Batch: b1 to b6 in one window. The window is about 200 to 350 lines of trigger changes.

## 5. Migration steps

Colo node and NeoForge project:

1. Repo, now: this note and the records (docs only). No deploy.
2. Repo: the (a) packets. No restart: they touch no image of the colo project.
3. Repo, one window: the (b) batch. The colo-images workflow builds the eventsink image. `colo-cd` deploys the colo project only (section 7.3): the colo `eventsink` restarts on the new image with default config, reads `GELDAR_EVENTS` and `geldar.*.*`, writes `events`. Check: the stream exists; the durable `eventsink` is unchanged; the log line is unchanged. Rollback: the previous digest in the release env.
4. Operator: create the `geldar-nf` project from `compose/nf.yml` (`docker compose -p geldar-nf -f compose/nf.yml ...`, never with the colo file). Generate its NATS users with `shard nats-auth nf`.
5. Operator: run the migrations into `geldar_nf` through the admin one-shot (b6). Check that `events` exists and is empty.
6. Operator: start the NeoForge sink with `GELDAR_EVENTS_NF`. Check that the stream exists with subjects `geldar.nf.*` and that the colo stream's filter and message count are unchanged (read-only `/jsz?streams=true` on the monitor, as in `.claude/skills/run-shard/SKILL.md`).
7. Operator: start the NeoForge server. Read-only probes only: `tick query`, `list`; `server_tps` arrives every 20 s.
8. Operator: send a maintenance notice to the NeoForge NATS with its own deploy user (D5).

Scratch: the owner approves the token change (`nf` to `nf-scratch`); the old scratch stack (`scratch-nf`) keeps its volumes until removed; the operator stops it; `scratch.sh up` with `nf-scratch` creates `GELDAR_EVENTS_NF_SCRATCH` in its own NATS. Rollback: stop the new token; bring the old one back only if its image is still published.

Rollback for the NeoForge project: `docker compose -p geldar-nf ... stop`. Deleting its volumes, stream or database is destructive: owner approval first. Colo is unaffected.

## 6. Contract and `server_tps`

- Nothing in `contract/` must change. The subject helpers already take the shard as a parameter.
- **`server_tps` has no payload schema yet (D6, owner decision; not written here).** `contract/schemas/event.schema.json` names the type (line 5) and there is no payload schema file for it in `contract/schemas/`.
- Meanwhile the NeoForge mod emits the same shape the Paper plugin sends today. From `plugin/core/src/main/java/dev/geldar/core/EventExporter.java` lines 60-66 (`exportTps`, called every 20 s by the scheduler): `tps` (double, one-minute window), `players` (int), `dropped` (the publisher's drop count), `connected` (bool). The NeoForge emitter itself is UNVERIFIED (I did not read the NeoForge source for it).
- `contract/test/records.test.ts` sets `type = 'server_tps'` in a test; it is not a payload schema.

## 7. Placement, budget and deploy (D8)

### 7.1 Where it runs and what must not restart

The live NeoForge shard is a new compose project `geldar-nf` on the colo node, not a separate host. Its file `compose/nf.yml` is self-contained (not an overlay on `compose/colo.yml`). It has its own network (Compose names it from the project, `geldar-nf_*`), its own NATS, its own Postgres, its own sink. A compose action on `geldar-nf` must never touch the `geldar-colo` network or the node's `colo.yml`; every nf command names `-p geldar-nf -f compose/nf.yml`.

Must never restart the autonomous shard (colo), from the repo:

- `deploy/colo-cd.sh` line 7 (comment): "Never restarted: Paper, Velocity, Caddy, Postgres, NATS. Never started: mind, and golem-body (the idle Adam, profile adam)." The CD script's restarts are per service in its `ORDER` list (line 340).
- `deploy/colo-down.sh` line 2: "Stops the geldar-colo project and nothing else." Running it on the node stops colo.
- `deploy/common.sh` lines 6-8: `PROJECT=${GELDAR_PROJECT:-geldar-colo}` and `COMPOSE_FILE=${GELDAR_COLO_COMPOSE:-$ROOT/compose/colo.yml}`. Any colo script run with `GELDAR_PROJECT` set to `geldar-nf` would act on nf, so nf scripts must not source `common.sh` with that variable. Whether the `ghdeploy` runner sets `GELDAR_PROJECT` is UNVERIFIED (not in the repo).
- Golem bodies: restart only when `golem/**` is in the window (D9). `deploy/colo-cd-players.sh` was not read (UNVERIFIED).
- The shared Caddy: out of scope here (section 8).

### 7.2 Per-service caps

Colo (`compose/colo.yml`; the per-service budgets are the literal defaults). Summed from the file:

| Service | CPUs | Memory |
|---|---|---|
| postgres | 1 | 2048m |
| nats | 0.5 | 512m |
| paper | 3 | 8192m (heap `MEMORY: 6G`) |
| velocity | 0.5 | 1024m |
| eventsink | 0.5 | 512m |
| golem-body | 1 | 2048m |
| animus | 1 | 2048m |
| geldar-mcp | 0.5 | 512m |
| register (profile, off by default) | 0.25 | 128m |
| glass | 0.5 | 256m |
| bluemap-alias | 0.1 | 64m |
| bluemap-web | 0.25 | 64m |
| players-host (profile) | 1 | 2048m |
| admin (profile, one-shot) | 0.5 | 512m |
| **All services** | **10.6** | **19968m** (19.5 GiB) |
| Default-on (profiles excluded) | 8.85 | 17280m |

`shards/colo.yaml` `cpu_limit: 10.6` and `memory_limit: 19968m` match the all-services sum. Note `compose/colo.yml` sets Paper to 8192m; the lead's measured Paper cap of 14 GiB is not in the repo (see 7.4).

Proposed `geldar-nf` budget (proposals, to be measured at deploy):

| Service | CPUs | Memory | Port |
|---|---|---|---|
| NeoForge server (Paper-equivalent, heap 6G like colo) | 3 | 8192m | none published |
| Velocity (game entry) | 0.5 | 1024m | 127.0.0.1:25575 (proposal) |
| postgres | 1 | 2048m | none published |
| nats | 0.5 | 512m | none published |
| eventsink | 0.5 | 512m | none |
| **Total** | **5.5** | **12288m** (12 GiB) | one loopback port |

Ports: colo publishes 25567 on loopback (`shards/colo.yaml` `minecraft_port`); 25565 and 25566 are never published. The NeoForge block proposal is 25575 to 25579 on loopback. Scratch uses 24222 and 28222 (`deploy/scratch/telemetry.env`) and 34222 and 38222 (`deploy/scratch/nf.env`). Before deploy, check that no scratch game port lies in 25575 to 25579 (UNVERIFIED).

Other tenants (caps from the repo):

- Scratch telemetry (`compose/opt-in/scratch-telemetry.yml` lines 23-24 and 58-59): Paper 15360m, `SCRATCH_PAPER_CPUS` default 6; a second service 512m, 0.5 CPU.
- Scratch NeoForge (`compose/opt-in/scratch-neoforge.yml`): no `cpus` or `memory` line found by grep; UNVERIFIED.

Sums of caps if everything runs: CPUs colo 10.6 + nf 5.5 + scratch-telemetry 6.5 = **22.6 against 16 cores** (overcommitted; caps are ceilings, not reservations). Memory colo 19968m + nf 12288m + scratch-telemetry 15872m = **48128m (about 47 GiB)**, plus scratch NeoForge (UNVERIFIED) and plus about 6 GiB if Paper really runs at 14 GiB.

What it means for the other tenants: memory fits comfortably in the lead's 100 GiB available. CPU is the constraint: when several stacks peak at once, the autonomous Paper (3 CPUs) can be slowed by nf and scratch-telemetry. Mitigation (proposal): set lower Docker `cpu_shares` on the nf and scratch services so colo wins contention; caps alone do not protect colo. The scratch-telemetry stack (6 CPUs) is the largest single competitor and is a scratch tenant, so it should not run during the colo peak.

### 7.3 Deploy script

`colo-cd` (`deploy/colo-cd.sh`) and the `colo-deploy` workflow (`.github/workflows/colo-deploy.yml`, triggered by `colo-images` through `workflow_run`) deploy the colo project only, through `deploy/common.sh`. They do **not** apply to `geldar-nf`. The NeoForge project needs its own script, `deploy/nf-cd.sh` (proposal, section 4a5), that names `-p geldar-nf -f compose/nf.yml` and pins its own image digests in its file (so a colo-images build does not change nf until its digest is edited). Whether `colo-images` should build the NeoForge images is an owner call (not decided here).

### 7.4 Node headroom: measured by the lead, NOT measured by me

The headroom figures below are the lead's ops measurement at about 13:55Z on 2026-11-17: about 100 GiB available memory, 16 cores, and the autonomous Paper at a 14 GiB cap. I did not measure them. They are from another session and must be re-measured at deploy time. The 14 GiB Paper cap does not match `compose/colo.yml` (8192m); the difference is UNVERIFIED (possibly an override by the operator).

Read-only commands for the operator, on the colo node, each with the UTC time first:

```sh
date -u +%Y-%m-%dT%H:%M:%SZ
docker stats --no-stream
free -m
grep -E 'MemTotal|MemAvailable' /proc/meminfo
nproc
docker info --format 'cpus={{.NCPU}} memtotal={{.MemTotal}} root={{.DockerRootDir}}'
df -h "$(docker info --format '{{.DockerRootDir}}')"
docker inspect -f '{{.Name}} nano={{.HostConfig.NanoCpus}} mem={{.HostConfig.Memory}}' $(docker ps -q)
```

Record the output (no IPs, no hostnames, no secrets) in a dated note under `docs/analysis/neoforge/` with the UTC time, and compare with section 7.2 before the first `geldar-nf` start. If available memory after the nf start is under 20 GiB, stop and tell the owner.

## 8. Risks and open items

Risks:

- R1 Subject overlap. A shared NATS would put `geldar.nf.*` under the colo filter `geldar.*.*`. Removed by D1: each shard has its own NATS.
- R2 Projections. A shared database would project NeoForge events into colo's tables. Removed by option C.
- R3 Served-shard check missing (`validate.ts`). Record 0382; packet b3.
- R4 CI greps `consuming GELDAR_EVENTS` (`ci.yml` line 357). Keep the default text.
- R5 The stream pin spans `eventsink/` and `plugin/`. Change both in one window (b4, b5).
- R6 The plugin's "whichever starts first wins" creates the stream with its own name. On a separate NATS this is harmless; b5 makes the name configurable.
- R7 Retention: the stream keeps 30 days; the database keeps rows indefinitely (no purge code found; UNVERIFIED against `docs/security/privacy-and-data-retention.md`).
- R8 Budget and CPU contention: section 7.2.
- R9 The scratch token rename changes subjects probes use: `docs/analysis/neoforge/p3-adapter-design.md` (about line 145) and the P0 probe subscribe to `geldar.<nf shard>.death`; they must follow the new token.
- R10 Readers of `events` (`sql/0005_glass_reader.sql`, `sql/0062`, `sql/0040`, and tools `adam-report`, `adam-run`, `glass-ctl`, grep only, UNVERIFIED). Each reader sees its own database only.

Open items (after the lead's decisions):

- **O1 Retention change (owner).** 30 days and 2 GiB are accepted defaults. The owner may change them; no record is needed for a number change.
- **O2 Purge owner (open assignment).** The database has no purge today. Proposal: the per-shard sink owner (the operator of each shard) runs a documented, idempotent purge job that deletes `events` rows older than the retention the owner sets, in batches, and logs the count. Owner of the assignment: the lead's operations (open; not yet assigned to a person).
- **O3 Public exposure, the shared Caddy and the human route:** out of scope here, owner decisions for the final-instance step. The shared Caddy is not touched by this design.
- **O4 Glass for NeoForge:** a NeoForge Glass needs its own connection to `geldar_nf` (open; not in this batch).
- **O5 Whether `colo-images` builds the NeoForge images:** owner call (section 7.3).

Where the live NeoForge shard runs is decided (D8, record 0386), not open.
