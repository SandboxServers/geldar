# 0381. Amends 0041: the event export stream is per shard

- Status: Proposed (lead-accepted 2026-11-17; owner to confirm)
- Date: 2026-11-17
- Spec: section 7 (event bus), Appendix F (event export); amends `docs/decisions/0041-event-export-stream-and-sink.md`

## Decision

Decision 0041 says every event goes to one JetStream stream, `GELDAR_EVENTS`, with subjects `geldar.*.*`. That stays true for the colo shard. For any other shard the stream is per shard:

- The stream name is `GELDAR_EVENTS_<TOKEN>`, where `<TOKEN>` is the shard token upper-cased with `-` turned into `_`. For `nf`: `GELDAR_EVENTS_NF`. For `nf-scratch`: `GELDAR_EVENTS_NF_SCRATCH`.
- The subject filter is `geldar.<token>.*` on that shard's own NATS.
- The durable consumer is still `eventsink`; durable names are scoped to a stream.
- The Nats-Msg-Id dedup header, the reserved `dlq` type, the 20-delivery limit, the sink's reconnect and the 30-day retention of 0041 are unchanged. The per-shard stream keeps the same retention and size defaults.

0041's own text is not edited. Its record stays as written. This record is the amendment, cited by path from 0041, the same way 0371 and 0372 amend 0071 and 0096. The repo's convention for amendments (0371, 0372) is a standalone record that names the amended record in its title; no pointer line is added to 0041. If the owner wants a pointer line in 0041, that is a one-line edit they can ask for.

## Why

Per-shard NATS and database (record 0380) mean one stream cannot serve two shards without overlap. A stream per shard keeps the filter exact.

## Consequences

- The stream configuration becomes a setting, not one constant in the sink and one in the plugin. The defaults equal the colo values, so colo is unchanged.
- `stream-config.test.ts` pins the defaults and the `nf` case together, and reads the plugin source and both READMEs.
- The `consuming GELDAR_EVENTS` log line stays for the default; CI greps it.
- A stream-name collision on a shared NATS is impossible by construction, because each shard has its own NATS (record 0380).
