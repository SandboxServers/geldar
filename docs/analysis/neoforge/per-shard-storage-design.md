# Per-shard event storage design (NeoForge live shard and scratch)

- Status: design note, docs only. Base: origin/main 134bf7f0. Written 2026-11-17 for the lead, who batches the deploy-triggering changes into one window.
- Inputs taken as owner decisions (2026-11-17, via the lead): the live NeoForge shard's token is `nf`; scratch keeps its own separate token; NeoForge events get a separate JetStream stream and a separate Postgres `events` table per shard; scratch gets its own as well; scratch retention is 30 days; the maintenance notice behaves like Paper (broadcast to everyone online, and the MCP turns it into the in-world line for each agent).
- Reading rule: **UNVERIFIED** marks a claim I did not confirm in code, config or on a server. Paths are relative to the repo root. Decisions are cited by path only; the number of any new record is for the lead.

## 1. Current state

One stream, one subject filter, one table, one sink, one durable consumer.

| Item | Where | What it does today |
|---|---|---|
| Stream name, subjects, retention | `eventsink/src/config.ts` lines 14-20 (`STREAM_CONFIG`) | `GELDAR_EVENTS`, subjects `geldar.*.*`, file storage, `retentionDays` 30, `maxBytes` 2 GiB. Hard-wired constant. |
| Stream creation | `eventsink/src/consumer.ts` `ensureStream` (about lines 318-341) | Creates the stream from the constant if missing; on a create error it re-reads the stream (the plugin may have won the race). |
| Plugin creation | `plugin/core-common` `NatsEventPublisher.java` | Creates the same stream with the name hard-coded; "whichever starts first wins". The NeoForge mod reuses this publisher (`docs/analysis/neoforge/p3-adapter-design.md`). |
| Pin between sink, plugin and README | `eventsink/src/stream-config.test.ts` | Fails when the plugin source, `plugin/README.md` or `eventsink/README.md` stop matching the constant. Spans `eventsink/` and `plugin/`. |
| Durable consumer | `config.ts` line 23 `CONSUMER_NAME = 'eventsink'`; `consumer.ts` `ensureConsumer` (about lines 347-362) | Filter is `STREAM_CONFIG.subjects[0]` (`geldar.*.*`). Explicit ack, `ack_wait` 30 s, `max_deliver` from `MAX_DELIVER`. Durable names are scoped to a stream. |
| Shard awareness of the sink | `eventsink/src/validate.ts` (lines 24-45) | Checks that the subject `geldar.<shard>.<type>` agrees with the event's own fields. **No served-shard check found.** `docs/decisions/0026-one-database-per-shard.md` says the sink checks the field against the shard it serves; that check is not in the code I read (UNVERIFIED for the rest of `eventsink/src`). |
| Table | `sql/0001_init.sql` lines 107-112 | `events`: `event_id` BIGSERIAL, `source_event_id` TEXT UNIQUE NOT NULL, `at`, `world_day`, `world_tick`, `type`, `agent_id`, `thinker_id`, `payload` JSONB. **No `shard` column.** Later: `sql/0037_events_harness_model.sql` (harness, model), `sql/0066_events_trace_id.sql` (trace_id). |
| Insert | `eventsink/src/writer.ts` lines 34-41 | `INSERT INTO events ... ON CONFLICT (source_event_id) DO NOTHING`, one `unnest` statement per batch. The table name is literal. |
| Other writes by the same sink | `eventsink/src/projection.ts`, `audit/store.ts`, `xp/pg-xp-store.ts`, `state/service.ts` | The sink also writes projection tables (agents, actions, intents, proficiency, xp evidence, audit) and answers the state request on a queue group. Any second sink that shares a database would project everything twice. |
| Shard in the database | `sql/0001_init.sql` line 10 | `agents.shard` is the only shard column. `docs/decisions/0026-one-database-per-shard.md`: one database per shard in Phase 0. |
| Colo services | `compose/colo.yml` | `postgres` (POSTGRES_DB `geldar`, memory 2048m, lines 35-46), `nats` (512m, lines 68-71), `eventsink` (512m, 0.5 CPU, lines 202-223, `GELDAR_NATS_URL`, `POSTGRES_HOST`). |
| Scratch services | `compose/phase0.yml` and `compose/opt-in/scratch.yml` | Each scratch stack is its own compose project (`docker compose -p scratch-<suffix>`), so it has its own NATS and its own Postgres volume. Eventsink memory 384m (`scratch.yml` line 122). |
| NATS users | `geldar.ps1` `Get-NatsUsers` (lines 390-436) | One table keyed by shard name; the phase0 (scratch) branch adds two identity buckets. Users: body, mind, eventsink, mcp, velocity, paper, kino, deploy, supervisor, register, helper. |
| Eventsink allow list | `geldar.ps1` line 413 | Pub `geldar.<s>.dlq`, `geldar.<s>.state.>` and the JetStream API; Sub `geldar.<s>.state.*.proficiency` and the inbox. |
| Contract | `contract/src/subjects.ts` | Shard is a parameter in every subject helper; `maintenanceSubject` (line 118) is `geldar.<shard>.maintenance`. No stream name and no shard list in `contract/src` or `contract/schemas` (grep: none). |
| Log line pinned by CI | `eventsink/src/main.ts` line 159; `.github/workflows/ci.yml` lines 346-358 | The sink logs `eventsink: consuming GELDAR_EVENTS`; CI greps that exact text. |
| Ambient shard variable | `eventsink/src/sink-plan.test.ts` line 118, `main.test.ts` line 161 | `GELDAR_SHARD` alone is inert for the sink by design (the sheet switch is `GELDAR_SHEET_SHARD`). |

Hard-wired to one shard today: the stream name (config and plugin), the subject filter `geldar.*.*` (one stream sees every shard that shares its NATS), the table name `events` (no shard in the row), the CI log string, and the scratch token `nf` (`docs/analysis/neoforge/RESUME.md` says scratch runs with suffix `nf`).

## 2. Target names and where the table lives

Naming scheme (proposal):

- Autonomous shard (colo): unchanged. Stream `GELDAR_EVENTS`, subjects `geldar.*.*` in its own NATS, table `events` in its own database. Nothing in this design edits it.
- Live NeoForge shard, token `nf`: stream `GELDAR_EVENTS_NF`, subjects `geldar.nf.*`, durable `eventsink`, database `geldar_nf` (name UNVERIFIED against `tools/migrate`, which I did not read).
- Scratch, new token (proposal `nf-scratch`; it must match `^[a-z][a-z0-9-]{1,31}$`, the rule in `eventsink/src/xp/outbox.ts` line 47): stream `GELDAR_EVENTS_NF_SCRATCH`, subjects `geldar.nf-scratch.*`, database `geldar_nf_scratch`.
- Stream name rule: upper-case the token and turn `-` into `_`.
- Consumer name stays `eventsink` in each stream (durable names are per stream).

Where each is created:

- Stream: created by the sink at start (`ensureStream`) and by the plugin or mod if it starts first. The name comes from the sink's and the mod's configuration, never a constant once the batch lands.
- Table: created by the migrations (`sql/0001_init.sql` onward) run into the shard's own database. A new database runs 0001 to 0066 from empty; no migration needs to alter an existing database.

Table options:

| Option | What it means | Verdict |
|---|---|---|
| A. `events_nf` table in the shared database | Writer and projections hard-code `events`; foreign keys from `sql/0051_character_audit.sql` reference `events(source_event_id)`; owner export (`sql/0062`) and account deletion (`sql/0040`) read `public.events`. Every projection needs a copy. | Reject. |
| B. Schema `nf` in the shared database | Needs `search_path` or qualified names in the writer and every grant; `sql/0003` and `sql/0005` create roles, and whether they are guarded against a second run is UNVERIFIED (same cluster, second database). | Reject for now. |
| C. Own database per shard, own Postgres container in the shard's compose project | `events` keeps its name; writer, projections and migrations are unchanged; roles live in their own cluster; the model of `docs/decisions/0026-one-database-per-shard.md`. Cost: memory for a second Postgres (UNVERIFIED sizing). | **Recommended.** |
| D. `shard` column with a partition on the existing `events` | Changes the autonomous table (a migration on a large table; `sql/0066` calls it large). Breaks "untouched". `docs/decisions/0026-...` says to revisit only if one database serves two shards. | Reject. |

The recommendation (C) matches what scratch already does, so the NeoForge live shard and scratch use the same shape: one compose project, one NATS, one Postgres, one sink.

## 3. The sink: one instance per shard

Recommendation: a second `eventsink` process per shard, each with its own NATS, database, memory cap and compose service. Not one shard-aware sink.

Reasons:

- Isolation: a poison message or a slow batch in the NeoForge stream cannot delay the colo sink, which has its own consumer and its own database.
- Failure blast radius: a restart after 20 failed fetches (`docs/decisions/0041-event-export-stream-and-sink.md`) restarts one shard only.
- Memory budget caps: each sink has its own compose limit (colo 512m, scratch 384m today), so the caps stay per service.
- Projections: the sink writes about ten tables per database. One sink with routing would need every writer taught the shard. Per-database projections need no change.
- Idempotency: `ON CONFLICT (source_event_id) DO NOTHING` is per table; with one database per shard, a redelivery stays in its own shard's table.

Config keys the per-shard sink needs (proposals; none exists today):

- `GELDAR_EVENTS_STREAM` (default `GELDAR_EVENTS`): used by `ensureStream`, `ensureConsumer` and the log line.
- `GELDAR_EVENTSINK_SHARD` (default unset, which keeps today's `geldar.*.*` filter): the filter becomes `geldar.<shard>.*`. Do not reuse `GELDAR_SHARD`; the sink ignores it on purpose (see section 1).
- `EVENTSINK_STREAM_RETENTION_DAYS` (default 30) and `EVENTSINK_STREAM_MAX_BYTES` (default 2 GiB): today these are constants in `STREAM_CONFIG`. Optional; the defaults keep the autonomous stream unchanged.
- `POSTGRES_DB` is already read (`config.ts` line 62); the NeoForge sink sets it to `geldar_nf`.

Unchanged: `CONSUMER_NAME`, `MAX_DELIVER`, the ack and dead-letter logic, `writer.ts`, the projections, the NATS URL key, the `geldar.<shard>.dlq` dead-letter subject.

## 4. Changes by path

Trigger paths (from `.github/workflows/colo-images.yml` `paths:` lines 13-34, the entries I saw): `golem/**`, `eventsink/**`, `tools/admin/**`, `sql/**`, `contract/**`, and the workflow file. Other paths in that list are UNVERIFIED.

### (a) Packets that do NOT touch trigger paths

| # | Path | Change | Size (lines) | Pinning test | Revert-fails idea |
|---|---|---|---|---|---|
| a1 | `docs/analysis/neoforge/per-shard-storage-design.md` | This note | about 210 | `pnpm check:repo` | none |
| a2 | `docs/analysis/neoforge/RESUME.md` | One pointer line | 1 | repo check | none |
| a3 | `geldar.ps1` (`Get-NatsUsers`, `shard nats-auth`) | Accept shard `nf` (and the scratch token) with no change to the colo table. No role changes (section 7). | 0-20 | existing test that pins the colo generated file (UNVERIFIED which file) | change one colo subject; that test must fail |
| a4 | `compose/opt-in/nf-live.yml` (new overlay) | Postgres, NATS and eventsink for the NeoForge shard in their own project; no published port; memory caps. `compose/colo.yml` is not changed, so `colo-up` never starts it. | 120-180 | repo check on loopback ports and memory caps (UNVERIFIED which check) | remove one memory limit; the cap check must fail |
| a5 | `deploy/scratch/scratch.sh`, `deploy/scratch/nf.env` | Scratch token from the new name; stream and database names from env | 30-60 | `deploy/test` scratch tests (UNVERIFIED names) | restore the old default token; the test fails |
| a6 | `deploy/colo-notice.sh` | A target-shard argument, so the notice can go to the NeoForge NATS | 20-40 | `deploy/test/colo-notice.test.ts` | keep the colo shard hard-coded; the new target test fails |
| a7 | `tools/repo-checks/src/` (new check) | No two stream subject filters overlap inside one compose project; stream names unique | 40-80 | the new check on a fixture with an overlap | drop the overlap rule; the fixture test must fail |
| a8 | `docs/reference/eventsink.md`, `docs/reference/nats-subjects.md`, `docs/security/authn-authz-map.md`, `docs/runbooks/` | Names, per-shard users, operator steps | docs | `pnpm check:repo` | none |

### (b) Packets that DO touch trigger paths (one window)

| # | Path | Change | Size (lines) | Pinning test | Revert-fails idea |
|---|---|---|---|---|---|
| b1 | `eventsink/src/config.ts` | Stream name, subjects and retention read from settings; defaults equal today's values | 30-50 | `stream-config.test.ts`: defaults are `GELDAR_EVENTS` and `geldar.*.*`; with `nf` set they are `GELDAR_EVENTS_NF` and `geldar.nf.*` | restore the constant; the `nf` case fails |
| b2 | `eventsink/src/consumer.ts`, `eventsink/src/main.ts` | `ensureStream` and `ensureConsumer` take the name and filter; the log line keeps the text `consuming GELDAR_EVENTS` for the default (CI greps it) | 40-70 | `consumer.start.test.ts`: create with the `nf` name and filter; error path: a failed create with no stream still rethrows; a stream created by the plugin is accepted | put back `STREAM_CONFIG.subjects[0]` as the filter; the filter test fails |
| b3 | `eventsink/src/config.ts`, `eventsink/src/validate.ts` (or `main.ts`) | `GELDAR_EVENTSINK_SHARD`: a message whose shard differs from the served shard is dead-lettered, not stored (proposal; section 8, Q6) | 30-40 | a test that a `geldar.colo.x` message to an `nf` sink is dead-lettered and no row is written (`writer.test.ts`) | remove the check; the row is written and the test fails |
| b4 | `eventsink/src/stream-config.test.ts`, `eventsink/README.md`, `plugin/README.md` | The pin reads the new names | 20-30 | itself | change one side only; the pin fails |
| b5 | `plugin/core-common` `NatsEventPublisher.java`; `neoforge/.../ExportConfig.java` | Stream name and filter from config; the default is `GELDAR_EVENTS` | 30-60 | Java unit test with a fake JetStream: the name and filter come from config; the stream is created with `geldar.nf.*` | restore the constant; the test fails. `plugin/` and `neoforge/` are not in the trigger list I read, but b4 is in `eventsink/`, so they go in the same window. |
| b6 | `tools/admin/**` (and `tools/migrate` if the admin image bakes it in: UNVERIFIED) | `migrate` takes the database name, so the one-shot can run against `geldar_nf` | 40-80 | `tools/admin` test: the target database is the one named, not `geldar` | ignore the variable; the test fails |
| b7 | `sql/` | No change under option C: the NeoForge database runs 0001 to 0066 from empty. A bootstrap migration is needed only if the roles of 0003 or 0005 are not idempotent (UNVERIFIED). Under option D: a new migration plus `sql/test/check-schema-*.sql`. | 0 expected | `sql/test/check-schema.sql` style | (only if a migration is written) drop the new column; the schema check fails |
| b8 | `contract/` | **No change.** There is no stream name and no shard list in `contract/`. | 0 | none needed | none |
| b9 | `golem/**` | No change expected: the body reads its NATS URL and shard from its compose env and shard file. Keep it out of the window (section 5). | 0 expected | none | none |

Batch: b1 to b6 in one window (b6 only if the admin one-shot is needed for the NeoForge database). Leave b9 out so the Bodies do not restart. The window is about 200-350 lines of trigger changes.

## 5. Migration steps

Live node (colo) and NeoForge shard:

1. Repo, now: this note and the pointer merge. No deploy. (repo)
2. Repo: the (a) packets. No restart: they touch no image. (repo)
3. Owner: decide the open questions in section 8 (Q1 to Q5 at least). (owner)
4. Repo, one window: the (b) batch. The colo-images workflow builds the eventsink image (and the admin image if b6 is in). colo-cd deploys: the colo `eventsink` restarts on the new image with default config, so it still reads `GELDAR_EVENTS` with `geldar.*.*` and writes `events`. Check: the stream exists, the durable `eventsink` is unchanged, the log line is unchanged. Rollback: the previous digest in the release env. (repo)
5. Operator, NeoForge shard: create the compose project from a4 (NATS, Postgres, eventsink). Generate its NATS users with `shard nats-auth nf` (per-shard table, a3). (operator)
6. Operator: run the migrations into `geldar_nf` through the admin one-shot (b6, or the existing one with the database name). Check the table `events` exists and is empty. (operator)
7. Operator: start the NeoForge sink with `GELDAR_EVENTS_NF`. Check that the stream exists with subjects `geldar.nf.*`, and that the colo stream's subject filter and message count are unchanged (read-only `/jsz?streams=true`, the same probe as `.claude/skills/run-shard/SKILL.md`). (operator)
8. Operator: start the NeoForge server. Read-only probes only: `tick query`, `list`, then `server_tps` arrives every 20 s. (operator)
9. Operator: send a maintenance notice to the NeoForge NATS with the new target (a6). (operator)

What restarts at the colo deploy (step 4): the colo `eventsink` (new image). The admin one-shot only when it is run. Bodies (the player hosts) restart only if `golem/**` is in the window; the brief says they restart when a trigger path merges, and I did not verify `deploy/colo-cd-players.sh` (UNVERIFIED). What does **not** restart: colo NATS, colo Postgres, colo Mind, MCP and Glass, unless their images changed (their source is not in the trigger list I read; UNVERIFIED).

Rollback for the NeoForge shard: stop its compose project. Deleting its stream and its database is destructive: owner approval first. The colo shard is unaffected.

Scratch:

1. Owner: approve the token change. The old scratch stack (token `nf`) has its own data, which is lost if it is removed. (owner)
2. Operator: stop the old scratch stack (the verb is UNVERIFIED; `scratch.sh` was not read). (operator)
3. Repo, step 4 of the live list (the same batch): scratch reads its token and names from env. (repo)
4. Operator: `scratch.sh up` with the new token. The scratch sink creates `GELDAR_EVENTS_NF_SCRATCH` in its own NATS, so no overlap with colo. Retention: the stream keeps 30 days (`STREAM_CONFIG.retentionDays`); database rows are never deleted by the sink (no purge code found; UNVERIFIED against `docs/security/privacy-and-data-retention.md`). (operator)
5. Rollback: stop the new token; bring the old token back only if its image is still published.

## 6. Contract

- Nothing in `contract/` must change. No stream name, no shard list and no retention constant is in `contract/src` or `contract/schemas` (grep: none). The subject helpers already take the shard as a parameter.
- Q8 (is there a `server_tps` payload schema?): the type is named in `contract/schemas/event.schema.json` (line 5, inside the event schema). **There is no separate payload schema file for `server_tps`** in `contract/schemas/` (the list has none). How `event.schema.json` constrains its payload is UNVERIFIED (I read only the grep lines). The fields the NeoForge mod sends (`tps`, `players`, `dropped`, `connected`) come from `docs/analysis/neoforge/p3-adapter-design.md` only. Nothing is invented here.
- `contract/test/records.test.ts` line 190 sets `type = 'server_tps'` in a test; it is not a payload schema.

## 7. NATS allow lists

- The stream name never appears in an allow list: JetStream calls sit under `$JS.API.>`, which every stream user already has. So a new stream needs no allow-list change.
- `Get-NatsUsers` already takes a shard name. A NeoForge table is generated with `shard nats-auth nf`; the colo table and the colo generated file do not change.
- Users that a NeoForge shard needs: eventsink (the same entry as colo, with `nf` subjects), the NeoForge mod (publishes events, subscribes to the maintenance subject), and a deploy user for the notice. The body, Mind, MCP and Glass for NeoForge are not in this design (open question).
- Which user the NeoForge mod connects as is UNVERIFIED: `neoforge/.../ExportConfig.java` line 67 reads `GELDAR_NATS_USER` from the environment or a `nats.user` property, and I did not find its default. Options for the lead:
  - (i) reuse the `paper` entry: its shape already matches a game-server publisher (publish `geldar.<s>.>`, subscribe to maintenance). No new role.
  - (ii) add a `neoforge` entry in the NeoForge branch of `Get-NatsUsers` only. A new role, but the colo table and its generated file stay unchanged.
- The `deploy` user (`colo-notice.sh`) needs its own entry in the NeoForge table, since the notice goes to the NeoForge NATS.

## 8. Risks and open questions

Risks:

- R1 Subject overlap. The colo stream filter `geldar.*.*` covers any `geldar.nf.*` subject on the same NATS. If the NeoForge stream shares the colo NATS, creating it may fail or may double-capture (JetStream overlap behaviour is UNVERIFIED on the pinned nats-server; a throwaway stream on scratch would show it). Treat it as blocking: give the NeoForge shard its own NATS (option C). Narrowing the colo filter would edit the autonomous stream, which is out of bounds.
- R2 Projections. The sink writes about ten tables. A shared database would project NeoForge events into colo's tables. Option C avoids it.
- R3 The 0026 note says the sink checks the shard field against the shard it serves; `validate.ts` checks subject against event only. Either the check is elsewhere (UNVERIFIED) or it is missing; b3 adds it.
- R4 CI greps `consuming GELDAR_EVENTS` (`ci.yml` line 357). Keep the default text.
- R5 The stream pin (`stream-config.test.ts`) spans `eventsink/` and `plugin/`. Change the constant and the plugin in one window, or the pin fails.
- R6 The plugin's "whichever starts first wins" creates the stream with its own name. If the NeoForge mod starts first on a shared NATS it could create `GELDAR_EVENTS` with `geldar.*.*`. On a separate NATS this is harmless; b5 makes the name configurable.
- R7 Retention mismatch: the stream keeps 30 days; the database keeps rows indefinitely (no purge code found; UNVERIFIED against the privacy document).
- R8 Budget: a second Postgres and sink on the colo node need headroom. `compose/colo.yml` header: `geldar.ps1` refuses a shard total below the sum of service defaults (postgres 2048m, nats 512m, eventsink 512m).
- R9 The scratch token rename changes subjects used by probes. `docs/analysis/neoforge/p3-adapter-design.md` (line 145) and the P0 probe subscribe to `geldar.<nf shard>.death`; those must follow the new token.
- R10 Readers of `events` (none shard-filtered in what I checked): Glass (`sql/0005_glass_reader.sql` line 33: SELECT on type, agent_id, world_day, world_tick, at, source_event_id), owner export counts (`sql/0062`), account deletion (`sql/0040` line 83), and tools `adam-report`, `adam-run`, `glass-ctl` (grep only; UNVERIFIED). The MCP reads no events columns (`sql/0066` comment). Under option C each reader sees its own database only; a NeoForge Glass would need its own connection (open question).
- R11 The `archive` schema (`sql/0001` line 114) and dead-agent copies exist per database, which is correct for option C.

Open questions (owner or lead):

- Q1 Where does the live NeoForge shard run: a separate host, or a new compose project on the colo node (budget, R8)?
- Q2 Live NeoForge retention: propose 30 days and 2 GiB, the same as scratch and `docs/decisions/0041-event-export-stream-and-sink.md`. Does the database keep rows (no purge today)?
- Q3 Scratch token name (`nf-scratch` is a proposal).
- Q4 Confirm option C (own database and own Postgres per shard), or accept B.
- Q5 NeoForge mod user: reuse `paper` (i) or add a `neoforge` entry (ii).
- Q6 Shard mismatch (b3): dead-letter (proposal) or ack and skip.
- Q7 Notices for the NeoForge shard: which NATS the deploy publishes to, and the deploy user's entry (a6).
- Q8 `server_tps` payload schema: none exists in `contract/`. Should one be written? Not invented here.
- Q9 Records: a record that says "one NATS and one Postgres per shard, names by shard" is warranted, and `docs/decisions/0041-event-export-stream-and-sink.md` ("one JetStream stream") needs an amendment by path. The number is for the lead.
- Q10 The colo shard's token (the table name in `Get-NatsUsers` for colo) and the colo database name are UNVERIFIED here; I did not read the colo shard file.
