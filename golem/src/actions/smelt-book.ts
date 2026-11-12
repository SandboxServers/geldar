import type { Bot } from 'mineflayer';

/**
 * Smelting recipes from the server's recipe book (decision 0048): the agent learns a smelting recipe
 * only when the server unlocks it. There is deliberately no table of "common" recipes here, because
 * that would grant knowledge the agent has not discovered.
 *
 * A furnace display in `recipe_book_add` names its ingredient, result and crafting station as slot
 * displays. Only the `item` (a bare item id) and `item_stack` (a stack template) ingredient forms
 * are understood; a `tag` ingredient (all logs, for charcoal) is skipped, because tags are not
 * resolved on the client.
 */

/** A slot display as the protocol sends it. */
interface SlotDisplay {
  type: string;
  data?: number | { itemId?: number } | string;
}

/** The `recipe_book_add` fields read here. */
interface BookAdd {
  replace?: boolean;
  entries: {
    recipe: {
      displayId: number;
      display: {
        type: string;
        data?: { ingredient?: SlotDisplay; result?: SlotDisplay; craftingStation?: SlotDisplay };
      };
    };
  }[];
}

/** The `recipe_book_remove` fields read here. */
interface BookRemove {
  recipeIds: number[];
}

interface BookClient {
  on(event: string, listener: (packet: unknown) => void): unknown;
}

/** One unlocked smelting recipe: put `input` in, get `output`, in a furnace of kind `station`. */
export interface SmeltRecipe {
  input: number;
  output: number;
  /** The furnace block the recipe names (furnace, smoker, blast_furnace), or null when unnamed. */
  station: string | null;
}

const books = new WeakMap<Bot, Map<number, SmeltRecipe>>();

/** The item id of an `item` or `item_stack` display, else null. */
function itemOf(display: SlotDisplay | undefined): number | null {
  if (!display) return null;
  if (display.type === 'item' && typeof display.data === 'number') return display.data;
  if (display.type === 'item_stack' && typeof display.data === 'object') {
    return display.data.itemId ?? null;
  }
  return null;
}

/**
 * Starts recording the smelting recipes the server unlocks for this bot. ConnectionManager calls it
 * at bot creation, next to `watchRecipeBook`: the server sends the book at join.
 */
export function watchSmeltBook(bot: Bot): void {
  if (books.has(bot)) return;
  const client = bot._client as unknown as BookClient | undefined;
  if (!client) return;
  const recipes = new Map<number, SmeltRecipe>();
  books.set(bot, recipes);
  client.on('recipe_book_add', (packet: unknown) => {
    const { replace, entries } = packet as BookAdd;
    if (replace) recipes.clear();
    for (const { recipe } of entries) {
      if (recipe.display.type !== 'furnace') continue;
      const input = itemOf(recipe.display.data?.ingredient);
      const output = itemOf(recipe.display.data?.result);
      if (input === null || output === null) continue;
      const stationId = itemOf(recipe.display.data?.craftingStation);
      const station = stationId === null ? null : (bot.registry?.items[stationId]?.name ?? null);
      recipes.set(recipe.displayId, { input, output, station });
    }
  });
  client.on('recipe_book_remove', (packet: unknown) => {
    for (const id of (packet as BookRemove).recipeIds) recipes.delete(id);
  });
}

/** True when this bot's smelting book is being recorded. */
export function smeltBookWatched(bot: Bot): boolean {
  return books.has(bot);
}

/** The unlocked smelting recipes that make an item, in the order the server sent them. */
export function smeltRecipesFor(bot: Bot, outputId: number): SmeltRecipe[] {
  return [...(books.get(bot)?.values() ?? [])].filter((r) => r.output === outputId);
}
