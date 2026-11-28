# 0455. Experience-record rows follow the erasure rule and the append-only pattern

- Status: Accepted (owner ruling 2026-11-28 relayed via geldar-69)
- Date: 2026-11-27
- Spec: none. `docs/spec.md` is not touched.
- Source: `docs/analysis/sheet/memory-spine-design.md`, section 5, question Q3.
- Related: 0323 (erasure with the life), 0085 (append-only pattern), 0454.

## Decision

1. **Experience rows are erased with the life**, as 0323 says for the life's records.
2. **Experience rows are append-only**, as 0085 does for its tables.
3. **The per-world cap on heard-and-read text is not set here.** The design says it is the owner's value and the value is still open. MS-G2 cannot ship with a cap it does not have.

## Why

The record is built from what an agent did and heard. Erasing it with the life keeps it in step with the rest of the life's data, and append-only rows keep the record auditable.

## Consequences

- MS-G1 adds the experience rows to the erase functions named in 0323.
- MS-G2 needs the owner's heard-and-read cap before it merges.
