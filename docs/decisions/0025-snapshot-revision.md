# 0025. Snapshots and action records carry a revision

- Status: Accepted
- Date: 2026-11-08
- Spec: Appendix A (snapshot), Appendix D (`actions`), section 5.3.2 (attention controller)

## Decision

- `Snapshot` has a required integer `revision` (at least 0), the revision the attention controller compares a plan against.
- `ActionRecord` has a required `snapshot_revision` (integer, at least 0), the snapshot `revision` the plan was made from. The `actions` table has a matching `snapshot_revision BIGINT` column.

## Why

Section 5.3.2 has the Body compare a plan's snapshot revision with its current one so a stale plan is dropped, but Appendix A and Appendix D name no field for it. Without the field the comparison has nothing to read.

## Consequences

- `contract/schemas/snapshot.schema.json`, `contract/schemas/action-record.schema.json` and `sql/0001_init.sql` differ from the appendices here; the schemas are the source of truth.
- The spec appendices are not rewritten; this record is the correction.
