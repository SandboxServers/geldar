# 0027. The database enforces one final receipt per action

- Status: Accepted
- Date: 2026-11-08
- Spec: section 7, Appendix D (`receipts`); extends [0020](0020-receipts.md)

## Decision

Decision 0020 says every action ends with exactly one final receipt. `sql/0001_init.sql` now enforces it:

- `receipts.action_id` is `NOT NULL`.
- `receipts.phase` has a `CHECK` limiting it to `prepared`, `committed` and `aborted`.
- A partial unique index allows at most one `committed` or `aborted` receipt per `action_id`; `prepared` rows are not counted.
- `actions.state` has a `CHECK` matching the contract's states.

`sql/test/check-schema.sql` proves each by inserting rows and rolling back.

## Why

`UNIQUE (action_id, phase)` alone lets one action hold both a `committed` and an `aborted` receipt, and a null `action_id` escapes it. The Mind credits on a `committed` receipt, so a retry race writing both would double-count.

## Consequences

- `sql/0001_init.sql` differs from Appendix D here and says so in comments.
- 0020 is not rewritten; this record adds to it.
