# 0067. NATS accounts and least-privilege users, opt-in until the stack is cut over

- Status: Accepted provisionally (orchestrator, owner may revise)
- Date: 2026-11-10
- Spec: 6.5 (per-service NATS accounts), 5.3.2 (Body-Mind channel), 7 (event stream)
- Decision: WM-10b
- Packet: fix/a2-nats-accounts (red-team and scale reviews)
- Worknote: docs/analysis/phase0/worknotes/fix-a2.md

## Context

`compose/phase0.yml` runs NATS as `-js -sd /data -m 8222` with no accounts. Any process on the
compose network, and any local process that reaches 127.0.0.1:4222, can publish plans on
`geldar.<shard>.body.<life>.plan`, request snapshots, write the `geldar-life-registry` bucket that the
Velocity login gate trusts to admit usernames, and forge events on `GELDAR_EVENTS`. The MCP container
joins the same open NATS with no credentials (`compose/mcp.yml`), and the MCP is the only service
meant to be reachable from outside. A compromised MCP would therefore control every life.

## Decision

One NATS account, `GELDAR`, with JetStream enabled. Each component gets its own user with
per-subject `publish.allow` and `subscribe.allow` lists. The server config is generated, never
committed. The overlay is opt-in: the default dev stack keeps its open NATS.

The users below were derived from the code, not from the spec alone. Subjects are built in
`contract/src/subjects.ts` (`snapshotSubject`, `planSubject`, `bookSubject`, `PRESENCE_BUCKET`) and in
the call sites named in each row.

### Subjects and buckets used today

| Subject or bucket | Pattern | Used by |
| --- | --- | --- |
| Events | `geldar.<shard>.<type>` (3 tokens, in `GELDAR_EVENTS` via `geldar.*.*`) | Paper plugin (`plugin/core` NatsEventPublisher), Body (`golem/src/body/records-nats.ts`), Mind (`animus/src/link/nats-publisher.ts`) |
| Sink dead letters | `geldar.<shard>.dlq` | eventsink (`eventsink/src/consumer.ts`) |
| Mind event feed | ordered consumer on `GELDAR_EVENTS`, filter `geldar.<shard>.<mind types>` | Mind (`animus/src/link/nats-event-source.ts`, `mind-event.ts`) |
| Replay | consumer on `GELDAR_EVENTS`, filter on player subjects | MCP (`threshold/mcp/src/replay-source.ts`) |
| Snapshot request/reply | `geldar.<shard>.body.<life>.snapshot` | Mind requests, Body serves (`golem/src/mind-link/server.ts`) |
| Plan request/reply | `geldar.<shard>.body.<life>.plan` | Mind requests, Body serves |
| Book request/reply | `geldar.<shard>.body.<life>.book` | MCP requests (`threshold/mcp/src/body-gateway.ts`), Body serves (`golem/src/books/book-server.ts`) |
| Sovereign calls | `geldar.<shard>.sovereign_call` (JetStream, `msgID`) | MCP (`threshold/mcp/src/cli.ts`) |
| KV `geldar-life-registry` | registry of usernames to lives | Golem writes (`golem/src/registry.ts`); Velocity reads and watches (`RegistryClient.java`) |
| KV `geldar-checkpoints` | body checkpoints | Body reads and writes (`golem/src/body/checkpoint.ts`, `restart.ts`) |
| KV `geldar-body-generation` | body generation counter | Body reads and writes (`golem/src/body/generation.ts`) |
| KV `geldar-presence` | presence per life | MCP writes its players' lives (`threshold/mcp/src/presence.ts`); players CLI reads (`tools/players-cli/src/rangers-presence.ts`) |
| KV `geldar-skins` | skin per life | players CLI writes (`tools/players-cli/src/skin-store.ts`); Velocity reads (`SkinRegistry.java`) |
| Stream admin | `GELDAR_EVENTS` create and info | Paper plugin (`ensureStream`), eventsink (`consumer.ts`), Mind and MCP (consumer create) |

### Users

Each user has an explicit list. Anything not listed is denied, and `_INBOX.>` is allowed for the
request and reply traffic each user actually makes.

- **body** (Golem Body hosts, `adam-body`, `players`, `restart`): publish `geldar.<shard>.*`
  (events and plan results); subscribe and serve `geldar.<shard>.body.<life>.{snapshot,plan,book}`
  for the lives it hosts, with `allow_responses`; KV read and write on `geldar-life-registry`
  (Golem creates it), `geldar-checkpoints`, `geldar-body-generation`. Not `geldar-presence`, not
  `geldar-skins`.
- **mind** (Animus): publish `geldar.<shard>.<mind types>`; request `geldar.<shard>.body.<life>.{snapshot,plan}`
  for its own life only; consume `GELDAR_EVENTS` with the mind filter. No KV, no Body subscribe.
- **eventsink**: consume `GELDAR_EVENTS` (its durable consumer, filter `geldar.*.*`); publish
  `geldar.<shard>.dlq`; stream info and consumer create on `GELDAR_EVENTS`. No KV, no body subjects.
- **mcp** (the only externally reachable service): publish `geldar.<shard>.sovereign_call`; request
  `geldar.<shard>.body.<life>.book` for the lives of its own players only; put and update
  `geldar-presence` for those lives; replay consumer on `GELDAR_EVENTS` with its player filter. It
  has NO write to `geldar-life-registry`, `geldar-checkpoints`, `geldar-body-generation`,
  `geldar-skins`, and NO publish on `geldar.<shard>.<event types>` or on other lives' subjects.
- **velocity** (identity plugin): KV read and watch on `geldar-life-registry` and `geldar-skins`; no
  write, because `RegistryClient` only watches and `SkinRegistry` only reads.
- **paper** (Geldar-Core publisher): publish `geldar.<shard>.<event types>`; stream info and create
  on `GELDAR_EVENTS` (`ensureStream`). No subscribe, no KV.
- **ops** (operator and admin, `players-cli` writes): full access to `GELDAR`, used by hand only.

### Lives scoping

The MCP and the Mind are scoped to lives in the subject itself (`body.<life>.book`,
`body.<life>.snapshot`). NATS permissions cannot express "this life only" unless the MCP's and the
Mind's users are created per life, so the Phase 0 overlay grants the subject pattern per shard and
the component enforces its own life list. This is a known gap, recorded in the threat model, and the
fix (per-life users or a subject-mapping account) is left for a later packet.

## JetStream permissions

NATS JetStream clients call `$JS.API.*` and KV uses `$KV.<bucket>.>` subjects, both of which need
explicit `publish` grants. The lists in the overlay (`compose/secrets/nats-auth.conf`, generated)
follow the NATS server and nats.js conventions as known to the author. They could not be verified
offline here: `nats-server` is not in `node_modules`, and nats.js docs are not vendored. The overlay
is therefore marked **untested against a live server**. Verifying it requires a live run with the
overlay on (see `docs/threat-model.md`, section on NATS).

## Consequences

- The default stack is unchanged. Only `compose/nats-auth.yml` (the overlay) and the generated
  `compose/secrets/nats-auth.conf` change behaviour.
- Each component reads `GELDAR_NATS_USER` and `GELDAR_NATS_PASSWORD` (or a credentials file path) when
  set, and connects unauthenticated when not set. The Java connects read the same variables.
- The Thinker websocket gets a shared secret (`animus/src/thinker/hub.ts`), because a client that
  knows the public model digest can reach it without NATS.

## Rejected alternatives

- A single shared user for all components. It gives no isolation, which is the problem.
- Per-life NATS users now. Too many moving parts before a live run; deferred.
- Relying on the compose network alone. Any container or process on that network is trusted today.
