# 0162: Perception gains vertical, in_reach, edible and crop ripeness

- Status: Accepted
- Date: 2026-11-13
- Spec: section 5.15 (the play view and its snapshot fields); the owner's perception rulings under [0154](0154-perception-owner-rulings.md). Owner approval given in session on 2026-11-13.

## Context

Rangers on a pit rim could not tell whether a `give` to a nearby agent would work: the snapshot said how far away the other agent was, but not whether it stood above or below them, or whether it was inside give reach. Two rangers starved holding wheat: the inventory showed the wheat, but nothing said it was food, so they did not eat it when they were hungry.

## Decision

Three perception fields are added to the snapshot, all optional, all facts only:

1. Each nearby agent entry (`surroundings.agents[]`) gains `vertical`: `above`, `level` or `below`. It is `above` or `below` when the other agent's feet are more than 1 block higher or lower than the viewer's feet, else `level`.
2. Each nearby agent entry gains `in_reach`: a boolean, true when the other agent is within give reach (3 blocks).
3. Each inventory item (`ItemStack`) gains `edible`: a boolean, true when the item is food, read from the minecraft-data food table.

Crop ripeness needs no contract change. The Body puts it into the free text of `food_known[].kind`.

No coordinates, no advice: an agent entry says where the other agent is against the viewer, and an item says it is edible, and nothing more.

## Consequences

- The Body must populate the three fields (geldar-ops wires them in `golem/`). Until it does, the fields are absent and every existing client and Body keeps working.
- `edible` reveals which items are food. That is baseline knowledge, which the contract withholds by default. The owner approved this exception because starvation was the cost of not knowing.
- Field names and schema paths: `vertical` and `in_reach` at `contract/schemas/snapshot.schema.json#/$defs/SnapshotSurroundings/properties/agents/items` (and the MCP copy in `contract/schemas/mcp-common.schema.json`); `edible` at `contract/schemas/common.schema.json#/$defs/ItemStack`.
- The play view passes the three fields through unchanged, as it already does for the agent entries and the inventory.
