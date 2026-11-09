import type { Action } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import type { Block, Recipe } from './bot-types.ts';
import { craftFromBook, hasUnlockedDisplay } from './craft-table.ts';
import { heldCount } from './inventory-count.ts';
import { outcomeOfMove } from './move-outcome.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { moveNear } from './pathing.ts';
import { pollUntil } from './poll.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/** The item fields `craft` reads from the registry. */
interface CraftItem {
  id: number;
  name: string;
}

/** How far the crafting table is searched for, in blocks. */
const TABLE_RANGE = 32;
/** How close the bot walks to the table before it crafts there. */
const TABLE_STANDOFF = 3;
/**
 * Ingredients preferred when recipe variants tie. Tags expand to one variant per block, so
 * "first" would otherwise be arbitrary; this order keeps the common variant.
 */
const PREFERRED_INGREDIENTS = ['cobblestone', 'oak_planks', 'oak_log'];
/**
 * Wall-clock wait for the crafted items to reach the inventory after the last craft, scaled by
 * `timeScale`. The server's inventory correction can arrive late, so the craft waits for it.
 */
const SETTLE_WALL_MS = 3_000;

/**
 * Crafts `count` of an item. A recipe with a table needs the table in reach: the bot walks to the
 * nearest one within 32 blocks when no recipe works from the inventory alone. The library's own
 * craft loop cannot be aborted, so this loop crafts one batch at a time and checks the signal.
 * `times` is `ceil(count / result.count)`, so `craft oak_planks 5` crafts 8 (two crafts of four).
 */
export const craftAction: ActionHandler<'craft'> = {
  kind: 'craft',
  timeoutMs: 60_000,
  run: runCraft,
};

async function runCraft(
  ctx: ActionContext,
  action: Extract<Action, { do: 'craft' }>,
): Promise<ActionOutcome> {
  const { bot, signal, timeScale } = ctx;
  const def: CraftItem | undefined = bot.registry.itemsByName[action.item];
  if (!def) return failed('invalid_args', `unknown item ${action.item}`);
  const item = { id: def.id, name: def.name };

  const table = findTable(bot);
  let usedTable: Block | null = null;
  let recipes = bot.recipesFor(item.id, null, action.count, null);
  if (recipes.length === 0 && table) {
    // The recipe may need the table: walk to it, then look again with the table as the station.
    const move = await moveNear(bot, table.position, TABLE_STANDOFF, { signal, timeScale });
    if (!move.ok) {
      return outcomeOfMove(move);
    }
    if (signal.aborted) return cancelled();
    recipes = bot.recipesFor(item.id, null, action.count, table);
    usedTable = table;
  }
  if (recipes.length === 0) return diagnoseCraft(bot, item, table, action.count);

  const recipe = pickRecipe(bot, recipes, action.count);
  if (!recipe) return failed('not_possible', 'not craftable');
  const times = Math.ceil(action.count / recipe.result.count);
  const before = heldCount(bot, item.id);
  try {
    if (usedTable || hasUnlockedDisplay(bot, item)) {
      // Recipe-book crafts skip bot.craft: its stateId is shared by every window, and on 26.1 the
      // table rejects it. A 2x2 recipe with no unlocked display falls back to bot.craft.
      const stop = await craftFromBook(ctx, item, times, usedTable);
      if (stop) return stop;
    } else {
      for (let i = 0; i < times; i++) {
        if (signal.aborted) break;
        await bot.craft(recipe, 1);
      }
    }
  } catch (error) {
    const message = errorText(error);
    // The library reports a short inventory as an error; that is a missing-materials outcome.
    if (/ingredient/i.test(message)) return failed('missing_materials', message.slice(0, 200));
    throw error;
  } finally {
    // A close error must not replace the outcome that the loop produced.
    if (bot.currentWindow) {
      await bot.closeWindow(bot.currentWindow).catch((error: unknown) => {
        console.warn(`crafting window did not close: ${errorText(error)}`);
      });
    }
  }
  if (signal.aborted) {
    return cancelled({ item: item.name, crafted: heldCount(bot, item.id) - before });
  }

  // Success is judged by the inventory, not by the clicks: wait, bounded, for the product to show.
  const expected = times * recipe.result.count;
  await pollUntil(bot, signal, () => heldCount(bot, item.id) - before >= expected, {
    wallMs: SETTLE_WALL_MS * timeScale,
  });
  const crafted = heldCount(bot, item.id) - before;
  // Completed means produced: a result the server did not give back is an internal failure.
  if (crafted < expected) {
    return failed('internal', `server produced ${crafted} of ${expected} ${item.name}`, {
      item: item.name,
      crafted,
    });
  }
  return completed({ item: item.name, crafted, used_table: usedTable !== null });
}

/** The nearest crafting table within range, or null when there is none (or no such block). */
function findTable(bot: Bot): Block | null {
  const id = bot.registry.blocksByName.crafting_table?.id;
  if (id === undefined) return null;
  return bot.findBlock({ matching: id, maxDistance: TABLE_RANGE });
}

/**
 * Explains why no recipe could run. Not craftable at all gives `not_possible`. A table-only recipe
 * with no table in reach gives `missing_station`. Otherwise the best variant's shortfall is the
 * `missing` detail. Exported for the unit tests.
 */
export function diagnoseCraft(
  bot: Bot,
  item: CraftItem,
  table: Block | null,
  count: number,
): ActionOutcome {
  if (bot.recipesAll(item.id, null, true).length === 0) {
    return failed('not_possible', 'not craftable');
  }
  if (!table && bot.recipesAll(item.id, null, null).length === 0) {
    return failed('missing_station', 'needs a crafting table');
  }
  const candidates = bot.recipesAll(item.id, null, table);
  const best = pickRecipe(bot, candidates, count);
  if (!best) return failed('not_possible', 'not craftable');
  const missing = shortfall(bot, best, count);
  const names = Object.keys(missing).join(', ');
  return failed('missing_materials', `missing ${names || 'materials'}`, { missing });
}

/**
 * The variant to craft: fewest missing ingredients first, then the preferred ingredient names,
 * then the lowest index (the sort is stable). Undefined for an empty list.
 */
function pickRecipe(bot: Bot, recipes: Recipe[], count: number): Recipe | undefined {
  const scored = recipes.map((recipe) => ({
    recipe,
    missing: Object.values(shortfall(bot, recipe, count)).reduce((sum, n) => sum + n, 0),
    rank: preferenceRank(bot, recipe),
  }));
  scored.sort((a, b) => a.missing - b.missing || a.rank - b.rank);
  return scored[0]?.recipe;
}

/** Where the recipe's ingredients fall in `PREFERRED_INGREDIENTS`; the list length when none match. */
function preferenceRank(bot: Bot, recipe: Recipe): number {
  let rank = PREFERRED_INGREDIENTS.length;
  for (const d of recipe.delta) {
    if (d.count >= 0) continue;
    const index = PREFERRED_INGREDIENTS.indexOf(ingredientName(bot, d.id));
    if (index >= 0 && index < rank) rank = index;
  }
  return rank;
}

/** What the inventory lacks for `count` items of this recipe, by item name (`delta` times `times`). */
function shortfall(bot: Bot, recipe: Recipe, count: number): Record<string, number> {
  const times = Math.ceil(count / recipe.result.count);
  const missing: Record<string, number> = {};
  for (const d of recipe.delta) {
    if (d.count >= 0) continue;
    const need = -d.count * times - heldCount(bot, d.id, d.metadata);
    if (need > 0) missing[ingredientName(bot, d.id)] = need;
  }
  return missing;
}

/** An item's registry name, or its numeric id when the registry has no entry. */
function ingredientName(bot: Bot, id: number): string {
  return bot.registry.items[id]?.name ?? String(id);
}
