# 0458. Body perception memory (BD18) is a separate card, not a blocker for the exit test

- Status: Accepted (owner ruling 2026-11-28 relayed via geldar-69)
- Date: 2026-11-27
- Spec: none. `docs/spec.md` is not touched.
- Source: `docs/analysis/sheet/memory-spine-design.md`, section 5, question Q8, and section 1.2 (BD18).
- Related: 0391 (memory spine), 0457.

## Decision

1. **BD18 (Body perception memory persisted per life) is not part of the memory-spine exit test.** It gets its own card.
2. **The exit test does not wait for BD18.** The spine cards (MS-G0 to MS-G5, MK0 to MK6) do not depend on it.

## Why

BD18 is process memory in the Body and is lost at restart. It sits next to the spine but is a different memory from the agent's. Making the exit test wait for it would delay the spine for a fix the test does not need.

## Consequences

- No spine card lists BD18 as a dependency.
- BD18 is tracked as its own card, to be sized and ordered separately.
