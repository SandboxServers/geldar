import type { Bot } from 'mineflayer';
import type { Block } from './bot-types.ts';
import { type Cell, cellsOf, type IngredientDisplay, shortfallOf } from './craft-ingredients.ts';
import { dropLateTableWindow, openTable } from './craft-table-window.ts';
import { heldCount } from './inventory-count.ts';
import { type ActionOutcome, cancelled, errorText, failed } from './outcome.ts';
import { pollUntil } from './poll.ts';
import type { ActionContext } from './registry.ts';

/** What a table craft makes: the item id the recipe results in, and its name for the outcome. */
export interface TableTarget {
  id: number;
  name: string;
}

/**
 * The protocol client the table path reads and writes: Mineflayer's `bot._client`. Only the
 * methods used here are typed.
 */
interface RecipeClient {
  on(event: string, listener: (packet: unknown) => void): unknown;
  removeListener(event: string, listener: (packet: unknown) => void): unknown;
  write(name: string, params: Record<string, unknown>): void;
}

/**
 * A recipe result slot display, as the 26.1 protocol sends it: `item` carries a bare item id, and
 * `item_stack` carries an item stack template (its id and count).
 */
interface SlotDisplay {
  type: string;
  data?: number | { itemId: number; itemCount?: number };
}

/** The `recipe_book_add` fields read here: the unlocked displays, `replace` on a full resend. */
interface RecipeBookAdd {
  replace?: boolean;
  entries: {
    recipe: {
      displayId: number;
      display: {
        type: string;
        data?: { result?: SlotDisplay; ingredients?: IngredientDisplay[] };
      };
    };
  }[];
}

/** The `recipe_book_remove` fields read here: the display ids the server has taken back. */
interface RecipeBookRemove {
  recipeIds: number[];
}

/** The fields every window-state packet carries: the window and the stateId it is at. */
interface WindowState {
  windowId: number;
  stateId: number;
}

/** A `set_slot` packet: one slot of one window, with its stack (absent or empty when cleared). */
interface SetSlot extends WindowState {
  slot: number;
  item?: { present?: boolean; itemId?: number; itemCount?: number } | null;
}

/** A crafting display the book unlocked: the item one craft of it makes, and how many. */
interface Display {
  itemId: number;
  count: number;
  /** The grid cells the recipe fills, as item-id alternatives (tags are left out). */
  cells: Cell[];
}

/**
 * The context a book craft runs in. `want` is the number of items still needed: when set, the craft
 * stops once the inventory has gained that many, and `times` is only the caller's guess.
 */
export type BookContext = ActionContext & { want?: number };

/** The recipe displays the table can craft from. Other types are special recipes (dye, banners). */
const CRAFTING_DISPLAYS = new Set(['crafting_shaped', 'crafting_shapeless']);
/** The crafting table's result slot: the craft is taken from here. */
const RESULT_SLOT = 0;
/** Wall-clock wait for the result slot after each recipe request, scaled by `timeScale`. */
const RESULT_WAIT_MS = 5_000;
/**
 * Wall-clock wait, after the server answers a recipe request, for the result slot to fill. A display
 * the server answers but does not fill is a miss after this wait, not after `RESULT_WAIT_MS`.
 */
const ANSWER_GRACE_MS = 1_000;
/** Wall-clock wait for the inventory to show a shift-click's items, scaled by `timeScale`. */
const GAIN_WAIT_MS = 2_000;
/** Crafts in a row that may gain nothing, with a want, before the craft gives up. */
const MAX_ZERO_GAIN = 2;
/** Wall-clock wait for the server to acknowledge a shift-click, scaled by `timeScale`. */
const CLICK_ACK_WAIT_MS = 3_000;

/**
 * The recipe displays the server has unlocked per bot: display id to what it makes. Filled by
 * `watchRecipeBook` from the bot's first packets, because the server sends the book at join.
 */
const unlocked = new WeakMap<Bot, Map<number, Display>>();
/**
 * The display that last crafted each item per bot: its item id to the display id. It is tried first
 * on the next craft, so a display that works is not preceded by one that does not.
 */
const workingDisplay = new WeakMap<Bot, Map<number, number>>();

/**
 * Starts recording the bot's recipe book. ConnectionManager calls it on every bot it creates, as
 * soon as the bot exists: the server sends the unlocked recipes at join, and a listener attached
 * later misses them. Idempotent per bot.
 */
export function watchRecipeBook(bot: Bot): void {
  if (unlocked.has(bot)) return;
  // A bot without a protocol client (a test double) sends and receives no packets: nothing to record.
  const client = bot._client as unknown as RecipeClient | undefined;
  if (!client) return;
  const displays = new Map<number, Display>();
  unlocked.set(bot, displays);
  client.on('recipe_book_add', (packet: unknown) => {
    const { replace, entries } = packet as RecipeBookAdd;
    if (replace) displays.clear();
    for (const { recipe } of entries) {
      const result = resultOf(recipe.display.data?.result);
      if (CRAFTING_DISPLAYS.has(recipe.display.type) && result) {
        displays.set(recipe.displayId, {
          ...result,
          cells: cellsOf(recipe.display.data?.ingredients),
        });
      }
    }
  });
  client.on('recipe_book_remove', (packet: unknown) => {
    const { recipeIds } = packet as RecipeBookRemove;
    for (const id of recipeIds) displays.delete(id);
  });
}

/** The names of the items the unlocked crafting displays make: sorted and unique (decision 0048). */
export function unlockedResultItems(bot: Bot): string[] {
  const names = new Set<string>();
  for (const { itemId } of unlocked.get(bot)?.values() ?? []) {
    const name = bot.registry?.items[itemId]?.name;
    if (name) names.add(name);
  }
  return [...names].sort();
}

/**
 * What a recipe's result display makes, and how many per craft. Null when the display is not an item
 * (a tag or a composite), which a craft cannot read a count from.
 */
function resultOf(result: SlotDisplay | undefined): Omit<Display, 'cells'> | null {
  const data = result?.data;
  if (result?.type === 'item' && typeof data === 'number') return { itemId: data, count: 1 };
  if (result?.type === 'item_stack' && typeof data === 'object') {
    return { itemId: data.itemId, count: data.itemCount ?? 1 };
  }
  return null;
}

/** An unlocked display a craft can request: its id, its yield and its grid cells. */
interface BookDisplay {
  displayId: number;
  count: number;
  cells: Cell[];
}

/**
 * The unlocked crafting displays whose result is this item, the working one first. One item can have
 * several (a bed has its wool-and-planks shape and a dye recolour), and the server answers a wrong
 * one with nothing.
 */
function unlockedDisplays(bot: Bot, resultId: number): BookDisplay[] {
  const found: BookDisplay[] = [];
  for (const [displayId, display] of unlocked.get(bot) ?? []) {
    if (display.itemId === resultId) {
      found.push({ displayId, count: display.count, cells: display.cells });
    }
  }
  const working = workingDisplay.get(bot)?.get(resultId);
  // The sort is stable: the working display first, the rest in the book's order.
  found.sort((a, b) => Number(b.displayId === working) - Number(a.displayId === working));
  return found;
}

/**
 * How many items one craft of this item makes, by the display the craft uses: the working display
 * when one is known, else the first unlocked one. Zero when the book has none.
 */
export function bookYield(bot: Bot, item: TableTarget): number {
  return unlockedDisplays(bot, item.id)[0]?.count ?? 0;
}

/** Records the display that crafted this item for this bot, so it is tried first next time. */
function rememberWorking(bot: Bot, itemId: number, displayId: number): void {
  let byItem = workingDisplay.get(bot);
  if (!byItem) {
    byItem = new Map<number, number>();
    workingDisplay.set(bot, byItem);
  }
  byItem.set(itemId, displayId);
}

/** The window id of the player's own inventory, whose 2x2 crafting grid needs no open. */
const PLAYER_WINDOW_ID = 0;

/** Whether the recipe book has an unlocked crafting display for this item. */
export function hasUnlockedDisplay(bot: Bot, item: TableTarget): boolean {
  return unlockedDisplays(bot, item.id).length > 0;
}

/**
 * Crafts `times` of a recipe through the server's recipe book, the way the vanilla client does: a
 * `craft_recipe_request` fills the grid, the result is shift-clicked, and the window's own stateId is
 * sent with the click. The window is the table's when `table` is given, opened here and closed
 * here; with no table it is the player's own 2x2 grid (window 0), which is neither opened nor
 * closed. Mineflayer's `craft` is not used, because its stateId is one value shared by every window,
 * and on 26.1 the table rejects it (see the 26.1 craft diagnosis). Returns null when every craft ran,
 * else the outcome that stopped it.
 */
export async function craftFromBook(
  ctx: BookContext,
  item: TableTarget,
  times: number,
  table: Block | null,
): Promise<ActionOutcome | null> {
  const { bot } = ctx;
  // A bot with a client that was never watched has an empty book it cannot tell from a locked
  // recipe: ConnectionManager calls watchRecipeBook at bot creation (decision 0032).
  if (bot._client && !unlocked.has(bot)) {
    console.warn('recipe book is not watched: call watchRecipeBook when the bot is created');
    return failed('internal', 'recipe book is not watched');
  }
  dropLateTableWindow(bot);
  if (!hasUnlockedDisplay(bot, item)) {
    // Not missing_materials: the Mind holds the ingredients and must not go gathering them.
    return failed(
      'not_possible',
      `${item.name} is not unlocked: its recipe is not in the recipe book`,
      { item: item.name, unlocked: false },
    );
  }

  const client = bot._client as unknown as RecipeClient;
  // Each window's latest stateId, from the packets that name that window.
  const states = new Map<number, number>();
  const trackState = (packet: unknown): void => {
    const { windowId, stateId } = packet as WindowState;
    states.set(windowId, stateId);
  };
  client.on('window_items', trackState);
  client.on('set_slot', trackState);
  // Set once every craft ran. Until then a grid may still hold the ingredients of a craft that stopped.
  let clean = false;
  let leftovers = false;
  try {
    let windowId = PLAYER_WINDOW_ID;
    if (table) {
      const opened = await openTable(ctx, table);
      if ('outcome' in opened) return opened.outcome;
      windowId = opened.window.id;
    }
    // With a target, the yield is what the inventory gained, not a guess and not the result slot's
    // stack (the 26.1 server shows a count that is not what the shift-click moves): one craft per
    // loop until the target is met. A craft that gains nothing counts as 0, so `want` bounds the loop.
    const want = ctx.want;
    const before = heldNow(bot, item.id);
    let made = 0;
    let zeroGain = 0;
    const crafts = want === undefined ? times : want;
    for (let i = 0; i < crafts && (want === undefined || made < want); i++) {
      // Read per craft: the display that worked last craft is first now.
      const crafted = await craftOnce(
        ctx,
        client,
        windowId,
        unlockedDisplays(bot, item.id),
        states,
        item,
      );
      if ('outcome' in crafted) return crafted.outcome;
      rememberWorking(bot, item.id, crafted.displayId);
      if (want === undefined) continue;
      // The shift-click's items land a moment after its ack: wait, bounded, for the count to rise.
      await pollUntil(bot, ctx.signal, () => heldNow(bot, item.id) - before > made, {
        wallMs: GAIN_WAIT_MS * ctx.timeScale,
      });
      const now = Math.max(made, heldNow(bot, item.id) - before);
      zeroGain = now > made ? 0 : zeroGain + 1;
      made = now;
      // Crafts that deliver nothing (a full inventory leaves the result in the slot) would repeat to the end.
      if (zeroGain >= MAX_ZERO_GAIN) {
        return failed(
          'not_possible',
          `crafting ${item.name} gained nothing ${MAX_ZERO_GAIN} times in a row: the inventory may be full`,
          { item: item.name, made },
        );
      }
    }
    clean = true;
    // A recipe can leave items in the grid (a bucket from a cake): closing the grid returns them.
    leftovers = windowId === PLAYER_WINDOW_ID && gridHoldsItems(bot);
    return null;
  } finally {
    client.removeListener('window_items', trackState);
    client.removeListener('set_slot', trackState);
    // Only a table window is closed: window 0 is the player's inventory, not one this craft opened.
    if (table && bot.currentWindow) {
      await bot.closeWindow(bot.currentWindow).catch((error: unknown) => {
        console.warn(`crafting table window did not close: ${errorText(error)}`);
      });
    } else if (!table && (!clean || leftovers)) {
      closePlayerGrid(client);
    }
  }
}

/**
 * How many of an item the bot holds now. An open table window holds the shift-clicked items in its
 * own slots while `bot.inventory` catches up only on close, so the larger of the two views counts.
 */
function heldNow(bot: Bot, itemId: number): number {
  const own = heldCount(bot, itemId);
  const window = bot.currentWindow;
  if (!window || window.id === PLAYER_WINDOW_ID) return own;
  let inWindow = 0;
  // The window's own inventory slots only: slots before inventoryStart are the grid and its result.
  for (const stack of window.slots.slice(window.inventoryStart)) {
    if (stack?.type === itemId) inWindow += stack.count;
  }
  return Math.max(own, inWindow);
}

/** Whether the player's own 2x2 grid (inventory slots 1 to 4) still holds an item. */
function gridHoldsItems(bot: Bot): boolean {
  const slots = bot.inventory?.slots as unknown[] | undefined;
  return (slots ?? []).slice(1, 5).some((stack) => stack != null);
}

/**
 * Closes the player's 2x2 grid (window 0) after a stopped craft. The server then returns the ingredients
 * a request moved into the grid to the inventory. A failed write is logged, not thrown over the outcome.
 */
function closePlayerGrid(client: RecipeClient): void {
  try {
    client.write('close_window', { windowId: PLAYER_WINDOW_ID });
  } catch (error) {
    console.warn(`player grid did not close: ${errorText(error)}`);
  }
}

/**
 * One craft: request each candidate display into the grid until one fills the result, then
 * shift-click that result. A display that is answered without a result, or that stays silent, is
 * a miss and the next one is requested. Returns the display that worked, or the outcome that ended
 * the craft.
 */
async function craftOnce(
  ctx: ActionContext,
  client: RecipeClient,
  windowId: number,
  candidates: BookDisplay[],
  states: Map<number, number>,
  item: TableTarget,
): Promise<{ displayId: number } | { outcome: ActionOutcome }> {
  const { name } = item;
  // Pre-check: a variant the inventory cannot cover is never requested, so no ingredient moves.
  let shortest: { name: string; short: number } | null = null;
  for (const { displayId, cells } of candidates) {
    if (ctx.signal.aborted) return { outcome: cancelled() };
    const lack = shortfallOf(cells, (id) => heldNow(ctx.bot, id));
    if (lack) {
      shortest ??= {
        name: ctx.bot.registry?.items[lack.id]?.name ?? 'an ingredient',
        short: lack.short,
      };
      continue;
    }
    const write = (): void =>
      client.write('craft_recipe_request', { windowId, recipeId: displayId, makeAll: false });
    const result = await awaitResult(ctx, client, windowId, write, item.id);
    if (result === 'aborted') return { outcome: cancelled() };
    if (result === 'filled') {
      await shiftClick(ctx, client, windowId, states);
      return { displayId };
    }
  }
  // Every variant was short: say which item and how many, with no request sent.
  if (
    shortest &&
    candidates.every(({ cells }) => shortfallOf(cells, (id) => heldNow(ctx.bot, id)))
  ) {
    return {
      outcome: failed(
        'missing_materials',
        `missing ${shortest.short} more ${shortest.name} to craft ${name}`,
        { item: name, missing: { [shortest.name]: shortest.short } },
      ),
    };
  }
  // With no table the craft is the player's grid: the message does not name a table it never used.
  const source = windowId === PLAYER_WINDOW_ID ? 'the recipe' : 'the crafting table';
  return {
    outcome: failed('timeout', `${source} did not produce ${name}`, { item: name }),
  };
}

/**
 * Shift-clicks the result, then waits until the server acknowledges it, so the window is not closed
 * (and the next craft not started) while the click is still in flight. The ack is the result slot
 * clearing, or a full resend of the window. The wait is bounded: a server that never acks is not
 * waited for past it, and the caller judges the craft by the inventory.
 */
async function shiftClick(
  ctx: ActionContext,
  client: RecipeClient,
  windowId: number,
  states: Map<number, number>,
): Promise<void> {
  let acked = false;
  const onSlot = (packet: unknown): void => {
    const set = packet as SetSlot;
    if (set.windowId === windowId && set.slot === RESULT_SLOT && !isStack(set.item)) acked = true;
  };
  const onItems = (packet: unknown): void => {
    if ((packet as WindowState).windowId === windowId) acked = true;
  };
  // The listeners go on before the write: a reply may arrive synchronously.
  client.on('set_slot', onSlot);
  client.on('window_items', onItems);
  try {
    // Read at click time: the result slot's own packet has already moved the window's stateId on.
    client.write('window_click', {
      windowId,
      stateId: states.get(windowId) ?? -1,
      slot: RESULT_SLOT,
      mouseButton: 0,
      mode: 1,
      changedSlots: [],
      // An empty cursor is `null` on the wire (an optional HashedSlot), as Mineflayer writes it.
      cursorItem: null,
    });
    await pollUntil(ctx.bot, ctx.signal, () => acked, {
      wallMs: CLICK_ACK_WAIT_MS * ctx.timeScale,
    });
  } finally {
    client.removeListener('set_slot', onSlot);
    client.removeListener('window_items', onItems);
  }
}

/** How a wait for the result slot ended: filled, missed (answered, no result), timed out, or aborted. */
type ResultWait = 'filled' | 'missed' | 'timeout' | 'aborted';

/**
 * Resolves when the window's result slot gets a stack. If the server answers the request with a
 * `craft_recipe_response` for this window and no stack follows within the grace, it resolves as a
 * miss at once. Otherwise it resolves on the bounded wait running out, or when the signal aborts.
 * The request is sent by `send` once the listeners and the timer are armed, since a reply may arrive
 * synchronously. If `send` throws, the wait is released and the error rejects. The listeners and the
 * timer are released on every path.
 */
function awaitResult(
  ctx: ActionContext,
  client: RecipeClient,
  windowId: number,
  send: () => void,
  itemId: number,
): Promise<ResultWait> {
  const { signal, timeScale } = ctx;
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = (): void => {
      clearTimeout(timer);
      client.removeListener('set_slot', onSlot);
      client.removeListener('craft_recipe_response', onAnswer);
      signal.removeEventListener('abort', onAbort);
    };
    const finish = (result: ResultWait): void => {
      release();
      resolve(result);
    };
    const onSlot = (packet: unknown): void => {
      const set = packet as SetSlot;
      // State-based: only the wanted item in the result slot counts. A different item (the server
      // filled another recipe) is not shift-clicked, and the wait ends as a miss or timeout.
      const wrong = set.item?.itemId !== undefined && set.item.itemId !== itemId;
      if (set.windowId === windowId && set.slot === RESULT_SLOT && isStack(set.item) && !wrong) {
        finish('filled');
      }
    };
    const onAnswer = (packet: unknown): void => {
      if ((packet as WindowState).windowId !== windowId) return;
      clearTimeout(timer);
      timer = setTimeout(() => finish('missed'), ANSWER_GRACE_MS * timeScale);
    };
    const onAbort = (): void => finish('aborted');
    client.on('set_slot', onSlot);
    client.on('craft_recipe_response', onAnswer);
    signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish('timeout'), RESULT_WAIT_MS * timeScale);
    try {
      send();
    } catch (error) {
      release();
      reject(error);
    }
  });
}

/** Whether a slot's item is a stack with at least one item. */
function isStack(item: SetSlot['item']): boolean {
  return item != null && (item.present === true || (item.itemCount ?? 0) > 0);
}
