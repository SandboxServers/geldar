# 0095: look carries no internal ids and has in-world time; the MCP image holds only what it reads

Status: Proposed (orchestrator, 2026-11-11; owner to confirm)

## Context

The `look` tool returns the play view of a snapshot to the agent. Three identifiers in the Body's
snapshot are bookkeeping for the Threshold and the Body, not for the agent: `snapshot_id`, `shard`
and `body_generation`. `body_generation` in particular exposes how often the Body has been
rebuilt. The raw world ticks are also internal. The day and the time of day are what an agent
needs to plan. The Threshold's play view already drops the three identifiers and the raw ticks
(`threshold/mcp/src/play-view.ts`).

The MCP image (`threshold/mcp/Dockerfile`, published by `colo-images.yml`, run by `compose/mcp.yml`)
is built from the repo root. Its build context is an allowlist (`Dockerfile.dockerignore`).

## Decision

1. The `look` output has no key named `shard`, `snapshot_id` or `body_generation` at any depth.
   A handler test walks the whole output and fails if any of them appears. The in-world time
   is the snapshot's `world_time` (day, time of day, weather), the same fields `status` renders.
   No second time field is added.
2. The MCP image keeps the set of files the runtime reads or imports. It runs `node src/cli.ts`
   as uid 1000 on a read-only root, and that does not change. The runtime imports
   `@geldar/animus` (source), `@geldar/mcp-mock` and one `@geldar/repo-checks` module, so those
   stay in the image. The other workspaces, the plugin, the docs and the test support trees stay
   out of the build context; a text test pins that.
3. The contract schema for the look output (`contract/schemas/mcp-world.schema.json`) is changed
   by the integration packet, not here (index line in the C2-05 worknote).

## Consequences

- An agent cannot read the Body's generation or snapshot identifiers through `look`.
- The image is not reduced further without removing code the runtime imports. The image build
  was measured at 86 MB on 2026-11-11.
- Changing the runtime's imports changes what the image must contain; `container.test.ts`
  fails first if a reached file is excluded.
