# 0141. The Body's pathing may dig natural soft blocks, and nothing else

- Status: Superseded by 0164
- Date: 2026-11-11
- Spec: section 5.2 (Body API, pathing); amends the `canDig=false` setting of packet P0-07c (`docs/analysis/phase0/work-packets.md`, `ensurePathfinder`); related 0039, 0063
- Packet: C5-01

## Context

The Body sets `canDig=false` so that walking never destroys the world by accident. The goldar repo review found the cost: a body that ends on a leaf canopy has no way down and reports `blocked`, which wakes the Mind with "the way was blocked".

## Decision (draft)

Pathing may plan moves that dig, limited to natural soft blocks: leaves, vines, snow layers and plant cover. It never digs block entities, crafting tables, beds, chests or doors; it never digs a block next to lava or any fluid; it never digs a block that has a falling block (sand, gravel) above it; it never digs unbreakable blocks. A dig costs more than a step, so a walkable route is preferred. All other digging stays an explicit `mine` action.

## Orchestrator's recommended default and why

Accept as written. The limits are conservative (they match the safety rules the review found in the goldar repo, re-implemented from the idea), they remove a trap that turns into a lost life, and a reflex-level safe-dig predicate is shared with `dig-cell`. Reverse by setting the soft-block list to empty.

## Consequences

Canopy escapes work. A path can remove a leaf block that a builder placed; accepted, because leaves are not a build material in the agents' recipes. The bench is re-run before and after.