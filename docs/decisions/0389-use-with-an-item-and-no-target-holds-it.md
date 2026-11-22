# 0389: `use` with an item and no target puts the item in hand

- Status: Accepted (owner, 2026-11-18). Amends 0218 (the no-target shape).
- Date: 2026-11-18

## Context

The agents on the autonomous Paper shard wrote a shared rule into their own goals files: walk only on Billy's call, with four armed companions in sight, and be armed yourself. "Armed" means a weapon in hand, which other agents can see (`surroundings.agents[].held_item`). No verb puts an item in the hand on its own:

- `use` with `item` and an `at` block that is not a door, lever, button, farmland or crop is refused "that block cannot be used that way" (`golem/src/actions/use.ts`). The journals carry that text at the step where agents try to hold a sword.
- `use` with `item` and neither `at` nor `entity` is refused "use needs a block position". Decision 0218 defined this shape ("with neither, the Body uses the held item in the air") but no handler was built for it.
- `attack` equips the best weapon it carries and leaves it in hand, but nothing tells an agent that, and Principle 2 and decisions 0058, 0059 and 0068 rule out telling them.

So the gate the agents built stays closed for a mechanical reason. Principle 1 says to fix the infrastructure, not the story.

## Decision

This amends 0218's no-target clause. 0218 said that with neither `at` nor `entity` the Body uses the held item in the air (cast a rod, reel in). With an item named, the shape now holds the item instead. The in-air use is not built: `{ "do": "use" }` alone still refuses, and the rod's cast and reel wait for 0222 (point 5).

1. `{ "do": "use", "item": "<item>" }` with neither `at` nor `entity` equips that item from the inventory into the main hand. It clicks nothing.
   - If the hand already holds it, nothing is equipped, and the result is still ok.
   - If the inventory does not carry it, the result is `missing_materials` "no such item in the inventory" (the existing text).
   - After the equip the Body reads `heldItem` back. If the item is not in hand, the result is `not_possible` "the item did not go into the hand". An abort during the equip is `cancelled`.
   - Ok results carry `{ "held": "<item>", "fact": "<item> in hand" }`.
2. `{ "do": "use" }` with no item and no target keeps its refusal "use needs a block position".
3. Shapes with `at` or `entity` are unchanged. A sword used on a plain block is still refused "that block cannot be used that way".
4. The ok fact reaches the Mind the same way `till` and `place` facts do, so the agent reads "Your use worked: wooden_sword in hand." Two places carry it:
   - the Body sends `detail.fact` as the outcome's `detail_text`, cut to 160 characters (`golem/src/body/executor-outcome.ts`);
   - `use` joins `PLAIN_FACT_VERBS` (`contract/src/outcome-words.ts`), the list of verbs whose successful outcome keeps its fact on the way to the Mind (`threshold/mcp/src/events/handlers/action-outcome.ts`).
   
   The `action-outcome-event` schema's description adds `use` to the verbs that send a fact. This is a description change only, so the action shape is unchanged. The owner chose that agents read this fact (owner, 2026-11-18).
5. When the fishing rod ships (0222), the rod's air click takes this shape for `fishing_rod` alone. Every other item is held.
6. The `body_actions.use` shard flag gates this shape like every other `use`.
7. No contract shape change, no new verb, no prompt version bump. Agents are not told: no persona, skill or goals text changes. They find the shape by trying it, the same way they found the refusals.

## Consequences

- This is a dated change to the rules of the world on a live shard: from its deploy, holding an item is something any agent can do. It adds no combat ability, because `attack` already equips the best weapon.
- Any agent can arm itself before a walk. What the agents then do, Billy's gate included, is theirs, and it is recorded as data (Principles 2 and 5). U0-02 measures it; it sets no target.
- A hold is not permanent. The eat and burrow reflexes equip food or a pickaxe, and nothing puts the sword back, so the hand is watched over time, not once.
- Holding an item is not a world edit and touches no one's blocks, so no ownership check applies.
- The verb budget in 0218 (a fourth verb needs a decision under 0181) is not used. If agents rarely try the no-target shape, a separate `hold` verb is a later decision.
