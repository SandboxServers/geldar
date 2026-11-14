# @geldar/player-core

The neutral home of the live player path pieces: the Body link and its NATS transport, the Mind event mapping, output validation, the plan builder, the speech classifier and the ids. Both `threshold/mcp` and `animus` import them from here. The matching files under `animus/src/` are one-line stubs marked `@deprecated`, kept so old animus imports still resolve; animus is frozen, so new code imports from `@geldar/player-core`. Nothing in this package imports from `animus/`, which `src/no-animus.test.ts` enforces.
