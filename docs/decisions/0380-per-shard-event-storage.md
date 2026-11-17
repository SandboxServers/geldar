# 0380. Each shard has its own NATS, its own database and its own event sink

- Status: Proposed (lead-accepted 2026-11-17; owner to confirm)
- Date: 2026-11-17
- Spec: section 7 (event bus), Appendix D (`events`), Appendix F (event export); builds on 0026 and 0041

## Decision

1. Every shard that exports events runs its own NATS server, its own Postgres database and its own `eventsink` process. Nothing is shared between shards except the code.
2. The colo shard is unchanged: token `colo`, stream `GELDAR_EVENTS`, subjects `geldar.*.*` on its own NATS, database `geldar`, table `events`.
3. The live NeoForge shard has token `nf`, stream `GELDAR_EVENTS_NF` (subjects `geldar.nf.*`), durable consumer `eventsink`, database `geldar_nf` and table `events`. Its compose project is `geldar-nf` (record 0386).
4. Scratch has token `nf-scratch`, stream `GELDAR_EVENTS_NF_SCRATCH` (subjects `geldar.nf-scratch.*`) and database `geldar_nf_scratch`. The token must match `^[a-z][a-z0-9-]{1,31}$`.
5. The `events` table keeps its name and its columns in every database. No shard column is added.
6. Retention for the live NeoForge stream is 30 days and 2 GiB, the accepted defaults; the owner may change them. The database has no purge today. The purge is a documented, idempotent ops job with a runbook step, run under the lead's authorisation by an ops agent; it is not automatic. Its owner is an open assignment (the lead's operations; not yet a named person or agent).

This meets the owner's answer "separate stream and table per shard" as follows: each shard has its own stream (on its own NATS) and its own database, which holds its own `events` table.

## Why

- A shared NATS would put `geldar.nf.*` under the colo filter `geldar.*.*`, so the streams would overlap (JetStream overlap behaviour on the pinned server is UNVERIFIED; separate servers avoid the question).
- A shared database would project NeoForge events into colo's projection tables. Writers and foreign keys hard-code `events` (`sql/0051`, `sql/0062`, `sql/0040`).
- Decision 0026 already runs one database per shard; this extends the same shape to the NeoForge shard and to scratch.

## Consequences

- The sink and the plugin take the stream name and the subject filter from configuration; the defaults equal today's values (`docs/analysis/neoforge/per-shard-storage-design.md` section 3 and packets b1 to b5).
- A per-shard NATS needs its own user table (record 0383).
- Each NeoForge database runs migrations 0001 to 0066 from empty.
- The purge job is a new operational duty; until it exists, rows accumulate and the retention numbers apply to the stream only.
- The colo stream and table are untouched by this record.
