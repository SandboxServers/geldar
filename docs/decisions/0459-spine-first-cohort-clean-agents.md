# 0459. The first memory-spine cohort is clean agents with no seeded charters

- Status: Accepted (owner ruling 2026-11-28 relayed via geldar-69)
- Date: 2026-11-27
- Spec: none. `docs/spec.md` is not touched.
- Source: `docs/analysis/sheet/memory-spine-design.md`, section 5, question Q9, and section 4 rule 6.
- Related: KT7 (the rangers' bonds written into them), 0391, 0457.

## Decision

1. **The first cohort is clean agents,** with no seeded charters.
2. **The rangers are not in the first cohort.** Their seeded memory is not edited, as section 4 rule 6 says.

## Why

Seeded charters make a later memory use hard to attribute: a fact used in session three could come from the charter and not from the spine. Clean agents keep the planted fact the only source.

## Consequences

- The first test-shard run uses clean agents only.
- A later cohort with seeded charters (the rangers) needs its own record.
