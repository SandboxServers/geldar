# 0218: the `use`, `mount` and `dismount` actions let every agent click with an item and ride

- Status: Accepted (owner ruling, relayed by geldar-93, 2026-11-14)
- Date: 2026-11-14

## Context

The Body can place, mine, open a container and till, but it cannot use what it holds on a block or an entity, and it cannot ride. Rangers crafted an oak boat and have no way to put it on a lake, get in, steer or get out. The residents audit (`docs/analysis/residents/capability-gaps.md`) lists the same hole for doors, levers, buttons, fishing, feeding, shearing and milking, sowing, brewing and trading. All of these are the standard client's own click, so every agent can have them equally; none of them is a world edit by a human (Principle 1).

Each of these cases is "click this with what is in hand". The vanilla input is the same (use item on block, or interact with entity); only the target and the held item differ. One generic verb therefore covers them, where a verb per case would cost more prompt budget (0192 measured about 60 tokens per verb).

## Decision

The contract has three action verbs in the `Action` union of `contract/schemas/thought.schema.json`, all with `additionalProperties: false`:

```json
{ "do": "use", "item": "oak_boat", "at": { "x": 12, "y": 62, "z": -7 } }
{ "do": "use", "item": "wheat", "entity": "cow:123" }
{ "do": "mount", "entity": "oak_boat:456" }
{ "do": "dismount" }
```

- `use`: `item` (optional ItemName; the Body equips it from the inventory; absent means the hand as it is, which may be empty), `at` (optional block position, the same shape `till` uses, no `feet`), `entity` (optional string, the same pattern as `attack.target`: the name or `name:id` the perception snapshot lists). `at` and `entity` together is a Body refusal (`invalid_args`, "use takes a block or an entity, not both"), not a schema `oneOf`. With neither, the Body uses the held item in the air (cast a rod, reel in). The Body chooses the block face. There is no `face`, `count` or `hand` field.
- `mount`: `entity` required. `dismount`: no fields.
- Steering has no verb: while mounted, `goto` with a position steers the vehicle (ride mode); the pathfinder is not used while riding.
- Refusals reuse the existing reason codes: `missing_materials`, `not_found`, `out_of_reach`, `blocked`, `not_possible`, `no_effect`, `invalid_args`, `timeout`, `interrupted`, `unsupported`. No new code. Texts are fixed facts without coordinates (0154).
- Ownership (0164 posture: using is not breaking). The owner lookup is the one `till` uses, and the chunk's owners are prefetched so a cold cache does not fail open (as in 0192). An unknown owner is allowed.
  - Refused with `not_possible` "that block is someone else's work" on a recorded other-owner block: containers and anything with a window (chest, barrel, furnace, brewing stand, hopper, dispenser, dropper, shulker box, anvil, enchanting table, lectern), beds (sleeping is `sleep`), redstone devices that change a build (lever, repeater, comparator, note block, daylight detector, target, trapped chest), and signs and item frames (use `edit_sign`). System-owned graves (0195) follow the same rule.
  - Containers keep their own verbs: `use` on a container is refused `not_possible` "use open for containers".
  - Allowed on another player's block: doors, trapdoors, fence gates and buttons that are not iron (see the owner rulings below).
  - Entities with another player's owner tag (tamed pets) and villagers of a recorded claim are refused. Penned livestock of another player is takeable (see the owner rulings below).
- Results: ok results carry a small data object and no prose advice (for example `{ "block": "oak_door", "state": "open" }`, read back from the block state).
- The Mind's Phase 0 allow-list admits the three verbs (verb table, bounds, action shapes, MCP `act` description). The default body-api prompt moves from v8 to v9 (`prompts/body-api/v9.json` lists each verb in one plain sentence with one example; v8 is not edited). The generated files are regenerated from the schema.
- The Body (golem; geldar-ops) implements the handlers in groups (sub-decisions 0219, 0222 and 0223) and refuses each group that is not ready with `unsupported` until it ships.

## Owner rulings (2026-11-14)

Relayed by geldar-93 from the owner. These settle the open questions in the proposal.

1. Penned livestock of other players IS takeable. `use` may shear, milk and lead an animal that another player penned; no ownership record exists for it, and it is treated like natural blocks (0164). Counts are logged like 0217.
2. Doors, gates, trapdoors and non-iron buttons on others' builds are allowed. Containers, beds, signs and build-changing redstone stay refused, as set out above.
3. Order of work, in value order:
   1. `use` on doors, levers and buttons, and sowing and bone meal;
   2. feed, shear and milk on entities;
   3. the fishing rod (0222);
   4. boats last (0223), after the `vehicle_move` live spike.
   The v8 to v9 prompt bump merges only with a Body deploy. A fourth verb needs a budget decision under 0181 first.
4. Decision numbers, allocated by geldar-93: 0218 is the contract shape (this record); 0219 is the block and entity handlers; 0222 is the rod; 0223 is boats and ride mode. Records 0219, 0222 and 0223 are not written by this change.

## Consequences

- The contract, the Mind allow-list, the body-api prompt (v9 once it merges, with the Body deploy) and the MCP `act` tool description carry the three verbs; the generated files are regenerated from the schema.
- Prompt cost: about 145 estimated tokens for the three entries on top of v8 (3926 estimated). The sum 8474 plus 145 stays under `num_ctx` 8704, a margin of about 85. Re-measure with `promptCost` before the v9 prompt merges.
- Agents can place a boat, ride, cast, open doors and feed animals once the Body ships those groups. Until then a verb gets the Body's refusal, not a Mind refusal.
- The contract change merges only in the deploy window of the first Body handler (the same rule as 0167 and 0192), so the Mind never advertises a verb the Body does not have.
- No existing action changes shape, so earlier thoughts and outcomes are unaffected.
- Boats depend on a live spike: mineflayer 4.39.0 has no vehicle physics, so the Body may have to send its own `vehicle_move` packets. That is recorded in 0223 and does not change this contract.
