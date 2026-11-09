# 0026. Phase 0 is one database per shard

- Status: Accepted
- Date: 2026-11-08
- Spec: section 7 (events), Appendix D (`events`)

## Decision

In Phase 0 each shard has its own Postgres database. `WorldEvent.shard` is required in the contract, but the `events` table has no `shard` column. The event sink checks the field against the shard it serves and does not store it.

## Why

Appendix D's `events` has no shard column and Phase 0 runs one shard. The contract still carries the shard because it is part of the NATS subject `geldar.<shard>.<type>`.

## Consequences

- Revisit before Phase 1 if one database ever serves more than one shard; that adds a `shard` column in a new migration.
- Noted in `sql/README.md`.
