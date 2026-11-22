# 0421. A `break` action digs one named cell; the exact-cell dig of 0349 reaches agents

- Status: Accepted for the verb (owner ruling 2026-11-22, rulings 1 and 4); the wire shape is Proposed
- Date: 2026-11-22
- Spec: section 5 (Body API verbs). Supersedes the "program-only, kept out of the agent-visible schema" rule of 0349 (0349 stays Proposed; its status line becomes `Superseded by 0421` in packet BLD-06). Related: 0164, 0344.

## Decision

1. Add the Action `{do: "break", at: {x, y, z}}`. The Body digs exactly that cell or fails with a typed reason (`not_found`, `out_of_reach`, `unbreakable`, `unsafe`, `no_tool`, `not_loaded`); it never digs another block. `at` is an integer Position as in `place`.
2. `break` is built on the `mineAt` run option of 0349 and reuses the existing unbreakable list, the dig-safety refusal (a self-preservation rule, not a protection: falling columns, liquid, walled-in cells) and the tool choice.
3. `mine` (by name, nearest) is unchanged.
4. A block operation is counted for `break` as 1, like `place`.

## Why

Free building needs removal by position. 0349 kept the cell option out of the schema "because a field added there is visible to every agent at once"; the owner has now chosen that visibility.

## Consequences

- Contract, validator (`PHASE0_VERBS`, action shapes) and Body change together; those paths restart the 19 Bodies on merge ([packets](../analysis/building/work-packets.md), BLD-01, BLD-03, BLD-06).
- The verb is refused while the shard flag `body_actions.building` is off (0426).
- Cells the agent has not seen may be named; the Body checks the live world and reports a mismatch (0423).
