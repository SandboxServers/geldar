import type { Bot } from 'mineflayer';
import type { Block } from './bot-types.ts';
import { type ActionOutcome, cancelled, errorText, failed } from './outcome.ts';
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

/**
 * The recipe displays the server has unlocked per bot: display id to the result's item id. Filled
 * by `watchRecipeBook` from the bot's first packets, because the server sends the book at join.
 */
const unlocked = new WeakMap<Bot, Map<number, number>>();

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

/** The first unlocked crafting display whose result is this item, or undefined when none is. */
function unlockedDisplay(bot: Bot, resultId: number): number | undefined {
  for (const [displayId, itemId] of unlocked.get(bot) ?? []) {
    if (itemId === resultId) return displayId;
  }
  return undefined;
}

/**
 * Crafts `times` of a table recipe through the server's recipe book, the way the vanilla client
 * does: a `craft_recipe_request` fills the grid, the result is shift-clicked, and the table window's
 * own stateId is sent with the click. Mineflayer's `craft` is not used, because its stateId is one
 * value shared by every window, and on 26.1 the table rejects it (see the 26.1 craft diagnosis).
 * Returns null when every craft ran, else the outcome that stopped it. The window is closed here.
 */
export async function craftAtTable(
  ctx: ActionContext,
  table: Block,
  item: TableTarget,
  times: number,
): Promise<ActionOutcome | null> {
  const { bot } = ctx;
  const displayId = unlockedDisplay(bot, item.id);
  if (displayId === undefined) {
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
    const opened = await openTable(ctx, table);
    if ('outcome' in opened) return opened.outcome;
    for (let i = 0; i < times; i++) {
      const stop = await craftOnce(ctx, client, opened.window.id, displayId, states, item.name);
      if (stop) return stop;
    }
    return null;
  } finally {
    client.removeListener('window_items', trackState);
    client.removeListener('set_slot', trackState);
    if (bot.currentWindow) {
      await bot.closeWindow(bot.currentWindow).catch((error: unknown) => {
        console.warn(`crafting table window did not close: ${errorText(error)}`);
      });
    }
  }
}

/**
 * One craft: request the recipe into the grid, wait for the result, then shift-click it. Null when
 * the craft was sent, else the outcome that ended the wait.
 */
async function craftOnce(
  ctx: ActionContext,
  client: RecipeClient,
  windowId: number,
  displayId: number,
  states: Map<number, number>,
  name: string,
): Promise<ActionOutcome | null> {
  if (ctx.signal.aborted) return cancelled();
  const landed = awaitResult(ctx, client, windowId);
  client.write('craft_recipe_request', { windowId, recipeId: displayId, makeAll: false });
  const result = await landed;
  if (result === 'aborted') return cancelled();
  if (result === 'timeout') {
    return failed('timeout', `the crafting table did not produce ${name}`, { item: name });
  }
  // Read at click time: the result slot's own packet has already moved the window's stateId on.
  client.write('window_click', {
    windowId,
    stateId: states.get(windowId) ?? -1,
    slot: RESULT_SLOT,
    mouseButton: 0,
    mode: 1,
    changedSlots: [],
    cursorItem: { present: false },
  });
  return null;
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
    onOpen = (window: Window) => settle({ window });
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

/** Closes a table window that opens after its wait gave up. The listener goes after one more wait. */
function closeLateWindow(bot: Bot, waitMs: number): void {
  const late = (window: Window): void => {
    bot.closeWindow(window).catch((error: unknown) => {
      console.warn(`late crafting table window did not close: ${errorText(error)}`);
    });
  };
  bot.once('windowOpen', late);
  setTimeout(() => bot.off('windowOpen', late), waitMs);
}
