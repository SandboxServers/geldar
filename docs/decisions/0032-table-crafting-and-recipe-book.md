# 0032. Crafting on 26.1 goes through the recipe book, and the shard unlocks recipes

- Status: Accepted (owner review requested; made autonomously overnight, see `docs/analysis/phase0/overnight-decisions.md`)
- Date: 2026-11-09
- Spec: section 5.2 (Body API: craft); decision 0022 (Mineflayer 4.39.0 stack and the stop-and-report rule); packets P0-08b, P0-09a

## Decision

1. The `craft` action does not call `bot.craft` for recipes that need a crafting table, and for the 2x2 grid it uses the same path when the recipe is in the recipe book. It sends `craft_recipe_request` for a recipe display taken from `recipe_book_add`, waits for the result slot, and shift-clicks it using the stateId of the window it is working in. The code is `golem/src/actions/craft-table.ts`. Nothing in `node_modules` is patched and no version changes.
2. Recipes must be in the player's recipe book to be craftable. On the live 26.1.2 shard, giving or picking up ingredients does not unlock a recipe (probed with `/give`, `summon item` and pickup: no `recipe_book_add` arrived). So the shard grants the recipe book to the Body: in Phase 0 test fixtures do it with `recipe give <name> *` over RCON (test setup only; the Body never uses RCON), and the Geldar-Core plugin (P0-11) grants all recipes on join. A `craft` of a recipe that is not unlocked fails with `not_possible` and `detail.unlocked: false`.

## Why

- Mineflayer 4.39.0 keeps one `stateId` for all windows. In a crafting table window it sends window 0's counter, so the server answers each click with a full resync that overwrites the client's model mid-script, and the craft never completes. The 2x2 path showed the same timing-dependent failure once. Diagnosis: packet traces in `docs/analysis/phase0/worknotes/craft-26-1-diagnosis.md`. Upstream fix would be a per-window stateId.
- Decision 0022 says do not patch the library; this workaround is ordinary code in `golem/src` that uses the protocol directly.
- Granting the whole recipe book is a Phase 0 simplification: recipe discovery is not what the benchmark or the first Adam runs measure. Whether Adam should discover recipes is a design question; if it should, a later decision changes the grant, not the action.

## Consequences

- The live fixture and any Adam shard must grant recipes before a table craft; P0-11 owns the join-time grant.
- The recipe-book watcher is installed through `ConnectionOptions.onBot` at bot creation, because the join-time `recipe_book_add` arrives before any later listener could attach.
- `craft` is slower than a direct library call by one packet round trip per display it must try; the working display is remembered per bot and item.
- Revisit when Mineflayer ships a per-window stateId: the table path can go back to `bot.craft`.
