# 0349: A program mines one exact cell

- Status: Superseded in part by [0421](0421-break-at-position-verb-exposes-exact-cell-dig.md): the exact-cell dig reaches agents through the `break` verb. The dig-safety refusals in this record are removed by [0428](0428-dig-safety-refusals-removed.md). Originally Proposed (option (a) of AN-40 open item 1; no operator ruling is recorded in the repo)
- Date: 2026-11-18
- Why: `mine` takes the nearest block of the wanted name and has no ownership gate, so a farm step that chose its own wheat could dig a nearer wheat of another player. A program that chose a cell must be able to dig that cell, or fail, and never another block.

## Ruling

A program step may name the one cell a `mine` digs. The Body digs that cell or fails with a typed reason; it never digs another block. With no cell, `mine` behaves exactly as before.

## Facts

- The option is `ActionRunOptions.mineAt` (registry) and `ActionContext.mineAt`, a `Position` in block coordinates. Only a program can set it, through the third argument of `ProgramContext.runAction` (`StepActionOptions`). A Mind's action never carries it.
- A cell is refused with `invalid_args` when a coordinate is not a whole number, when the count is not 1, and when the verb is not `mine`.
- Failures: `not_possible` with `target is not loaded` when the cell is not loaded; `not_found` with `that block is <name>` when the cell holds another block (also after the walk); `out_of_reach` with `the target is out of reach` when the walk ends with the cell still out of dig reach; `not_possible` with `would drop you` when the cell is under the feet. The existing unbreakable and dig-safety refusals apply unchanged.
- The walk to the cell and the drop pickup are the existing `mine` code, unchanged.

## Why not the contract

The `mine` variant of `Action` is in the `act` tool's input (`contract/schemas/mcp-play.schema.json`, generated into `contract/src/generated/mcp-tools.ts`), and every agent is served that schema. A field added there would be visible to every agent at once and could be sent by any of them. The cell therefore travels as a program-only run option, the pattern of `ownPlanksLast` (0330) and `highLedge` (0333). `runAction` still validates the action against the contract, so a `mine` with an `at` field stays invalid from every source.

## What is unchanged

- A `mine` without a cell: the nearest-block search, its refusals and its drop wait.
- The `Action` schema, the `act` tool schema, body-api and prompt versions (no prompt names a cell for `mine`).
- `mine` has no ownership gate of its own. A program that picks a cell is responsible for its ownership checks, as `farm` is under 0164.
- `player-core`, Paper and NeoForge.
