# 0456. An agent reads only its own experience record

- Status: Accepted (owner ruling 2026-11-28 relayed via geldar-69)
- Date: 2026-11-27
- Spec: none. `docs/spec.md` is not touched.
- Source: `docs/analysis/sheet/memory-spine-design.md`, section 5, question Q4.
- Related: 0058 (knowledge boundary), 0391 item 4 (no ids in agent text), 0454.

## Decision

1. **An agent reads only its own experience record.** The read is keyed on the authenticated life, as in MS-G1.
2. **Operators read the record through the database,** not through an agent tool.
3. **No agent reads another agent's record.**
4. The MCP read tool's name, parameters and description are agent-visible text. They are not decided here. They go through the agent-visible text scan (`contract/test/agent-visible-text.test.ts`) and their wording needs its own ruling (see the agent-visible list in the MS-G2 report).

## Why

The record holds what an agent did, saw and heard. Letting an agent read another agent's record would give it knowledge the world did not give it (0058).

## Consequences

- MS-G2 has no parameter that names another life.
- A test for MS-G2 must show that a read with another life's key returns nothing.
