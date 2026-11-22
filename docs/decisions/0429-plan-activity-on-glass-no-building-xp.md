# 0429. Plan activity may appear on Glass for humans; building earns no XP

- Status: Accepted (owner, 2026-11-22)
- Date: 2026-11-22
- Spec: section 2 principle 4; decisions 0410 to 0412 (Glass). Project rule: agents are never told they are watched; telemetry never reaches agents.

## Decision

1. Building and plan activity earns no proficiency or XP.
2. The human-facing Glass pages may show plan activity (counts, phase, failure codes), fed by operator events. The seen-block map is never shown on Glass.
3. A hard test (packet BLD-37, with the fence of BLD-19) proves that no plan or seen-map datum reaches an agent-readable path.

## Consequences

- Packet BLD-37 (`glass/**`, a colo-images path that restarts the Bodies) lands in window R3.
