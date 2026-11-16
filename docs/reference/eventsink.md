---
title: Event sink
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [README.md, nats-subjects.md, contract-schemas.md, database-schema.md, ../architecture/data-flow-events.md, ../../eventsink/README.md]
sources: [eventsink/README.md, eventsink/package.json, eventsink/Dockerfile, eventsink/src/config.ts, eventsink/src/main.ts, eventsink/src/consumer.ts, eventsink/src/validate.ts, eventsink/src/writer.ts, eventsink/src/projection.ts, eventsink/src/audit/projection.ts, eventsink/src/audit/store.ts, eventsink/src/xp/xp-config.ts, eventsink/src/xp/awards.ts, eventsink/src/xp/ledger.ts, eventsink/src/xp/pg-xp-store.ts, eventsink/src/xp/outbox.ts, eventsink/src/state/service.ts, eventsink/src/state/pg-state-store.ts, eventsink/src/sink-plan.ts, eventsink/src/metrics.ts, eventsink/src/nats-credentials.ts, eventsink/test, compose/phase0.yml, compose/colo.yml, compose/nats-auth.yml, compose/opt-in/sheet-sink.yml, compose/opt-in/scratch.yml, geldar.ps1, ../decisions/0041-event-export-stream-and-sink.md, ../decisions/0133-colo-admin-by-one-shot-container.md]
---

# Event sink

The `eventsink` package (`@geldar/eventsink`) copies world events from the JetStream stream `GELDAR_EVENTS` into the Postgres `events` table, projects some event types into query tables, and, when enabled, keeps the XP ledger and answers proficiency requests. Checked at 1b114276 on 2026-11-16 from the repository only; nothing was read from a running stack (plan decision D8).

The package's own [README](../../eventsink/README.md) holds the dead-letter replay steps. Subjects are in [NATS subjects](nats-subjects.md), message bodies in [contract schemas](contract-schemas.md), and the tables in [database schema](database-schema.md).

## Identity

| Field | Value | Evidence |
|---|---|---|
| Package | `@geldar/eventsink`, private, ESM | `eventsink/package.json` |
| Entry point | `node src/main.ts` | `package.json` `start`; `eventsink/Dockerfile` `CMD` |
| Spec | Section 7 (event bus), Appendix D (`events`), Appendix F (event export) | decision 0041 header |
| Decisions | 0041 (stream and sink), 0020 (receipts), 0043 (Body state in NATS KV), 0088 (metrics), 0067 and 0087 (NATS least privilege), 0171 and 0186 (sheet audit), 0280 (proficiency contract and state subjects) | file headers in `eventsink/src` |
| Owner | No owner is named in the repository. Changes go through the campaign packets like any package. | `eventsink/README.md` names none |
| Dependencies | `@geldar/contract`, `@geldar/psyche` (workspace); `@nats-io/jetstream` 3.4.0, `@nats-io/transport-node` 3.4.0, `pg` 8.23.1 | `eventsink/package.json` |

## Components

| Module | Role |
|---|---|
| `src/config.ts` | `STREAM_CONFIG`, `CONSUMER_NAME`, `loadConfig` |
| `src/main.ts` | Connects Postgres and NATS, starts the optional shard services, runs the consumer, drains on SIGINT and SIGTERM |
| `src/consumer.ts` | Ensures the stream and consumer, fetches batches, acks, naks, dead-letters |
| `src/validate.ts` | Validates a message against `WorldEvent` and checks its subject; lists non-event subjects |
| `src/writer.ts` | `INSERT ... ON CONFLICT (source_event_id) DO NOTHING`; runs projections and XP in one transaction when needed |
| `src/projection.ts` | `intent`, `action`, `receipt` into `intents`, `actions`, `receipts` |
| `src/audit/projection.ts`, `src/audit/store.ts` | `roll`, `decision`, `sheet_adopted` into `rolls`, `decisions`, `character_sheet_adoptions` and the sheet columns of `agents` |
| `src/xp/*` | XP awards, the ledger (`proficiency`, `xp_evidence`), the level outbox (`proficiency_outbox`) and its publisher |
| `src/state/*` | The proficiency state service on `geldar.<shard>.state.<life_id>.proficiency` |
| `src/sink-plan.ts` | Reads which optional services start |
| `src/metrics.ts` | Push-only OTLP metrics |
| `src/nats-credentials.ts` | The NATS user and password file |

## Inputs and outputs

| Direction | Object | Detail | Evidence |
|---|---|---|---|
| In | Stream `GELDAR_EVENTS`, durable pull consumer `eventsink` | filter `geldar.*.*`, explicit ack, `ack_wait` 30 s, `max_deliver` -1 (no cap) | `src/consumer.ts` `ensureConsumer`, `MAX_DELIVER` |
| In | `geldar.<shard>.state.<life_id>.proficiency` (core request/reply, queue group `state-service`) | only with `GELDAR_SHEET_SHARD` set | `src/state/service.ts` |
| Out | `geldar.<shard>.dlq` (into the same stream) | dead letters | `src/consumer.ts` `dlqSubject` |
| Out | `geldar.<shard>.state.<life_id>.level` (core publish) | `ProficiencyLevelPayload`; only with `GELDAR_SHEET_SHARD` set | `src/xp/outbox.ts` |
| Out | Postgres tables | below | `src/writer.ts`, `src/projection.ts`, `src/audit/store.ts`, `src/xp/pg-xp-store.ts`, `src/xp/outbox.ts` |
| Out | OTLP metrics to `GELDAR_TELEMETRY_URL` | only when that variable is set | `src/metrics.ts` |

### Stream definition

| Setting | Value | Evidence |
|---|---|---|
| name | `GELDAR_EVENTS` | `src/config.ts` |
| subjects | `geldar.*.*` | `src/config.ts` |
| storage | file | `src/config.ts` |
| `max_age` | 30 days | `src/config.ts` `retentionDays` |
| `max_bytes` | 2147483648 (2 GiB); oldest messages go first at the cap | `src/config.ts` `maxBytes` |

The Geldar-Core plugin creates the same stream (`NatsEventPublisher.java`); whichever starts first wins, and an existing stream keeps its limits. `eventsink/src/stream-config.test.ts` fails when the plugin source, `plugin/README.md` or the eventsink README stops matching the constant (`src/config.ts` comment).

### Tables written

| Table | When | Write | Evidence |
|---|---|---|---|
| `events` | every valid event | `INSERT ... ON CONFLICT (source_event_id) DO NOTHING`, one statement per batch; columns `source_event_id, at, world_day, world_tick, type, agent_id, thinker_id, payload, harness, model` | `src/writer.ts` `INSERT_SQL` |
| `intents`, `actions` | `intent`, `action` events | forward-only upsert by primary key; first final state stays; `interrupted` stored as `cancelled` with `end_reason` starting `interrupted:`; `paused` not stored | `src/projection.ts` header |
| `receipts` | `receipt` events | one row per `(action_id, phase)`; a second final receipt is a permanent error (SQLSTATE 23505) | `src/projection.ts`; decision 0020 |
| `rolls`, `decisions`, `character_sheet_adoptions` | `roll`, `decision`, `sheet_adopted` events | `ON CONFLICT DO NOTHING`; payload `life_id` must equal the event `agent_id` | `src/audit/projection.ts` header |
| `agents` (`character_sheet`, `sheet_hash`, `sheet_adopted_at`) | first `sheet_adopted` for a life | sets the baseline only while none is stored | `src/audit/store.ts` line 76 |
| `xp_evidence`, `proficiency`, `proficiency_outbox` | every batch, only with `GELDAR_XP=1` | evidence row first; XP bump only when the evidence row was new | `src/xp/ledger.ts`, `src/xp/pg-xp-store.ts` |
| `proficiency_outbox.published_at` | outbox publisher, only with `GELDAR_SHEET_SHARD` set | set after the push, in the same transaction | `src/xp/outbox.ts` |

Reads: `agents` and `proficiency` (state service, `src/state/pg-state-store.ts`); `proficiency_outbox` joined to `agents` (outbox).

A batch that holds `intent`, `action`, `receipt`, `roll`, `decision` or `sheet_adopted`, or any batch with XP on, runs in one transaction: the `events` insert, then the projections, then the awards, then commit (`src/writer.ts` `pgEventWriter`). A client whose ROLLBACK fails is destroyed, not returned to the pool.

The sink does not write `thoughts` or `turn_records`. `turn_record` events, if any were published, would be stored in `events` like any other type; the schema forbids emitting them until GX-05b (`contract/schemas/turn-record-event.schema.json`; `sql/0060_turn_records.sql` header).

## Message handling

| Case | Handling | Evidence |
|---|---|---|
| Valid event | validated by the generated `WorldEvent` validator; subject must equal `geldar.<shard>.<type>`; written, then acked after commit | `src/validate.ts`; `src/consumer.ts` |
| Duplicate or redelivery | no-op through `ON CONFLICT` and forward-only upserts | `src/writer.ts`; `src/projection.ts` |
| `geldar.<shard>.maintenance` | acked and skipped, counted in `geldar_eventsink_skipped_total`; no dead letter | `src/validate.ts` `NON_EVENT_TYPES` |
| The sink's own dead letter (`*.dlq` with no `source_event_id`) | acked and skipped | `src/consumer.ts` |
| An event of type `dlq` with a `source_event_id` | stored like any other | `src/consumer.ts` comment |
| Invalid body (not UTF-8 JSON, fails the contract, wrong subject) | dead-lettered, then acked | `src/consumer.ts` |
| Permanent database error (SQLSTATE class 22 or 23) | batch retried row by row; only rejected rows dead-lettered | `src/writer.ts` `isPermanentDbError` |
| Transient error (connection, timeout, Postgres down) | nak with delay 1 s doubling to 30 s; never dead-lettered | `src/consumer.ts` `nakDelayMs` |
| Failed DLQ publish | nak | `src/consumer.ts` |
| 5 failed fetches in a row (and every 5th after) | re-ensure stream and consumer | `src/consumer.ts` `REENSURE_AFTER` |
| 20 failed fetches in a row | process exits with code 1; compose restarts it | `src/consumer.ts` `FATAL_AFTER`; `src/main.ts` |
| SIGINT, SIGTERM | stop fetching, finish the batch, stop services, drain NATS, close the pool | `src/main.ts` `shutdown` |

### Dead letters

A dead letter is published to `geldar.<shard>.dlq` (the shard of the original subject, or `unknown`) with the body:

| Field | Meaning |
|---|---|
| `reason` | why it was rejected, cut to 2000 characters |
| `subject` | the original subject |
| `data` | the original body, cut to 8192 bytes |
| `data_bytes` | the original size |
| `data_truncated` | true when `data` was cut |

Every dead letter logs `eventsink: ALERT dead letter published to <dlq subject> for subject=<subject> reason=<reason>` on stderr (default `console.error`), with the reason cut to its first 300 characters in this line (`src/consumer.ts` lines 107 and 168). The 300-character cut is for the log line only; the DLQ body keeps up to 2000 characters of the reason. Dead letters live in `GELDAR_EVENTS` for the stream's `max_age`. Replay steps: [eventsink README, "Dead letters and replay"](../../eventsink/README.md#dead-letters-and-replay).

## Proficiency state service

Starts only when `GELDAR_SHEET_SHARD` names a shard (`src/sink-plan.ts` `startShardServices`).

| Setting | Value | Evidence |
|---|---|---|
| Subject | `geldar.<shard>.state.<life_id>.proficiency`; the life id in the subject is the only authority, the body is size-checked and otherwise ignored | `src/state/service.ts` header |
| Queue group | `state-service` | `src/state/service.ts` |
| Request body cap | 256 bytes | `MAX_BODY_BYTES` |
| Per-life minimum interval | 1000 ms; a request inside it gets `{"error":"rate"}` | `serveProficiencyState` default |
| Limiter memory | 4096 lives, oldest forgotten first | `LIMITER_CAP` |
| Read timeout | 2000 ms; then `{"error":"unavailable"}` | `DEFAULT_READ_TIMEOUT_MS` |
| Unknown life | `{"error":"unknown_life"}` | `replyFor` |
| Reply | `ProficiencyState`: seven domains, level and XP each, `version` = total XP; no sheet | `src/state/service.ts`; `proficiency-state.schema.json` |
| Thresholds | psyche `DEFAULT_THRESHOLDS` always | `src/sink-plan.ts` |
| Subscription failure | resubscribe after 1 s doubling to 30 s | `DEFAULT_RETRY_BASE_MS`, `RETRY_CAP_MS` |

## Level outbox publisher

Starts with the state service. Drains `proficiency_outbox` in `outbox_id` order every 2000 ms (at once again after a full batch of 100), pushes each row to `geldar.<shard>.state.<life_id>.level`, then sets `published_at` in the same transaction: at-least-once. Failed drains back off up to 30 s. A row whose shard fails the shard pattern is rejected, not pushed (`src/xp/outbox.ts`).

## Configuration

Names only; values that are secrets are files mounted as Docker secrets.

| Variable | Default | Effect | Evidence |
|---|---|---|---|
| `GELDAR_NATS_URL` | `nats://127.0.0.1:4222` | NATS server | `src/config.ts` |
| `GELDAR_NATS_USER` | `eventsink` when a password file is set | NATS user | `src/nats-credentials.ts` |
| `GELDAR_NATS_PASSWORD_FILE` | unset (anonymous) | file holding the NATS password | `src/nats-credentials.ts` |
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_DB` | `127.0.0.1`, `5432`, `geldar`, `geldar` | Postgres connection | `src/config.ts` |
| `POSTGRES_PASSWORD_FILE` | required | file holding the Postgres password | `src/config.ts` |
| `EVENTSINK_BATCH_SIZE`, `EVENTSINK_FETCH_WAIT_MS` | `50`, `1000` | messages per fetch and transaction; fetch wait | `src/config.ts` |
| `GELDAR_TELEMETRY_URL` | unset (no metrics, no timer) | OTLP push target | `src/metrics.ts`; decision 0088 |
| `GELDAR_SHEET_SHARD` | unset (no state service, no outbox) | shard for the state service and outbox | `src/sink-plan.ts` |
| `GELDAR_XP` | off unless exactly `1` | XP awards in the writer | `src/xp/xp-config.ts` |
| `GELDAR_PROFICIENCY_THRESHOLDS` | psyche defaults | three non-decreasing integers; read only with `GELDAR_XP=1`; must be unset or the defaults while `GELDAR_SHEET_SHARD` is set, or startup fails | `src/xp/xp-config.ts`; `src/sink-plan.ts` |

Postgres pool: `max` 2, connection timeout 10 s, query and statement timeout 30 s, idle timeout 60 s (`src/main.ts`).

## Build, test and deploy

| Item | Value | Evidence |
|---|---|---|
| Image | `eventsink/Dockerfile`, build context the repo root; Node 22 Alpine pinned by digest; installs `contract`, `psyche` and `eventsink` with `--prod`; runs as `node` | `eventsink/Dockerfile` |
| Unit tests | 17 test files under `eventsink/src` with fakes, run by `./geldar.ps1 pnpm test` (count re-derived 2026-11-16: `(git ls-files eventsink/src \| Select-String '\.test\.ts$').Count`) | `eventsink/src` |
| Integration tests | `eventsink/test/*.it.test.ts` (eventsink, projection, audit, state, xp, xp-outbox); skipped unless `GELDAR_IT=1` and the shard is up | `eventsink/README.md` "Tests"; `eventsink/test` |
| Phase 0 compose | service `eventsink` in `compose/phase0.yml`; Postgres password as Docker secret; starts after healthy Postgres and NATS; `restart: unless-stopped` | `compose/phase0.yml` |
| Colo compose | service `eventsink` in `compose/colo.yml`; limits 0.5 CPU and 512 MiB by default (`GELDAR_COLO_EVENTSINK_CPUS`, `GELDAR_COLO_EVENTSINK_MEM`), 256 pids; image `GELDAR_EVENTSINK_IMAGE` | `compose/colo.yml` lines 202 to 231 |
| NATS auth overlay | `compose/nats-auth.yml` sets `GELDAR_NATS_USER: eventsink` and mounts its password as a Docker secret | `compose/nats-auth.yml` lines 41 to 45 |
| Sheet overlay | `compose/opt-in/sheet-sink.yml` passes `GELDAR_SHEET_SHARD`, `GELDAR_XP`, `GELDAR_PROFICIENCY_THRESHOLDS` from the host; not part of any default file set | `compose/opt-in/sheet-sink.yml` header |
| Scratch overlay | `compose/opt-in/scratch.yml`: 0.25 CPU, 384 MiB, `restart: "no"` | `compose/opt-in/scratch.yml` |

Whether the sheet overlay runs on any node is not checked here (D8).

## Monitor

Metrics exist only with `GELDAR_TELEMETRY_URL` set; pushed as OTLP at start and every 15 s, push timeout 5 s (`src/metrics.ts`).

| Metric | Kind | Labels |
|---|---|---|
| `geldar_eventsink_consumed_total` | counter | `type` (event type) |
| `geldar_eventsink_written_total` | counter | none |
| `geldar_eventsink_failed_total` | counter | `reason`: `parse`, `validate` or `db` |
| `geldar_eventsink_dlq_written_total` | counter | none |
| `geldar_eventsink_consumer_pending` | gauge | none |
| `geldar_eventsink_skipped_total` | counter | none (messages on non-event subjects) |

Logs go to stdout (`consuming GELDAR_EVENTS`) and stderr (naks, ALERT lines, state and outbox lines). State and outbox log lines are constants: no sheet value, level, XP or store error text (`src/state/service.ts` comment).

## Failure modes

| Failure | Effect | Evidence |
|---|---|---|
| Postgres down | events wait in the stream (naks, no cap) until `max_age` 30 days | `src/consumer.ts` `MAX_DELIVER` |
| Stream reaches 2 GiB | oldest messages dropped by JetStream, stored or not | `src/config.ts` `maxBytes` |
| Poison message | one DLQ entry and an ALERT line | `src/consumer.ts` |
| Two sink replicas | can race on the first insert of an intent or action; the loser's redelivery merges. Compose runs one sink | `src/projection.ts` header |
| `events` table growth | nothing prunes it; open follow-up | `eventsink/README.md` "Retention of the Postgres events table" |
| Bad `GELDAR_PROFICIENCY_THRESHOLDS` | startup fails before any connection | `src/main.ts`; `src/xp/xp-config.ts` |

## Security and privacy

- The Postgres and NATS passwords come from files named by `*_PASSWORD_FILE`, never from plain variables; a credential is never logged (`src/config.ts`; `src/nats-credentials.ts`).
- NATS user `eventsink` may publish only `geldar.<s>.dlq`, `geldar.<s>.state.>` and the JetStream API, and subscribe to `geldar.<s>.state.*.proficiency` and inboxes (`geldar.ps1` line 393). It is the only user allowed to publish a level push.
- The sink connects to Postgres as `POSTGRES_USER` (default `geldar`, the bootstrap superuser per decision 0133); no separate sink role exists (`sql/0060_turn_records.sql` header).
- The proficiency reply carries no sheet (`src/state/pg-state-store.ts`).

## Retirement and reset

The sink holds no state of its own beyond the durable consumer `eventsink` on `GELDAR_EVENTS`. Erasing a life's rows is done by `register_account_delete` and `sheet_erase_life` in Postgres ([database schema](database-schema.md#data-retention-and-erasure)), not by the sink.

## Conflicts and open points

1. **Redelivery cap.** Decision 0041 item 2 says transient failures are dead-lettered on the last allowed delivery, `max_deliver` 20. The code sets `MAX_DELIVER = -1` and never dead-letters a transient failure (`src/consumer.ts`; commit 26605a6f "transient errors never dead-letter an event"). No later decision record found by `git grep -l max_deliver -- docs/decisions` (only 0041). The README follows the code. Recorded, not resolved.
2. **README scope.** `eventsink/README.md` does not describe the audit projection, the XP ledger, the state service, the outbox, metrics or NATS credentials, and its "Configuration" section says "Phase 0 has one open NATS on the compose network; per-service accounts arrive later (spec 6.5)", while `src/nats-credentials.ts` and `compose/nats-auth.yml` already provide the `eventsink` user. Documentation debt.
3. **"Not wired" comments.** `src/state/service.ts` and `src/xp/outbox.ts` headers say `main.ts` does not start them; `src/main.ts` does when `GELDAR_SHEET_SHARD` is set.
4. **`thought_id` wording.** The README says `thought_id` stays null in `intents`; `src/projection.ts` says Animus sets it with its own UPDATE and the projection keeps it (COALESCE). The code comment is the newer statement.
