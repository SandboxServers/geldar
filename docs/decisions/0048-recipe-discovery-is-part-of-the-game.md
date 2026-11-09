# 0048. Recipe discovery is part of the game; the plugin stops granting the recipe book

- Status: Accepted (owner, 2026-11-09; supersedes item 2 of decision 0032 and its follow-up on the join-time grant)
- Date: 2026-11-09
- Spec: 5.2 (Body API: craft), 5.5 (skills and books), principle 1; decision 0032

## Decision

1. Adam must discover recipes. The Geldar-Core plugin no longer grants the whole recipe book on join (P0-11's `RecipeGrant` listener is removed or disabled by config, default off).
2. How recipes unlock is the vanilla rule where possible: picking up or holding the right ingredients unlocks a recipe (advancement-driven `recipe_book_add`). Decision 0032 recorded that on the live 26.1.2 shard this did not happen in our probes (`/give`, `summon item` and pickup produced no `recipe_book_add`). Finding out why (an advancement or gamerule setting, a Paper config, or how our probes injected items) and making vanilla unlocking work, or implementing a plugin-driven unlock on ingredient pickup and on crafting, is the work of a packet ahead of the Adam runs (P0-19, below).
3. The `craft` action keeps its behaviour for a locked recipe: `failed(not_possible)` with `detail.unlocked: false`; the Mind learns what it can craft from what has unlocked and from books and experience.
4. Test fixtures may still unlock recipes over RCON (`recipe give`) for tests that are not about discovery, as today; benchmark scenarios that claim to start from nothing must unlock only through gameplay.

## Consequences

- P0-19 (new, before wave 5): research why unlocking did not fire, choose vanilla unlock or a plugin unlock, remove the grant, make the benchmark scenarios pass without `recipe give` (wood to stone tools by pickup-driven unlocks), add a live case "a fresh bot picks up logs and can then craft planks, then a table".
- The snapshot should expose which recipes are unlocked so the Mind can reason about them (small contract addition in wave 5 planning).
- Recipe knowledge in books and skills (spec 5.5) gains meaning: a locked recipe can be unlocked by acquiring the ingredients.
