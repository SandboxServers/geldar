# 0427. Delete the inline `build` action

- Status: Accepted (owner, 2026-11-22)
- Date: 2026-11-22
- Spec: section 5 verb table still lists `build(blueprint)`; decision 0074 (the action has no handler).

## Decision

Remove the `do: "build"` Action from the thought schema, its cost line in `golem/src/body/limits.ts` and the generated code. The `build` program (blueprints shelter, wall, pillar) stays. The plan lane (0423) replaces what the inline action was meant for.

## Why

It has no handler, `build` is not in `PHASE0_VERBS`, and the Mind is told it is unavailable. A dead action is a misleading second way to say "build".

## Consequences

- A spec text edit (the owner's) to drop `build(blueprint)` from the verb table; until then the spec names a verb the code lacks.
- Packet BLD-26; it merges in the same window as another contract change.
