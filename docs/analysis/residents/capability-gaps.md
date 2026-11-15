# Capability gaps for the resident cast

Audit of 2026-11-14 (read-only, from code and docs; the Body was not run). Body has 15 verbs and 7 programs (`prompts/body-api/v6.json`). Equal abilities: residents get no workaround; a missing mechanic is a gap for every agent.

| Resident | Pursuit | Body today | Gap to close |
|---|---|---|---|
| Lewis, Clark | exploring, mapping, journals | `goto`/`travel`, `journal`, `note`, signs: SUPPORTED. Long travel PARTIAL | maps, boats, waypoints, nether portals; swimming/climbing as verbs |
| Tamsin | planning and building | `place`, `build` (shelter 3x3x3, wall 5x3, pillar) | custom plans, large structures, blueprint copy |
| MacDonald | crops, animals | none for farming, breeding, shearing, milking | till, plant, harvest, bone meal; animal interaction; hoe/seed use |
| Chapman | orchards, seeds | `mine` takes logs; `place` could set a sapling | planting and tending verb, apple/sapling drops, bone meal |
| John Henry | mining, smelting, forging | `mine`, `craft` with furnace fallback (smelt PARTIAL) | anvil, smithing table, repair, armor equip verb, wider ore perception |
| Leonardo | mechanisms | none for doors, levers, buttons, pistons, redstone | generic use-block/item verb, redstone placement |
| Marguerite | brewing | none | brewing stand interaction, potion use |
| Walton | fishing, cooking | cooking via furnace; `eat` | fishing (rod use), boats |
| Ottoline | enchanting, books | `read_book` only; `write_book` stubbed (unavailable.ts) | `write_book`, enchanting table, villager trading, anvil |

Cross-cutting: generic "use block or item" verb (fishing, doors, levers), equip/armor verb (decision 0157), inventory-full handling, ore perception beyond coal and iron, skills (`define_skill`/`use_skill` stubbed).

Not checked: whether `craft` reaches an anvil, smithing table or brewing stand; exact notable-block list.

## Status update 2026-11-15 (geldar-ops)
Live on Colo: `till`, `place` (any block in inventory), `use` on doors, gates, trapdoors, non-iron buttons and levers, sowing and bone meal (flag on, prompt v9). Placement of lever, door, piston and redstone is not verified live; a read-only check is running. Not built: feed/shear/milk, rod, equip (0157), build plans, write_book, maps, anvil/repair, brewing, enchanting, trading. Chapman and MacDonald started 2026-11-15 on the live verbs; Leonardo is next (placement test).
