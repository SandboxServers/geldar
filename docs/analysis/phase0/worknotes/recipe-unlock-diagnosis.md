# Recipe unlock diagnosis (orchestrator, read-only probes on the live shard, 2026-11-09)

Question (decision 0048, P0-19): why did vanilla recipe unlocking not fire in the wave 2 probes (decision 0032: `/give`, `summon item` and pickup produced no `recipe_book_add`)?

## Findings

1. The server config does not disable advancements: `spigot.yml` `advancements.disabled` is only the default `minecraft:story/disabled`; `limited_crafting` is false; no datapack removes the recipe advancements. The Paper 26.1.2 jar contains 1502 recipe advancement files (`data/minecraft/advancement/recipes/...`).
2. A recipe advancement such as `minecraft:recipes/building_blocks/oak_planks` has the criteria `has_logs` (`inventory_changed` with `#minecraft:oak_logs`) and `has_the_recipe`; earning it rewards the recipe, which sends `recipe_book_add`. Its parent `recipes/root` is an `impossible` criterion and does not block children.
3. Probe 1 (grant active, as in production today): a joined bot already has all recipes (the plugin's join-time grant, about 1 MB `recipe_book_add`), so `/give` produces nothing.
4. Probe 2: after `recipe take <bot> *` (1515 recipes removed) `/give oak_log` and `/give oak_planks` still produce no `recipe_book_add`: `recipe take` removes the recipes but NOT the advancement progress, so the criteria are already earned and cannot fire again.
5. Probe 3: after `advancement revoke <bot> from minecraft:recipes/root` (1492 advancements revoked) and `recipe take`, `/give oak_log 3` immediately sends two `recipe_book_add` packets (furnace and 2x2 crafting recipes), and `/give oak_planks 4` sends two more (stick, table-sized shaped recipes). Vanilla recipe discovery works on this shard.

## Cause of the wave 2 result

The wave 2 probe bot's recipe advancements were already earned (a reused player name with saved advancement progress, or a prior `recipe give`, which also completes the advancement), so no further unlock could happen. It was a probe artefact, not a server fault. Adam gets a new username per life (`ag_adam_01`), hence fresh advancement progress.

## Consequences for P0-19 (decision 0048)

- No plugin unlock listener is needed: `recipes.unlock: vanilla`. P0-19 reduces to removing the join-time grant (config default off, code kept behind the flag or deleted), making fixtures and the benchmark start from a clean recipe state, and the live case.
- Fixtures that reuse a bot name must reset recipe state with BOTH `advancement revoke <bot> from minecraft:recipes/root` and `recipe take <bot> *`; the standard `resetBot` step gets a `recipes` option for that.
- Benchmark scenarios that currently start with all recipes (because of the grant) will now discover recipes through play: `wood-to-stone-tools` must pass with vanilla unlocks (logs unlock planks, planks unlock sticks and the table, and so on); watch for recipes that need an intermediate item (the Mind sees only what has unlocked).
- A returning player keeps its progress (stored in player data): Adam's recipes persist across sessions and restarts.
