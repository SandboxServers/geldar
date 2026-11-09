# 0041. Events go to one JetStream stream with dedup headers, and the sink dead-letters what it cannot store

- Status: Accepted (made by the orchestrator in wave 3; see `docs/analysis/phase0/overnight-decisions.md` row 18)
- Date: 2026-11-09
- Spec: section 7 (event bus), Appendix D `events`, Appendix F (event export); decision D-P0-10

## Decision

1. Geldar-Core publishes every event as a `WorldEvent` on `geldar.<shard>.<type>` into the JetStream stream `GELDAR_EVENTS` (subjects `geldar.*.*`, file storage, 30-day retention), with the `Nats-Msg-Id` header set to `source_event_id`. The plugin never blocks the server thread: a bounded queue drops the oldest event and counts drops; a failed publish is requeued at the head; after repeated failures the sender reconnects and re-ensures the stream. The event type `dlq` is reserved.
2. `eventsink` consumes with a durable pull consumer, validates against the contract, inserts with `ON CONFLICT (source_event_id) DO NOTHING`, acks after commit, and sends anything it can never store (invalid, or a permanent database error of SQLSTATE class 22 or 23) to `geldar.<shard>.dlq` with the reason and a truncated body. Transient failures nak with backoff; on the last allowed delivery (`max_deliver` 20) the message is dead-lettered rather than silently dropped. The sink exits for a restart after 20 failed fetches.
3. Both sides use the maintained `@nats-io/*` 3.4.0 client packages (the `nats` package is deprecated upstream) and `jnats` on the JVM.

## Why

At-least-once delivery plus a producer-assigned id makes the Postgres write idempotent. A message that cannot be stored must be visible, not retried forever or lost.

## Consequences

- The stream configuration lives in one constant in the sink and one in the plugin; a sink test compares them with the plugin source and README.
- Dead letters are stored in the same stream (the sink skips its own).
