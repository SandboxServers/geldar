import type { Bot } from 'mineflayer';
import type { Block } from './bot-types.ts';
import { type ActionOutcome, cancelled, errorText, failed } from './outcome.ts';
import { pollUntil } from './poll.ts';
import type { ActionContext } from './registry.ts';

type Window = NonNullable<Bot['currentWindow']>;

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
      display: { type: string; data?: { result?: SlotDisplay } };
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
  item?: { present?: boolean; itemCount?: number } | null;
}

/** A crafting display the book unlocked: the item one craft of it makes, and how many. */
interface Display {
  itemId: number;
  count: number;
}

/** The recipe displays the table can craft from. Other types are special recipes (dye, banners). */
const CRAFTING_DISPLAYS = new Set(['crafting_shaped', 'crafting_shapeless']);
/** The crafting table's result slot: the craft is taken from here. */
const RESULT_SLOT = 0;
/** Wall-clock wait for the table window to open, scaled by `timeScale`. */
const TABLE_OPEN_WAIT_MS = 5_000;
/** Wall-clock wait for the result slot after each recipe request, scaled by `timeScale`. */
const RESULT_WAIT_MS = 5_000;
/**
 * Wall-clock wait, after the server answers a recipe request, for the result slot to fill. A display
 * the server answers but does not fill is a miss after this wait, not after `RESULT_WAIT_MS`.
 */
const ANSWER_GRACE_MS = 1_000;
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
/** The late-window cleanup of the last open per bot, so the next craft can remove a stale one. */
const lateTableWindow = new WeakMap<Bot, () => void>();

/**
 * Starts recording the bot's recipe book. Call it as soon as the bot exists: the server sends the
 * unlocked recipes at join, and a listener attached later misses them. Idempotent per bot.
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
        displays.set(recipe.displayId, result);
      }
    }
  });
  client.on('recipe_book_remove', (packet: unknown) => {
    const { recipeIds } = packet as RecipeBookRemove;
    for (const id of recipeIds) displays.delete(id);
  });
}

/**
 * What a recipe's result display makes, and how many per craft. Null when the display is not an item
 * (a tag or a composite), which a craft cannot read a count from.
 */
function resultOf(result: SlotDisplay | undefined): Display | null {
  const data = result?.data;
  if (result?.type === 'item' && typeof data === 'number') return { itemId: data, count: 1 };
  if (result?.type === 'item_stack' && typeof data === 'object') {
    return { itemId: data.itemId, count: data.itemCount ?? 1 };
  }
  return null;
}

/**
 * The unlocked crafting displays whose result is this item, the working one first. One item can have
 * several (a bed has its wool-and-planks shape and a dye recolour), and the server answers a wrong
 * one with nothing.
 */
function unlockedDisplays(bot: Bot, resultId: number): { displayId: number; count: number }[] {
  const found: { displayId: number; count: number }[] = [];
  for (const [displayId, display] of unlocked.get(bot) ?? []) {
    if (display.itemId === resultId) found.push({ displayId, count: display.count });
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
  ctx: ActionContext,
  item: TableTarget,
  times: number,
  table: Block | null,
): Promise<ActionOutcome | null> {
  const { bot } = ctx;
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
  try {
    let windowId = PLAYER_WINDOW_ID;
    if (table) {
      const opened = await openTable(ctx, table);
      if ('outcome' in opened) return opened.outcome;
      windowId = opened.window.id;
    }
    for (let i = 0; i < times; i++) {
      // Read per craft: the display that worked last craft is first now.
      const crafted = await craftOnce(
        ctx,
        client,
        windowId,
        unlockedDisplays(bot, item.id),
        states,
        item.name,
      );
      if ('outcome' in crafted) return crafted.outcome;
      rememberWorking(bot, item.id, crafted.displayId);
    }
    clean = true;
    return null;
  } finally {
    client.removeListener('window_items', trackState);
    client.removeListener('set_slot', trackState);
    // Only a table window is closed: window 0 is the player's inventory, not one this craft opened.
    if (table && bot.currentWindow) {
      await bot.closeWindow(bot.currentWindow).catch((error: unknown) => {
        console.warn(`crafting table window did not close: ${errorText(error)}`);
      });
    } else if (!table && !clean) {
      closePlayerGrid(client);
    }
  }
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
  candidates: { displayId: number }[],
  states: Map<number, number>,
  name: string,
): Promise<{ displayId: number } | { outcome: ActionOutcome }> {
  for (const { displayId } of candidates) {
    if (ctx.signal.aborted) return { outcome: cancelled() };
    const landed = awaitResult(ctx, client, windowId);
    client.write('craft_recipe_request', { windowId, recipeId: displayId, makeAll: false });
    const result = await landed;
    if (result === 'aborted') return { outcome: cancelled() };
    if (result === 'filled') {
      await shiftClick(ctx, client, windowId, states);
      return { displayId };
    }
  }
  return {
    outcome: failed('timeout', `the crafting table did not produce ${name}`, { item: name }),
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
 * The listeners and the timer are released on every path.
 */
function awaitResult(
  ctx: ActionContext,
  client: RecipeClient,
  windowId: number,
): Promise<ResultWait> {
  const { signal, timeScale } = ctx;
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: ResultWait): void => {
      clearTimeout(timer);
      client.removeListener('set_slot', onSlot);
      client.removeListener('craft_recipe_response', onAnswer);
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onSlot = (packet: unknown): void => {
      const set = packet as SetSlot;
      if (set.windowId === windowId && set.slot === RESULT_SLOT && isStack(set.item)) {
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
  });
}

/** Whether a slot's item is a stack with at least one item. */
function isStack(item: SetSlot['item']): boolean {
  return item != null && (item.present === true || (item.itemCount ?? 0) > 0);
}

/** The open window, or the outcome of the open that failed. */
type Opened = { window: Window } | { outcome: ActionOutcome };

/**
 * Activates the table and waits for its window, bounded and abortable. Mineflayer's own open waits
 * with no timeout. A window that opens after the wait gave up is closed at once.
 */
async function openTable(ctx: ActionContext, table: Block): Promise<Opened> {
  const { bot, signal, timeScale } = ctx;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onOpen: ((window: Window) => void) | undefined;
  let onAbort: (() => void) | undefined;
  const opened = new Promise<Opened>((resolve) => {
    const settle = (result: Opened): void => resolve(result);
    onOpen = (window: Window) => {
      if (isCraftingWindow(window)) {
        settle({ window });
      } else {
        settle({
          outcome: failed('blocked', `opened ${String(window.type)}, not a crafting table`),
        });
      }
    };
    onAbort = () => settle({ outcome: cancelled() });
    bot.on('windowOpen', onOpen);
    signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(
      () => settle({ outcome: failed('timeout', 'crafting table did not open') }),
      TABLE_OPEN_WAIT_MS * timeScale,
    );
    bot.activateBlock(table).catch((error: unknown) => {
      settle({ outcome: failed('blocked', `crafting table did not open: ${errorText(error)}`) });
    });
  });
  try {
    const result = await opened;
    if ('outcome' in result) closeLateWindow(bot, TABLE_OPEN_WAIT_MS * timeScale);
    return result;
  } finally {
    clearTimeout(timer);
    if (onOpen) bot.off('windowOpen', onOpen);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** Whether a window is a crafting table's: its 26.1 type name starts with `minecraft:crafting`. */
function isCraftingWindow(window: Window): boolean {
  return typeof window.type === 'string' && window.type.startsWith('minecraft:crafting');
}

/** Closes a table window that opens after its wait gave up. The listener goes after one more wait. */
function closeLateWindow(bot: Bot, waitMs: number): void {
  dropLateTableWindow(bot);
  const late = (window: Window): void => {
    // Only a crafting window is closed: any other window that opens next belongs to another action.
    if (!isCraftingWindow(window)) return;
    dropLateTableWindow(bot);
    bot.closeWindow(window).catch((error: unknown) => {
      console.warn(`late crafting table window did not close: ${errorText(error)}`);
    });
  };
  const timer = setTimeout(() => dropLateTableWindow(bot), waitMs);
  bot.on('windowOpen', late);
  lateTableWindow.set(bot, () => {
    clearTimeout(timer);
    bot.off('windowOpen', late);
  });
}

/** Removes the bot's late-window listener and its timer, if one is armed. */
function dropLateTableWindow(bot: Bot): void {
  lateTableWindow.get(bot)?.();
  lateTableWindow.delete(bot);
}
