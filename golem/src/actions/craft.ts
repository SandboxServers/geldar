import type { Action } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import type { Block, Recipe } from './bot-types.ts';
import { craftsPossible, FEWER_MESSAGE, pickUpSpareTable, placeSpareTable } from './craft-spare.ts';
import { bookYield, craftFromBook, hasUnlockedDisplay } from './craft-table.ts';
import { heldCount } from './inventory-count.ts';
import { mineAction } from './mine.ts';
import { outcomeOfMove } from './move-outcome.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { moveNear } from './pathing.ts';
import { pollUntil } from './poll.ts';
import type { ActionContext, ActionHandler } from './registry.ts';
import { smeltAtFurnace } from './smelt.ts';
import { smeltRecipesFor } from './smelt-book.ts';

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
 * The craft's own wall-clock deadline at `timeScale` 1, under the handler's 60 s so that the report
 * (what was made so far, and where it stood) is the outcome, not the registry's bare timeout.
 */
const CRAFT_DEADLINE_MS = 55_000;

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
  const progress: CraftProgress = { phase: 'starting', crafted: () => 0 };
  const limit = new AbortController();
  const forward = (): void => limit.abort();
  if (ctx.signal.aborted) forward();
  ctx.signal.addEventListener('abort', forward, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The craft's own deadline is under the registry's, so the report below wins the race and the
  // registry's bare "no result within" never replaces it.
  const expired = new Promise<ActionOutcome>((resolve) => {
    timer = setTimeout(() => {
      limit.abort();
      resolve(
        failed(
          'timeout',
          `crafting ${action.item} ran out of time while ${progress.phase}: made ${progress.crafted()} of ${action.count}`,
          { item: action.item, crafted: progress.crafted(), wanted: action.count },
        ),
      );
    }, CRAFT_DEADLINE_MS * ctx.timeScale);
  });
  const body = craftBody({ ...ctx, signal: limit.signal }, action, progress);
  // A body that outlives the deadline (the library's craft cannot be aborted) must not reject unseen.
  body.catch(() => undefined);
  try {
    return await Promise.race([body, expired]);
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener('abort', forward);
  }
}

/** Where a craft is, for the report when its deadline passes. */
interface CraftProgress {
  phase: string;
  crafted: () => number;
}

async function craftBody(
  ctx: ActionContext,
  action: Extract<Action, { do: 'craft' }>,
  progress: CraftProgress,
): Promise<ActionOutcome> {
  const { bot } = ctx;
  const def: CraftItem | undefined = bot.registry.itemsByName[action.item];
  if (!def) return failed('invalid_args', `unknown item ${action.item}`);
  const item = { id: def.id, name: def.name };

  const spare = await placeSpareTable(ctx, item.id, action.count);
  if (spare.outcome) return spare.outcome;
  try {
    return await craftAtTable(ctx, action, progress, item, spare.table);
  } finally {
    if (spare.placed) await pickUpSpareTable(ctx);
  }
}

/** The craft once the station is known: the walk, the recipe, the craft and the settle. */
async function craftAtTable(
  ctx: ActionContext,
  action: Extract<Action, { do: 'craft' }>,
  progress: CraftProgress,
  item: { id: number; name: string },
  table: Block | null,
): Promise<ActionOutcome> {
  const { bot, signal, timeScale } = ctx;
  let usedTable: Block | null = null;
  let recipes = bot.recipesFor(item.id, null, action.count, null);
  if (recipes.length === 0 && table) {
    // The recipe may need the table: walk to it, then look again with the table as the station.
    progress.phase = 'walking to the crafting table';
    const move = await moveNear(bot, table.position, TABLE_STANDOFF, { signal, timeScale });
    if (!move.ok) {
      return outcomeOfMove(move);
    }
    if (signal.aborted) return cancelled();
    recipes = bot.recipesFor(item.id, null, action.count, table);
    usedTable = table;
  }
  if (recipes.length === 0) {
    // No grid recipe makes it at all, but the recipe book knows a smelting one (decision 0048).
    if (
      bot.recipesAll(item.id, null, true).length === 0 &&
      smeltRecipesFor(bot, item.id).length > 0
    ) {
      return smeltAtFurnace(ctx, { item: item.name, count: action.count });
    }
    return diagnoseCraft(bot, item, table, action.count);
  }

  const recipe = pickRecipe(bot, recipes, action.count);
  if (!recipe) return failed('not_possible', 'not craftable');
  // Partial: the materials may allow fewer crafts than asked. Craft what they allow, and say so.
  const crafts = Math.min(
    Math.ceil(action.count / recipe.result.count),
    craftsPossible(bot, recipe),
  );
  if (crafts === 0) return diagnoseCraft(bot, item, table, action.count);
  const count = Math.min(action.count, crafts * recipe.result.count);
  const fewer = count < action.count;
  const times = crafts;
  const before = heldCount(bot, item.id);
  // What the library crafts are expected to make: the recipe's count per craft.
  let expected = times * recipe.result.count;
  progress.phase = usedTable ? 'crafting at the table' : 'crafting';
  progress.crafted = () => Math.max(0, heldCount(bot, item.id) - before);
  let stop: ActionOutcome | null = null;
  try {
    if (usedTable || hasUnlockedDisplay(bot, item)) {
      // Recipe-book crafts skip bot.craft: its stateId is shared by every window, and on 26.1 the
      // table rejects it. A 2x2 recipe with no unlocked display falls back to bot.craft.
      // The book makes its display's yield per craft, which can differ from the picked recipe's and
      // from the first display's (a stick from planks makes 4, from bamboo 1, and the server takes
      // either). So the yield is not guessed: `want` makes the book stop when the inventory has
      // gained the count asked, and the guess is only the cap it is handed. The crafted count is
      // judged against what was asked.
      const yieldPer = bookYield(bot, item) || recipe.result.count;
      stop = await craftFromBook(
        { ...ctx, want: count },
        item,
        Math.ceil(count / yieldPer),
        usedTable,
      );
      expected = count;
      // With no table, a display that never fills means this item has no 2x2 recipe the book can make.
      // bot.craft makes the rest, so the craft does not fail on a display that was never the right one.
      if (!usedTable && stop?.status === 'failed' && stop.reason === 'timeout') {
        stop = null;
        const left = Math.ceil((count - (heldCount(bot, item.id) - before)) / recipe.result.count);
        await craftByLibrary(ctx, recipe, left);
      }
    } else {
      await craftByLibrary(ctx, recipe, times);
    }
  } catch (error) {
    const message = errorText(error);
    // The library reports a short inventory as an error; that is a missing-materials outcome.
    if (/ingredient/i.test(message)) return failed('missing_materials', message.slice(0, 200));
    // The library puts the ingredients in the grid before it waits for the result slot. When the
    // wait times out they stay there (the planks that vanished in the first live run): closing the
    // player's grid makes the server hand them back to the inventory.
    returnGrid(bot);
    const timedOut = /did not fire within timeout/i.test(message);
    return failed(
      timedOut ? 'timeout' : 'internal',
      `the crafting grid did not produce ${item.name}; the ingredients were returned`,
      { item: item.name, crafted: heldCount(bot, item.id) - before },
    );
  } finally {
    // A close error must not replace the outcome that the loop produced.
    if (bot.currentWindow) {
      await bot.closeWindow(bot.currentWindow).catch((error: unknown) => {
        console.warn(`crafting window did not close: ${errorText(error)}`);
      });
    }
  }
  if (stop) return withCrafted(stop, item.name, heldCount(bot, item.id) - before);
  if (signal.aborted) {
    return cancelled({ item: item.name, crafted: heldCount(bot, item.id) - before });
  }

  // Success is judged by the inventory, not by the clicks: wait, bounded, for the product to show.
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
  const detail = { item: item.name, crafted, used_table: usedTable !== null };
  return completed(fewer ? { ...detail, message: FEWER_MESSAGE } : detail);
}

/** The player's own window: its 2x2 grid is closed by this id, never opened. */
const PLAYER_WINDOW_ID = 0;

/** Closes the player's grid so the server returns what a stopped craft left in it. Never throws. */
function returnGrid(bot: Bot): void {
  try {
    const client = bot._client as unknown as
      | { write(name: string, params: Record<string, unknown>): void }
      | undefined;
    client?.write('close_window', { windowId: PLAYER_WINDOW_ID });
  } catch (error) {
    console.warn(`player grid did not close: ${errorText(error)}`);
  }
}

/** Crafts `times` of a recipe with the library's craft, one batch at a time, checking the signal between them. */
async function craftByLibrary(ctx: ActionContext, recipe: Recipe, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    if (ctx.signal.aborted) break;
    await ctx.bot.craft(recipe, 1);
  }
}

/**
 * A recipe-book stop after some crafts: a cancel or a timeout keeps the count made so far, as the
 * `bot.craft` path does. Other stops (not unlocked, a blocked open) pass through unchanged.
 */
function withCrafted(stop: ActionOutcome, item: string, crafted: number): ActionOutcome {
  if (stop.status === 'cancelled') return cancelled({ ...stop.detail, item, crafted });
  if (stop.status === 'failed' && stop.reason === 'timeout') {
    return failed('timeout', stop.message, { ...stop.detail, crafted });
  }
  return stop;
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
  const all = bot.recipesAll(item.id, null, true);
  if (all.length === 0) {
    return failed('not_possible', 'not craftable');
  }
  // Preflight: the recipe, the ingredients and the station are checked together, so one failure
  // names everything that is missing, not only the first thing.
  const needsStation = !table && bot.recipesAll(item.id, null, null).length === 0;
  const best = pickRecipe(bot, needsStation ? all : bot.recipesAll(item.id, null, table), count);
  if (!best) return failed('not_possible', 'not craftable');
  const missing = shortfall(bot, best, count);
  const parts = Object.entries(missing).map(([name, n]) => `need ${n} more ${name}`);
  if (needsStation) {
    parts.push(`no crafting table within ${TABLE_RANGE} blocks`);
    return failed('missing_station', parts.join('; '), { item: item.name, missing });
  }
  return failed('missing_materials', parts.join('; ') || 'missing materials', { missing });
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
