# Per-shard event storage design (NeoForge live shard and scratch)

- Status: design note, docs only. Base: origin/main 134bf7f0. First written 2026-11-17 for the lead; revised 2026-11-17 with the lead's decisions (below), then reconciled with the live project file (branch `phase1/nf-live-compose`, commit e353646c) and the lead's read-only node check (about 16:07Z 2026-11-17). Its capacity figures were replaced by the lead's read-only check at 17:50Z 2026-11-17 (sections 7.2 and 7.4). Decisions are recorded in `docs/decisions/0380` to `0386`; the owner confirms them.
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
| D7 | Live retention 30 days and 2 GiB (accepted defaults; the owner can change them). The database has no purge today. The purge is an open assignment, an ops job with a runbook step and not automatic (section 8, O2). | 0380 |
| D8 | The live NeoForge shard runs as a new compose project `geldar-nf` on the colo node, separate from `geldar-colo`, with its own file `compose/nf-live.yml`. Budget and headroom in section 7. | 0386 |
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

Each shard's compose project holds one NATS, one Postgres, one sink. The NeoForge database runs `sql/` 0001 to 0066 from empty (UNVERIFIED until run; section 8).

## 3. The sink: one instance per shard

Each shard has its own `eventsink` with its own NATS, database and memory cap. Reasons: isolation (a poison message in one stream cannot delay another); a restart after 20 failed fetches (`docs/decisions/0041-event-export-stream-and-sink.md`) restarts one shard only; projections need no change.

Config keys the per-shard sink needs (proposals; none exists today):

- `GELDAR_EVENTS_STREAM` (default `GELDAR_EVENTS`): used by `ensureStream`, `ensureConsumer` and the log line.
- `GELDAR_EVENTSINK_SHARD` (default unset, which keeps today's `geldar.*.*`): the filter becomes `geldar.<shard>.*`. Not `GELDAR_SHARD`, which the sink ignores on purpose.
- `EVENTSINK_STREAM_RETENTION_DAYS` (default 30) and `EVENTSINK_STREAM_MAX_BYTES` (default 2 GiB): optional; the defaults keep colo unchanged.
- `POSTGRES_DB` is already read (`config.ts` line 62); the NeoForge sink sets `geldar_nf`.

The live project file (section 7.1) uses only keys that exist today. The per-shard keys above are a later trigger-path packet (b1, b2), so the NeoForge sink is not yet able to use its own stream.

Shard mismatch: a message whose shard differs from the served shard is dead-lettered (D4, record 0382).

## 4. Changes by path

Trigger paths (`.github/workflows/colo-images.yml` `paths:`): `golem/**`, `eventsink/**`, `tools/admin/**`, `sql/**`, `contract/**` and the workflow file (the other entries are UNVERIFIED).

### (a) Packets that do NOT touch trigger paths

| # | Path | Change | Pinning test |
|---|---|---|---|
| a1 | this note; `docs/analysis/neoforge/RESUME.md`; `docs/analysis/neoforge/progression-defaults.md` | Pointers to 0380 to 0386 | `pnpm check:repo` |
| a2 | `geldar.ps1` `Get-NatsUsers`, `shard nats-auth` | Accept shard `nf` and `nf-scratch`. The colo table and the colo generated file are unchanged (D5). | the existing test that pins the colo generated file (UNVERIFIED which file) |
| a3 | `compose/nf-live.yml` (new, self-contained, not an overlay of `colo.yml`; on branch `phase1/nf-live-compose`, commit e353646c) | The `geldar-nf` project: NeoForge server, Velocity, NATS, Postgres, eventsink, identity-seed (one-shot). Loopback ports only. Memory and CPU caps per service (section 7). | `tools/repo-checks/src/nf-live-compose.test.ts` (16 tests, renders with no env and with dummy secrets); `geldar.ps1 check` runs `docker compose config` on every `compose/*.yml` |
| a4 | `deploy/scratch/scratch.sh`, `deploy/scratch/nf.env` | Scratch token `nf-scratch`; stream and database names from env | `deploy/test` scratch tests (names UNVERIFIED) |
| a5 | `deploy/nf-cd.sh` (new, proposal) | Deploy script for `geldar-nf` only (section 7.3). Every compose action passes `-p geldar-nf -f compose/nf-live.yml`. | a dry-run test that the project is `geldar-nf` and the colo file is never named |
| a6 | `tools/repo-checks/src/` (new check) | No two stream subject filters overlap in one project; stream names unique | the new check on a fixture with an overlap |
| a7 | `docs/reference/eventsink.md`, `docs/reference/nats-subjects.md`, `docs/security/authn-authz-map.md`, `docs/runbooks/` | Names, per-shard users, operator steps. The live project runbook is `docs/runbooks/nf-live-project.md` (branch `phase1/nf-live-compose`). | `pnpm check:repo` |

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
4. Operator: create the `geldar-nf` project from `compose/nf-live.yml` (`docker compose -p geldar-nf -f compose/nf-live.yml ...`, never with the colo file). Provide the offline NeoForge bundle and the mod jar (section 7.1). Generate its NATS users with `shard nats-auth nf` (the per-shard auth set and its generator are a later packet; UNVERIFIED).
5. Operator: run the migrations into `geldar_nf` through the admin one-shot (b6). Check that `events` exists and is empty.
6. Operator: start the NeoForge sink with `GELDAR_EVENTS_NF` (needs b1 and b2). Check that the stream exists with subjects `geldar.nf.*` and that the colo stream's filter and message count are unchanged (read-only `/jsz?streams=true` on the monitor, as in `.claude/skills/run-shard/SKILL.md`).
7. Operator: start the NeoForge server. Read-only probes only: `tick query`, `list`; `server_tps` arrives every 20 s.
8. Operator: send a maintenance notice to the NeoForge NATS with its own deploy user (D5).

Scratch: the owner approves the token change (`nf` to `nf-scratch`); the old scratch stack (`scratch-nf`) keeps its volumes until removed; the operator stops it; `scratch.sh up` with `nf-scratch` creates `GELDAR_EVENTS_NF_SCRATCH` in its own NATS. Rollback: stop the new token; bring the old one back only if its image is still published.

Rollback for the NeoForge project: `docker compose -p geldar-nf -f compose/nf-live.yml ... stop`. Deleting its volumes, stream or database is destructive: owner approval first. Colo is unaffected.

## 6. Contract and `server_tps`

- Nothing in `contract/` must change. The subject helpers already take the shard as a parameter.
- **`server_tps` has no payload schema yet (D6, owner decision; not written here).** `contract/schemas/event.schema.json` names the type (line 5) and there is no payload schema file for it in `contract/schemas/`.
- Meanwhile the NeoForge mod emits the same shape the Paper plugin sends today. From `plugin/core/src/main/java/dev/geldar/core/EventExporter.java` lines 60-66 (`exportTps`, called every 20 s by the scheduler): `tps` (double, one-minute window), `players` (int), `dropped` (the publisher's drop count), `connected` (bool). The NeoForge emitter itself is UNVERIFIED (I did not read the NeoForge source for it).
- `contract/test/records.test.ts` sets `type = 'server_tps'` in a test; it is not a payload schema.

## 7. Placement, budget and deploy (D8)

### 7.1 Where it runs and what must not restart

The live NeoForge shard is a new compose project `geldar-nf` on the colo node, not a separate host. Its file `compose/nf-live.yml` (branch `phase1/nf-live-compose`, commit e353646c) is self-contained (not an overlay on `compose/colo.yml`). It has its own network (Compose names it from the project, `geldar-nf_*`), its own NATS, its own Postgres, its own sink, its own Velocity and NeoForge server, and a one-shot `identity-seed`. A compose action on `geldar-nf` must never touch the `geldar-colo` network or the node's `colo.yml`; every nf command names `-p geldar-nf -f compose/nf-live.yml`.

The file renders with no environment (every variable has a default), so the file is checked by `docker compose config` and by its test with no env. Its defaults are not a deploy: the NeoForge offline bundle and the mod jar are inputs the operator provides. The host-side names are `NF_MOD_JAR_HOST` and `NF_MOD_SHA256`; the container side keeps `GELDAR_NF_MOD_SHA256`, which the entrypoint reads. With the default jar path (which does not exist), `up` fails closed.

Must never restart the autonomous shard (colo), from the repo:

- `deploy/colo-cd.sh` line 7 (comment): "Never restarted: Paper, Velocity, Caddy, Postgres, NATS. Never started: mind, and golem-body (the idle Adam, profile adam)." The CD script's restarts are per service in its `ORDER` list (line 340).
- `deploy/colo-down.sh` line 2: "Stops the geldar-colo project and nothing else." Running it on the node stops colo.
- `deploy/common.sh` lines 6-8: `PROJECT=${GELDAR_PROJECT:-geldar-colo}` and `COMPOSE_FILE=${GELDAR_COLO_COMPOSE:-$ROOT/compose/colo.yml}`. `common.sh` adds colo overlays and secrets to every compose call, so it cannot isolate `geldar-nf`, and setting `GELDAR_PROJECT` would not isolate it either. The NeoForge deploy script must not source `common.sh`.
- The `ghdeploy` runner sets neither `GELDAR_PROJECT` nor `GELDAR_COLO_COMPOSE` (lead's read-only check at 17:50Z: the runner's unit has no `GELDAR_` variables, and the colo-deploy root entrypoint names only the release manifest and the SHA). So `colo-cd` runs on the defaults: project `geldar-colo` and `compose/colo.yml` from its exported work directory. The `geldar-nf` script therefore names its own project `geldar-nf` and its own file `compose/nf-live.yml` explicitly (literals or its own variables), and never inherits `GELDAR_PROJECT`, which is unset on the runner. The colo project is already mixed: its containers carry different compose config-file labels and work directories, so no shared script should run compose against it.
- Golem bodies: restart only when `golem/**` is in the window (D9). `deploy/colo-cd-players.sh` was not read (UNVERIFIED).
- The shared Caddy: out of scope here (section 8).

### 7.2 Per-service caps

**Measured caps and use, 17:50Z 2026-11-17 (lead's read-only check of the live node; figures only, no addresses).** These replace the earlier estimates in this section and the 13:55Z and 16:07Z figures. The repo's `compose/colo.yml` is stale against the node (Paper 3 CPUs and 8192m in the repo; 8 CPUs and 14336m on the node), so the figures below are the node's, not the repo's. `shards/colo.yaml` (`cpu_limit: 10.6`, `memory_limit: 19968m`) is on the repo values, not the node's. Re-measure at deploy time with the commands in section 7.4.

Measured now:

| Measure at 17:50Z | Value |
|---|---|
| Host CPUs | 16 |
| Load (1, 5, 15 min) | 0.72, 0.98, 0.98 |
| Memory: total, used, available | 125 GiB, 33 GiB, 91 GiB |
| Disk under the Docker data root (`/mnt/nvme`) | 1.8 TiB size, 36% used, 1.1 TiB free |
| Running containers, all projects | 69 |
| Measured CPU sum, all 69 (`docker stats`) | 67.1%: about 0.67 of one core in total, about 4% of 16 cores |
| Measured memory sum, all 69 (`docker stats`) | 38377 MiB (about 37.5 GiB) |
| Top memory: autonomous Paper (`geldar-colo-paper-1`) | 8.1 GiB |
| Top memory: scratch-telemetry Paper (the idle scratch stack) | 7.3 GiB |
| Top memory: signoz-clickhouse, geldar-ch | 4.5 GiB, 3.3 GiB |
| Top memory: four other containers | 0.9 to 1.8 GiB each |

The CPU and memory sums cover all 69 containers, not the colo project alone; colo's own share is not measured separately here.

Caps (ceilings, not use):

| Stack | CPU caps | Memory caps | Source |
|---|---|---|---|
| `geldar-colo` (29 running, 2 exited) | 31.10 | 58368 MiB (57.0 GiB) | Lead's read-only check of the live containers. Paper 8 CPUs, 14336 MiB, 512 pids; Postgres 1 CPU, 2048 MiB; players-host containers 1 CPU, 2048 MiB, 256 pids each (count note below) |
| `geldar-nf` (proposed; not running; no project, containers, volumes or networks yet) | 5.75 | 16640 MiB (16.25 GiB) | Per-service table below, from `compose/nf-live.yml` on branch `phase1/nf-live-compose` (head 5e119771) |
| scratch-telemetry (opt-in overlay, idle) | 6.5 | 15872 MiB (15.5 GiB) | `compose/opt-in/scratch-telemetry.yml`: Paper 6 CPUs (`SCRATCH_PAPER_CPUS`, default 6) and 15360m; otel-sink 0.5 CPU and 512m. The other services of the scratch stack are not counted here |
| **Sum, colo + nf** | **36.85** (about 230% of 16 cores) | **75008 MiB** (73.25 GiB) | |
| **Sum, colo + nf + scratch-telemetry** | **43.35** (about 271% of 16 cores) | **90880 MiB** (88.75 GiB) | |

Count note: the per-row lines of the lead's colo table (Paper, Velocity, eventsink, geldar-mcp, glass, NATS, Postgres, register, bluemap-web, bluemap-alias) add to 12.10 CPUs and 19456 MiB. Only 19 players-host containers at 1 CPU and 2048 MiB reconcile that with the stated totals (31.10 CPUs, 58368 MiB) and with 29 running. The lead's note says 23 players-host containers. The count does not reconcile yet; recount with `docker ps` and `docker compose ls` at deploy time (section 7.4).

Live `geldar-nf` budget (from `compose/nf-live.yml` on branch `phase1/nf-live-compose`, not on this branch; proposals, to be measured at deploy):

| Service | CPUs | Memory | Port |
|---|---|---|---|
| neoforge (heap 9G; 512 pids) | 3 | 12288m | none published; RCON 46575 reserved |
| velocity (game entry) | 0.5 | 1024m | 127.0.0.1:46565 (the only published port) |
| postgres | 1 | 2048m | none published; 46432 reserved |
| nats | 0.5 | 512m | none published; 46222 reserved |
| eventsink | 0.5 | 512m | none published |
| identity-seed (one-shot) | 0.25 | 256m | none |
| **Total** | **5.75** | **16640m** (16.25 GiB) | one loopback port |

Pids: 512 for neoforge, 256 for the others. The earlier proposal of 25575 to 25579 is withdrawn: 25575 is the RCON default and is not a good choice.

What the sums mean:

- **CPU caps are overcommitted today, and that is how the colo project runs.** Its caps sum to 31.10 CPUs on 16 cores (about 194%). Yet the node's measured CPU use across all 69 containers is about 0.67 of one core. The measured use matters more than the caps for capacity planning; the caps are ceilings that are almost never reached together.
- **geldar-nf adds the same kind of overcommit.** Its 5.75 CPUs of caps take the colo + nf sum to 36.85 CPUs (about 230% of 16 cores). That is the same kind of overcommit, not a new kind.
- **Memory is different.** Memory caps are hard limits, so the memory sum has to fit. Colo + nf caps are 73.25 GiB against 125 GiB total and 91 GiB available (measured use 37.5 GiB): they fit, with about 17.75 GiB to spare. The scratch-telemetry caps (15.5 GiB) sit on top of that: colo + nf + scratch is 88.75 GiB, which is under the 91 GiB available with only about 2.25 GiB to spare. The scratch stack is idle and its Paper measures 7.3 GiB, but its cap is 15 GiB. Plan: scratch-telemetry does not run beside the first geldar-nf start.
- Scratch NeoForge caps are not in the repo and are not counted.

**Proposal: `cpu_shares` for geldar-nf.** Docker's default weight is 1024; the colo services have `CpuShares` unset, so they carry 1024. Propose **256 for every geldar-nf service** (neoforge, velocity, postgres, nats, eventsink, identity-seed). Shares act only when CPUs are contended: idle use and the caps are unchanged. Under contention each nf service then weighs a quarter of a colo service, so the autonomous Paper (1024) wins over an nf service (256) when both want CPU. These values are proposals, not measured; test them on the node. Any scratch service that runs beside colo should take the same value (a scratch packet).

Follow-up, not done here: `compose/nf-live.yml` is not on this branch. A read-only check of `origin/phase1/nf-live-compose` (head 5e119771) found no `cpu_shares` in it. The deploy-script packet should add `cpu_shares: 256` to each geldar-nf service and a test that every service sets it. This note does not edit that file.

### 7.3 Deploy script

`colo-cd` (`deploy/colo-cd.sh`) and the `colo-deploy` workflow (`.github/workflows/colo-deploy.yml`, triggered by `colo-images` through `workflow_run`) deploy the colo project only, through `deploy/common.sh`. They do **not** apply to `geldar-nf`. No colo deploy script applies to the NeoForge project. It needs its own script, `deploy/nf-cd.sh` (proposal, section 4a5), which names `-p geldar-nf -f compose/nf-live.yml` on every compose action and pins its own image digests in its file (so a colo-images build does not change nf until its digest is edited). That script is a later packet. Whether `colo-images` should build the NeoForge images is an owner call (not decided here).

### 7.4 Node headroom: measured by the lead at 17:50Z, to be re-measured at deploy time

The figures in section 7.2 (16 CPUs, 125 GiB total, 91 GiB available, 69 containers, measured use and caps) are the lead's read-only check at 17:50Z on 2026-11-17. This design note did not run those commands itself. They replace the earlier 13:55Z and 16:07Z estimates. The lead's note gives the time as 17:50Z in its header and as "11:50 node time" in its body; the commands below record UTC and settle it at re-measure. The figures must be re-measured with these commands, and the colo container count recounted, before the first `geldar-nf` start.

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

Ports: colo publishes 25567 on loopback (`shards/colo.yaml` `minecraft_port`); 25565 and 25566 are never published. The live `geldar-nf` block on loopback is 46565 (Velocity, the only published port), 46222 (NATS), 46432 (Postgres) and 46575 (NeoForge RCON), the last three reserved and not published. Scratch uses 24222 and 28222 (`deploy/scratch/telemetry.env`) and 34222 and 38222 (`deploy/scratch/nf.env`). Before deploy, check that no other port collides with 46222, 46432, 46565 or 46575 on the node (UNVERIFIED). The operator's public overlay `GELDAR_MC_PORT` must also avoid 46565; the repo test cannot check that.

## 8. Risks and open items

Risks:

- R1 Subject overlap. A shared NATS would put `geldar.nf.*` under the colo filter `geldar.*.*`. Removed by D1: each shard has its own NATS.
- R2 Projections. A shared database would project NeoForge events into colo's tables. Removed by option C.
- R3 Served-shard check missing (`validate.ts`). Record 0382; packet b3.
- R4 CI greps `consuming GELDAR_EVENTS` (`ci.yml` line 357). Keep the default text.
- R5 The stream pin spans `eventsink/` and `plugin/`. Change both in one window (b4, b5).
- R6 The plugin's "whichever starts first wins" creates the stream with its own name. On a separate NATS this is harmless; b5 makes the name configurable.
- R7 Retention: the stream keeps 30 days; the database keeps rows indefinitely (no purge code found; UNVERIFIED against `docs/security/privacy-and-data-retention.md`).
- R8 Budget and CPU contention: section 7.2 (cap sums 36.85 CPUs against 16 cores with nf, 43.35 with scratch-telemetry; measured CPU use about 0.67 of one core; memory caps 88.75 GiB with scratch against 91 GiB available).
- R9 The scratch token rename changes subjects probes use: `docs/analysis/neoforge/p3-adapter-design.md` (about line 145) and the P0 probe subscribe to `geldar.<nf shard>.death`; they must follow the new token.
- R10 Readers of `events` (`sql/0005_glass_reader.sql`, `sql/0062`, `sql/0040`, and tools `adam-report`, `adam-run`, `glass-ctl`, grep only, UNVERIFIED). Each reader sees its own database only.
- R11 The repo's `compose/colo.yml` is stale against the node (Paper 3 CPUs and 8192m in the repo, 8 and 14336m on the node; other drift exists). Any compose run against the node's file would be based on drift; the nf note does not depend on it.

Open items (after the lead's decisions):

- **O1 Retention change (owner).** 30 days and 2 GiB are accepted defaults. The owner may change them; no record is needed for a number change.
- **O2 Purge (open assignment).** The database has no purge today, and none is scheduled. The purge is an ops job with a runbook step, run under the lead's authorisation by an ops agent. It is **not automatic**. Proposal: a documented, idempotent job that deletes `events` rows older than the retention the owner sets, in batches, and logs the count. Owner of the assignment: the lead's operations (open; not yet assigned to a named person or agent).
- **O3 Public exposure, the shared Caddy and the human route:** out of scope here, owner decisions for the final-instance step. The shared Caddy is not touched by this design.
- **O4 Glass for NeoForge:** a NeoForge Glass needs its own connection to `geldar_nf` (open; not in this batch).
- **O5 Whether `colo-images` builds the NeoForge images:** owner call (section 7.3).
- **O6 Repo colo file stale.** Update `compose/colo.yml` (Paper and the other drift) in its own packet, after the node's values are confirmed read-only. Not in this note's scope.

Open items for the live project (from the a4 report of branch `phase1/nf-live-compose`, commit e353646c). All UNVERIFIED or open:

- **Velocity config (deploy blocker).** `compose/velocity/velocity-nf.toml` (backend `neoforge:25565`) is not written on that branch; it is written in a follow-up commit on that branch. Without it, velocity does not start (the bind creates a directory).
- **NeoForge offline bundle.** The file does not seed the bundle into the `neoforge-data` volume. How `scratch.sh` seeds it was not read.
- **identity-seed rights.** It uses the deploy NATS user; the permission to create buckets is UNVERIFIED.
- **Postgres init.** Init from `sql/` 0001 to 0066 into an empty `geldar_nf` is UNVERIFIED. The `sql/` directory is mounted read-only into postgres, as colo does.
- **Sink per-shard keys.** The stream, shard-filter and retention keys (section 3) do not exist yet; a later trigger-path packet (b1, b2).
- **Live account uid.** `NF_SERVICE_UID` defaults to 1000, the colo default; the live account uid is UNVERIFIED.
- **Per-shard NATS auth set and its generator.** Not written (a later packet). No secret value exists in the repo.
- **Caps.** The colo caps are measured at 17:50Z (section 7.2). The geldar-nf caps and the `cpu_shares` values are proposals, to be measured at deploy time.
- **Deploy script.** `deploy/nf-cd.sh` is a later packet. The runner sets neither `GELDAR_PROJECT` nor `GELDAR_COLO_COMPOSE` (settled, section 7.1). The script names `geldar-nf` and `compose/nf-live.yml` itself, and adds `cpu_shares: 256` to `compose/nf-live.yml` (section 7.2).

Where the live NeoForge shard runs is decided (D8, record 0386), not open.
