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

/** The `recipe_book_add` fields read here: the unlocked displays, `replace` on a full resend. */
interface RecipeBookAdd {
  replace?: boolean;
  entries: {
    recipe: {
      displayId: number;
      display: { type: string; data?: { result?: { data?: { itemId?: number } } } };
    };
  }[];
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

/** The recipe display types a table can craft from. Other types are special recipes (dye, banners). */
const CRAFTING_DISPLAYS = new Set(['crafting_shaped', 'crafting_shapeless']);
/** The crafting table's result slot: the craft is taken from here. */
const RESULT_SLOT = 0;
/** Wall-clock wait for the table window to open, scaled by `timeScale`. */
const TABLE_OPEN_WAIT_MS = 5_000;
/** Wall-clock wait for the result slot after each recipe request, scaled by `timeScale`. */
const RESULT_WAIT_MS = 5_000;
/** Wall-clock wait for the server to acknowledge a shift-click, scaled by `timeScale`. */
const CLICK_ACK_WAIT_MS = 3_000;

/**
 * The recipe displays the server has unlocked per bot: display id to the result's item id. Filled
 * by `watchRecipeBook` from the bot's first packets, because the server sends the book at join.
 */
const unlocked = new WeakMap<Bot, Map<number, number>>();
/** The late-window cleanup of the last open per bot, so the next craft can remove a stale one. */
const lateTableWindow = new WeakMap<Bot, () => void>();

/**
 * Starts recording the bot's recipe book. Call it as soon as the bot exists: the server sends the
 * unlocked recipes at join, and a listener attached later misses them. Idempotent per bot.
 */
export function watchRecipeBook(bot: Bot): void {
  if (unlocked.has(bot)) return;
  const displays = new Map<number, number>();
  unlocked.set(bot, displays);
  const client = bot._client as unknown as RecipeClient;
  client.on('recipe_book_add', (packet: unknown) => {
    const { replace, entries } = packet as RecipeBookAdd;
    if (replace) displays.clear();
    for (const { recipe } of entries) {
      const { displayId, display } = recipe;
      const resultId = display.data?.result?.data?.itemId;
      if (CRAFTING_DISPLAYS.has(display.type) && resultId !== undefined) {
        displays.set(displayId, resultId);
      }
    }
  });
}

/**
 * The unlocked crafting displays whose result is this item. One item can have several (a bed has
 * its wool-and-planks shape and a dye recolour), and the server answers a wrong one with nothing.
 */
function unlockedDisplays(bot: Bot, resultId: number): number[] {
  const ids: number[] = [];
  for (const [displayId, itemId] of unlocked.get(bot) ?? []) {
    if (itemId === resultId) ids.push(displayId);
  }
  return ids;
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
  let displayIds = unlockedDisplays(bot, item.id);
  if (displayIds.length === 0) {
    return failed(
      'missing_materials',
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
  try {
    let windowId = PLAYER_WINDOW_ID;
    if (table) {
      const opened = await openTable(ctx, table);
      if ('outcome' in opened) return opened.outcome;
      windowId = opened.window.id;
    }
    for (let i = 0; i < times; i++) {
      const crafted = await craftOnce(ctx, client, windowId, displayIds, states, item.name);
      if ('outcome' in crafted) return crafted.outcome;
      // The display that worked is tried first on the next craft.
      displayIds = [crafted.displayId, ...displayIds.filter((id) => id !== crafted.displayId)];
    }
    return null;
  } finally {
    client.removeListener('window_items', trackState);
    client.removeListener('set_slot', trackState);
    // Only a table window is closed: window 0 is the player's inventory, not one this craft opened.
    if (table && bot.currentWindow) {
      await bot.closeWindow(bot.currentWindow).catch((error: unknown) => {
        console.warn(`crafting table window did not close: ${errorText(error)}`);
      });
    }
  }
}

/**
 * One craft: request each candidate display into the grid until one fills the result, then
 * shift-click that result. Returns the display that worked, or the outcome that ended the craft.
 */
async function craftOnce(
  ctx: ActionContext,
  client: RecipeClient,
  windowId: number,
  displayIds: number[],
  states: Map<number, number>,
  name: string,
): Promise<{ displayId: number } | { outcome: ActionOutcome }> {
  for (const displayId of displayIds) {
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

/** How a wait for the result slot ended. */
type ResultWait = 'filled' | 'timeout' | 'aborted';

/**
 * Resolves when the window's result slot gets a stack, or when the bounded wait runs out or the
 * signal aborts. The listener is removed on every path.
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
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onSlot = (packet: unknown): void => {
      const set = packet as SetSlot;
      if (set.windowId === windowId && set.slot === RESULT_SLOT && isStack(set.item)) {
        finish('filled');
      }
    };
    const onAbort = (): void => finish('aborted');
    client.on('set_slot', onSlot);
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
