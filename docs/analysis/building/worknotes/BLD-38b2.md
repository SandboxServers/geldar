# BLD-38b2: wiring fixes (break and replace, stateful targets, shared import)

Base: `047ea998` (building/integration at session start). Branch `phase1/bld-38b2-wiring-fixes`.

## What changed

1. **Break and replace plans run.** The expander no longer refuses them. A break cell and a replace
   cell carry `prior: null`: the cell executor reads the live block at run time (the same read the
   stale-cell rule uses) and digs what it finds. A place cell keeps `prior: 'air'`, so the stale
   rule (`changed`) still applies to it. The expander expands one step at a time so a replace's cells
   are known to be replaces.
2. **Stateful targets.** A palette block is written in one spelling (`name[key=value,...]`, keys
   sorted), parsed by `golem/src/building/block-ref.ts`. The done check compares the live name and
   each listed property (`CellEnv.propsAt`, read from the live block's `getProperties`). The place
   action receives the state the reference lists (axis, facing, half) as `placeState`, through
   `ActionContext` into `runtime.runAction` (`StepActionOptions.placeState`). The placed block is
   verified by name and the listed properties.
3. **Defaults and origin.** `order` absent means `bottom_up`. The contract default is in
   `contract/schemas/build-plan.schema.json` (`BuildOrder`, default `bottom_up`). The expander
   matches it. `origin: "here"` is the feet cell, the floor of the bot position in `create-body.ts`.
   `threshold/mcp/src/tools/plan-check.ts` takes `view.feet` (`view.position` is the floor of the
   feet), so the two agree.
4. **Shared import.** `golem` depends on `@geldar/player-core` (`workspace:*`). `wire-expand.ts`
   imports `@geldar/player-core/src/building/...`. `golem/Dockerfile` copies `player-core` and
   `golem/Dockerfile.dockerignore` allows it, so the image install resolves the workspace link.

## Limits

- A stateful target with a property the place action does not ask for (for example
  `oak_door[open=true]`) is placed without that property, the verify fails, and the cell ends
  `blocked`. The place action only knows axis, facing and half.
- The cell executor's place still goes through the place action's own state logic
  (`planPlaceState`), so a state no neighbour can give ends `state_unachievable`.
