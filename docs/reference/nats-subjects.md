---
title: NATS subjects
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [README.md, contract-schemas.md, eventsink.md, glossary.md, ../architecture/data-flow-events.md, ../architecture/nats-topology.md, ../security/authn-authz-map.md, ../runbooks/nats-auth-inplace.md, ../runbooks/body-helper-node-steps.md]
sources: [contract/src/subjects.ts, contract/src/index.ts, contract/test/state-subject.test.ts, geldar.ps1, eventsink/src/config.ts, eventsink/src/consumer.ts, eventsink/src/validate.ts, eventsink/src/state/service.ts, eventsink/src/xp/outbox.ts, player-core/src/link/nats-event-source.ts, player-core/src/link/mind-event.ts, golem/src/adam/adam-body.ts, golem/src/perception/hurt-trigger.ts, threshold/mcp/src/events/stream.ts, threshold/mcp/src/presence.ts, golem/src/registry.ts, golem/src/body/checkpoint.ts, golem/src/body/generation.ts, golem/src/ensure-skins-bucket.ts, plugin/core/src/main/java/dev/geldar/core/EventExporter.java, plugin/core/src/main/java/dev/geldar/core/kino/NatsKinoControl.java, plugin/core/src/main/java/dev/geldar/core/kino/NatsKinoSink.java, plugin/core/src/main/java/dev/geldar/core/proximity/NatsHearingSink.java, plugin/core/src/main/java/dev/geldar/core/blockowner/NatsBlockOwnerLink.java, plugin/core/src/main/java/dev/geldar/core/maintenance/NatsMaintenanceSubscriber.java, plugin/velocity-identity/src/main/java/dev/geldar/identity/RegistryClient.java, plugin/velocity-identity/src/main/java/dev/geldar/identity/SkinRegistry.java, glass/src/kino/nats-feed.ts, supervisor/src/nats.ts, threshold/register/src/nats-ctl.ts]
---

# NATS subjects

Every NATS subject, stream, consumer and KV bucket Geldar uses: the subject builders in `contract/src/subjects.ts`, the subjects built elsewhere, which NATS user may publish or subscribe to each, and the JetStream objects behind them. Checked at 1b114276 on 2026-11-16 from the repository only; nothing was read from a running NATS server (plan decision D8).

For the message bodies, see [contract schemas](contract-schemas.md). For how events flow end to end, see [data-flow-events](../architecture/data-flow-events.md). For users and accounts as a topology, see [nats-topology](../architecture/nats-topology.md) and [authn-authz-map](../security/authn-authz-map.md).

## Token rules

| Rule | Value | Evidence |
|---|---|---|
| Prefix | Every Geldar subject starts `geldar.<shard>.` | `contract/src/subjects.ts`; `geldar.ps1` `Get-NatsUsers` comment |
| Shard token | `^[a-z][a-z0-9-]{1,31}$` (same as `ShardName` in `common.schema.json`) | `subjects.ts` constant `SHARD` |
| Life id token | `^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$` (same as `LifeId` in `common.schema.json`) | `subjects.ts` constant `LIFE_ID` |
| Refusal | Each builder throws on a token that fails its pattern, so no caller can add a dot, wildcard or space | `subjects.ts` `checked` |
| Event subjects | Three tokens, `geldar.<shard>.<type>`, captured by the stream filter `geldar.*.*` | `eventsink/src/config.ts` `STREAM_CONFIG` |
| Non-event subjects | Four or five tokens, so outside `geldar.*.*`; the event sink never sees them. One exception: `geldar.<shard>.maintenance` has three tokens | `subjects.ts` header and `maintenanceSubject` comment |

## Builders in `contract/src/subjects.ts`

Re-derive the list:

```powershell
git grep -nE '^export (function|const)' -- contract/src/subjects.ts
```

On 2026-11-16 at 1b114276 the file exports 17 functions and constants.

| Export | Subject or value | Pattern | Request body / reply | Decision or card |
|---|---|---|---|---|
| `snapshotSubject(shard, lifeId)` | `geldar.<shard>.body.<life_id>.snapshot` | request/reply | `SnapshotRequest` / `Snapshot` | 0025 (spec 5.3.2) |
| `planSubject(shard, lifeId)` | `geldar.<shard>.body.<life_id>.plan` | request/reply | `PlanMessage` / `PlanAck` | 0025 |
| `bookSubject(shard, lifeId)` | `geldar.<shard>.body.<life_id>.book` | request/reply | `BookRequest` / `BookReply` | WM-01, WM-07 |
| `viewImageSubject(shard, lifeId)` | `geldar.<shard>.body.<life_id>.image` | request/reply | image request / base64 PNG and caption, or `{"error":"view_unavailable","detail":...}` | 0156 (VP-2) |
| `viewSubject(shard, lifeId)` | `geldar.<shard>.body.<life_id>.view` | request/reply | `ViewInput` / `ViewResult` or `{"error":"unavailable"}` | view-tool packet |
| `hearingSubject(shard, lifeId)` | `geldar.<shard>.body.<life_id>.hearing` | publish | `heard_muffled` notice (`heard-muffled-event.schema.json`) | 0199 |
| `PRESENCE_BUCKET` | `geldar-presence` (KV bucket name) | KV | `PresenceRecord` per life id | WM-01 |
| `blockownerQuerySubject(shard)` | `geldar.<shard>.blockowner.query` | request/reply | `BlockOwnerQuery` / `BlockOwnerReply` | 0165 |
| `blockownerChangedSubject(shard)` | `geldar.<shard>.blockowner.changed` | publish | `BlockOwnerChanged` | 0165 |
| `maintenanceSubject(shard)` | `geldar.<shard>.maintenance` | publish | `MaintenanceNotice` | CD-1 |
| `CTL_BODY_OPS` | `start`, `stop`, `restart`, `status`, `logtail` | constant | none | 0152; kept equal to `OPS` in `supervisor/src/ports.ts` by a supervisor test |
| `ctlBodySubject(shard, op)` | `geldar.<shard>.ctl.body.<op>`, `op` in `CTL_BODY_OPS` | request/reply | owner body control request | 0152 item 3 |
| `ctlBodyWildcard(shard)` | `geldar.<shard>.ctl.body.>` | subscription | none | 0152 |
| `proficiencyRequestSubject(shard, lifeId)` | `geldar.<shard>.state.<life_id>.proficiency` | request/reply | `ProficiencyRequest` / `ProficiencyState` | 0280 (AN-02b) |
| `proficiencyPushSubject(shard, lifeId)` | `geldar.<shard>.state.<life_id>.level` | publish | `ProficiencyLevelPayload` | 0280 (AN-02b) |
| `stateWildcard(shard)` | `geldar.<shard>.state.>` | subscription | none | 0280 |

`contract/src/index.ts` re-exports every builder above except `proficiencyRequestSubject`, `proficiencyPushSubject` and `stateWildcard`. No production code imports those three. Tests deep-import them from `contract/src/subjects.ts`: `contract/test/state-subject.test.ts`, `eventsink/src/state/service.test.ts`, `eventsink/src/xp/outbox.test.ts`, `eventsink/test/state.it.test.ts` and `golem/src/character/proficiency-cache.test.ts`. `eventsink/src/state/service.ts` copies the two patterns, and its test compares them with the contract helpers (comment in `service.ts`). Re-derive (on 2026-11-16 at 1b114276 every hit outside `contract/src/subjects.ts` is in one of those five test files):

```powershell
git grep -nE 'proficiencyRequestSubject|proficiencyPushSubject|stateWildcard' -- . ':!docs'
```

## Subjects built outside `subjects.ts`

| Subject | Pattern | Built in | Body | Evidence |
|---|---|---|---|---|
| `geldar.<shard>.<type>` | publish into `GELDAR_EVENTS` | Each producer's event publisher; the type is the `WorldEvent.type` | `WorldEvent` (`event.schema.json`) | `eventsink/src/validate.ts` (subject must equal `geldar.<shard>.<type>`); decision 0041 |
| `geldar.<shard>.dlq` | publish into `GELDAR_EVENTS` | `eventsink/src/consumer.ts` `dlqSubject` | dead-letter body `{ reason, subject, data, data_bytes, data_truncated }` | [eventsink](eventsink.md#dead-letters) |
| `geldar.<shard>.sovereign_call` | publish into `GELDAR_EVENTS` | `threshold/mcp` | `SovereignCallPayload` | `geldar.ps1` `mcp` user; `sovereign-call-event.schema.json` |
| `geldar.<shard>.helper.body.<verb>`, verb `start`, `stop`, `status`, `logtail` | request/reply | supervisor (requester), body helper (responder) | helper request | `geldar.ps1` lines 408 to 413 (C7-03c1, decision 0260) |
| `$KV.<bucket>.>` | KV put and get | NATS KV client | per bucket, below | `geldar.ps1` `$kv` helper |
| `$JS.API.>`, `$JS.ACK.>`, `$JS.FC.>` | JetStream API, acks, flow control | NATS clients | none | `geldar.ps1` `$js` list and `velocity` user |
| `_INBOX.>` | request/reply inboxes | NATS clients | reply bodies | every user in `geldar.ps1` |

The Kino subjects belong to the observation side (decision [0075](../decisions/0075-glass-is-a-lakitu-camera.md)). Their names, publishers and permissions are not listed on this page (decision [0361](../decisions/0361-agents-never-placement-and-public-detail.md)); the tables below write "Kino subjects" where they occur.

## World event types on `geldar.<shard>.<type>`

The type token matches `^[a-z][a-z_]{0,47}$` (`event.schema.json`, property `type`). Spec section 7 lists `thought`, `speech`, `action`, `damage`, `death`, `birth`, `trade`, `book_written`, `book_read`, `skill_defined`, `offering`, `proposal`, `vote`, `law`, `sleep`, `reflection`, `server_tps`. The type `dlq` is reserved (decision 0041 item 1), and `maintenance` is a three-token subject that carries no event (`eventsink/src/validate.ts` `NON_EVENT_TYPES`).

Types with their own payload schema in `contract/schemas` (see [contract schemas](contract-schemas.md)):

| Type | Payload schema | Producer named in the schema or code |
|---|---|---|
| `intent` | `intent-event.schema.json` | Body |
| `action` | `action-record.schema.json` | Body |
| `receipt` | `receipt.schema.json` | Body |
| `reflex_fired` | `reflex-fired-event.schema.json` | Body |
| `wake` | `wake-event.schema.json` | Body |
| `plan_result` | `plan-result-event.schema.json` | Body |
| `action_outcome` | `action-outcome-event.schema.json` | Body |
| `speech` | `speech-event.schema.json` | Body |
| `heard_sound` | `heard-sound-event.schema.json` | Body (`golem/src/adam/adam-body.ts` line 146; `golem/src/perception/heard-sound-event.ts`); the Mind reads it (`player-core/src/link/mind-event.ts`, `MIND_EVENT_TYPES`) |
| `chunk_visited` | `chunk-visited-event.schema.json` | Body (`golem/src/body/evidence/chunk-visits.ts`) |
| `thought` | `thought-event.schema.json` | Mind |
| `death` | `death-event.schema.json` | Geldar-Core plugin (`EventExporter.java`) |
| `day_night` | `day-night-event.schema.json` | MCP |
| `sovereign_call` | `sovereign-call-event.schema.json` | MCP |
| `roll`, `decision`, `sheet_adopted` | `roll-event`, `decision-event`, `sheet-adopted-event` | Body (`golem/src/character/audit-publisher.ts`) |
| `turn_record` | `turn-record-event.schema.json` | none yet: the schema says nothing may emit it until GX-05b |

The Geldar-Core plugin emits `server_tps`, `damage`, `death` and `sleep` (re-derive: `git grep -nE 'emit\("[a-z_]+"' -- plugin/core/src/main`).

The Body also publishes `damage` (`golem/src/adam/adam-body.ts` line 325). Its payload is the `source`, `amount` and optional `bearing` of `hurt-event.schema.json`, without that schema's `type: "hurt"` field (`hurtWorldEvent` in `golem/src/perception/hurt-trigger.ts`). No subject carries a `hurt` type: the code searched at 1b114276 builds the hurt event only in `golem/src/perception/hurt.ts` and maps it to `damage`. The Mind checks a `damage` payload only for being an object (`mind-event.ts`, `freeForm`).

## Who may publish and subscribe

The per-user permissions come from `Get-NatsUsers` in `geldar.ps1` (lines 367 to 415), the generator `./geldar.ps1 shard nats-auth` writes into the git-ignored server configuration (decisions 0067 and 0087). A deny entry wins over an allow entry in nats-server (comment at `geldar.ps1` line 351). `<s>` is the shard. Re-derive with:

```powershell
Select-String -Path geldar.ps1 -Pattern '^\s+(body|mind|eventsink|mcp|velocity|paper|kino|deploy|supervisor|register|helper) = @\{' -Context 0,4
```

| User | Publish allow | Publish deny | Subscribe allow |
|---|---|---|---|
| `body` | `geldar.<s>.>`; JetStream API; KV `geldar-life-registry`, `geldar-checkpoints`, `geldar-body-generation`, `geldar-skins` | Kino subjects, `geldar.<s>.blockowner.changed`, `geldar.<s>.ctl.body.>`, `geldar.<s>.helper.body.>`, `geldar.<s>.state.*.level`, `geldar.<s>.body.*.hearing` | `geldar.<s>.body.>`, `geldar.<s>.blockowner.changed`, `geldar.<s>.state.*.level`, `_INBOX.>` |
| `mind` | `geldar.<s>.` + `wake`, `intent`, `action`, `plan_result`, `reflex_fired`, `speech`, `damage`, `death`, `sleep`; JetStream API; `geldar.<s>.body.>` | `geldar.<s>.body.*.hearing` | `_INBOX.>` |
| `eventsink` | `geldar.<s>.dlq`, `geldar.<s>.state.>`; JetStream API | none | `geldar.<s>.state.*.proficiency`, `_INBOX.>` |
| `mcp` | `geldar.<s>.sovereign_call`, `geldar.<s>.body.>`, KV `geldar-presence`; JetStream API | `geldar.<s>.body.*.hearing` | `_INBOX.>` |
| `velocity` | JetStream stream info and consumer create, info and delete on `KV_geldar-life-registry` and `KV_geldar-skins`; `$JS.FC.>`; `_INBOX.>` | none | `_INBOX.>` |
| `paper` | `geldar.<s>.>`; JetStream API | Kino subjects, `geldar.<s>.blockowner.query`, `geldar.<s>.ctl.body.>`, `geldar.<s>.helper.body.>`, `geldar.<s>.state.*.level` | Kino subjects, `geldar.<s>.maintenance`, `geldar.<s>.blockowner.query`, `_INBOX.>` |
| `kino` | Kino subjects | none | Kino subjects, `_INBOX.>` |
| `deploy` | `geldar.<s>.maintenance` | none | `_INBOX.>` |
| `supervisor` | `_INBOX.>`; `geldar.<s>.helper.body.start`, `.stop`, `.status`, `.logtail` | none | `geldar.<s>.ctl.body.>`, `_INBOX.>` |
| `register` | `geldar.<s>.ctl.body.>` | none | `_INBOX.>` |
| `helper` | `_INBOX.>` | none | `geldar.<s>.helper.body.start`, `.stop`, `.status`, `.logtail` |

"JetStream API" is `$JS.API.>`, `$JS.ACK.>` and `_INBOX.>`; "KV `<b>`" is `$KV.<b>.>` (`geldar.ps1` lines 372 to 373). Every user is created with `allow_responses: true` (line 358).

No role is scoped to one life: a life is not known when the file is written, so each application checks its own life's subjects (`geldar.ps1` line 369). The gated runbook [body-helper-node-steps](../runbooks/body-helper-node-steps.md) restates the `helper` and `supervisor` lists and the `helper.body.>` deny; `tools/repo-checks/src/nats-auth-runbook.test.ts` keeps them equal.

## Subscribers and responders per subject

From the code at 1b114276 (re-derive each row with `git grep -n <builder> -- . ':!docs' ':!contract'`).

| Subject | Publisher or requester | Subscriber or responder |
|---|---|---|
| `body.<life>.snapshot`, `body.<life>.plan` | Mind (`player-core/src/link/nats-body-link.ts`); bench life CLI (`golem/src/bench/sheet/life-cli.ts`) | Body (`golem/src/mind-link/server.ts`) |
| `body.<life>.book` | MCP (`threshold/mcp/src/body-gateway.ts`) | Body (`golem/src/books/book-server.ts`) |
| `body.<life>.image` | MCP (`body-gateway.ts`) | Body (`golem/src/body-image/image-serve.ts`) |
| `body.<life>.view` | MCP (`body-gateway.ts`) | Body (`golem/src/mind-link/server.ts`) |
| `body.<life>.hearing` | Geldar-Core plugin (`NatsHearingSink.java`) | not found by name in TypeScript at 1b114276 (the `body` user may subscribe through `geldar.<s>.body.>`) |
| `blockowner.query` | Body (`golem/src/body/block-owners.ts`) | Geldar-Core plugin (`NatsBlockOwnerLink.java`) |
| `blockowner.changed` | Geldar-Core plugin | Body (`block-owners.ts`) |
| `maintenance` | Deploy: `deploy/colo-notice.sh` runs `golem/src/publish-maintenance-notice.ts` in the one-shot admin container as user `deploy` | Geldar-Core plugin (`NatsMaintenanceSubscriber.java`); MCP (`threshold/mcp/src/events/stream.ts`); the event sink acks and skips it |
| `ctl.body.<op>` | Register service (`threshold/register/src/nats-ctl.ts`) | Supervisor (`supervisor/src/nats.ts`, `ctlBodyWildcard`) |
| `helper.body.<verb>` | Supervisor | Body helper |
| `state.<life>.proficiency` | Body | Event sink state service, queue group `state-service` (`eventsink/src/state/service.ts`) |
| `state.<life>.level` | Event sink outbox publisher (`eventsink/src/xp/outbox.ts`) | Body |

## Streams and consumers

| Stream | Subjects | Storage | Retention | Created by | Evidence |
|---|---|---|---|---|---|
| `GELDAR_EVENTS` | `geldar.*.*` | file | limits: `max_age` 30 days, `max_bytes` 2147483648 (2 GiB), oldest first at the cap | The Geldar-Core plugin or the event sink, whichever starts first; an existing stream keeps its limits | `eventsink/src/config.ts` `STREAM_CONFIG`; `eventsink/src/consumer.ts` lines 216 to 223; decision 0041 |
| `KV_<bucket>` | one per KV bucket below | NATS KV default | per bucket | the bucket's creator | `geldar.ps1` `velocity` user names `KV_geldar-life-registry`, `KV_geldar-skins` |

| Consumer | Stream | Kind | Settings | Evidence |
|---|---|---|---|---|
| `eventsink` | `GELDAR_EVENTS` | durable pull | explicit ack, `ack_wait` 30 s, `max_deliver` -1, filter `geldar.*.*` | `eventsink/src/consumer.ts` lines 236 to 250 |
| Mind event feed | `GELDAR_EVENTS` | ordered, delivers from start time | `filter_subjects` per subscribed life | `player-core/src/link/nats-event-source.ts` |
| MCP event stream | `GELDAR_EVENTS` | replays from `replayMinutes` before now | the Mind's types plus `sovereign_call`, `day_night` and `maintenance`; `sovereign_call` and `turn_record` never reach a player's log (`SINK_ONLY_TYPES`) | `threshold/mcp/src/events/stream.ts` lines 15 to 37 |

## KV buckets

| Bucket | Key | Value | Writer | Readers | Evidence |
|---|---|---|---|---|---|
| `geldar-presence` | life id | `PresenceRecord` | MCP (`threshold/mcp/src/presence.ts`) | player host (`golem/src/players/main.ts`, `managed-main.ts`); `tools/players-cli/src/rangers-presence.ts` | `contract/src/subjects.ts` `PRESENCE_BUCKET` |
| `geldar-life-registry` | lower-cased username | registry record; a key expires a TTL after its last put (`REGISTRY_TTL_MS`) | Golem (`golem/src/registry.ts`, creates the bucket) | Velocity identity plugin (`RegistryClient.java`, watch only) | `golem/src/registry.ts` line 9 |
| `geldar-checkpoints` | life id | running-intent checkpoint | Body | Body | `golem/src/body/checkpoint.ts` line 10; decision 0043 |
| `geldar-body-generation` | life id | `body_generation` counter | Body | Body | `golem/src/body/generation.ts` line 4 |
| `geldar-skins` | life id | skin record (JSON) | `tools/players-cli` (`skin-store.ts`); created by `golem/src/ensure-skins-bucket.ts`, run by the admin container as the `body` user | Velocity identity plugin (`SkinRegistry.java`, read only) | `golem/src/ensure-skins-bucket.ts` lines 1 to 10 |

Re-derive the bucket names:

```powershell
git grep -nE "['\"]geldar-(presence|life-registry|checkpoints|body-generation|skins)['\"]" -- '*.ts' '*.java' geldar.ps1
```

## Conflicts and open points

1. **Stale "not wired" comments.** `eventsink/src/state/service.ts` (header) and `eventsink/src/xp/outbox.ts` (header) say `main.ts` does not start them and "AN-12 owns that wiring". `eventsink/src/main.ts` starts both through `startShardServices` when `GELDAR_SHEET_SHARD` is set (`eventsink/src/sink-plan.ts`). The code wires them; the comments predate it. Recorded, not resolved.
2. **Hearing subscriber.** No TypeScript file names `hearingSubject` or the `.hearing` suffix outside the contract at 1b114276. The plugin publishes it; whether a Body consumes it was not found. Unverified.
3. **Hearing publish deny.** `subjects.ts` (comment on `hearingSubject`) says the body, mind and mcp roles "can all publish it today" and that the deny is a later change (MH-CH). `geldar.ps1` already denies `geldar.<s>.body.*.hearing` to all three. The comment is older than the generator; what the node runs is unverified (D8).

## Related

- [Contract schemas](contract-schemas.md): every message body named here.
- [Event sink](eventsink.md): the consumer of `GELDAR_EVENTS`, the DLQ and the state subjects.
- [nats-auth-inplace](../runbooks/nats-auth-inplace.md): applying the users on a node.
- [Glossary](glossary.md): life, Body, Mind, shard.
