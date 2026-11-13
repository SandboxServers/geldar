import type { Bot, Furnace } from 'mineflayer';
import { Vec3 } from 'vec3';
import {
  type ContainerStack,
  type FurnaceSlots,
  type OpenedContents,
  RememberedContainers,
} from '../perception/remembered-containers.ts';
import type { Block, Container, Position } from './bot-types.ts';
import { transferItems } from './container-transfer.ts';
import { outcomeOfMove } from './move-outcome.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { moveNear } from './pathing.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/** The containers Phase 0 opens. Copper chests and their variants are out of scope. */
const CONTAINER_BLOCKS = new Set(['chest', 'trapped_chest', 'barrel']);
/** Farther than this from the block center, the bot walks to the container first. */
const REACH = 4.5;
/** Wall-clock wait for the window to open, scaled by `timeScale`. `openContainer` has no timeout. */
const OPEN_WAIT_MS = 5_000;
/** How long a lost open's late-window listener stays armed, scaled by `timeScale`. */
const LATE_WINDOW_WAIT_MS = 3 * OPEN_WAIT_MS;
/** Wall-clock wait for the server to confirm the window after a transfer, scaled by `timeScale`. */
const SETTLE_WAIT_MS = 5_000;
/** The late-window cleanup of the last open per bot, so the next open can remove a stale one. */
const lateWindowDrop = new WeakMap<Bot, () => void>();
/** The containers the Body has opened, per bot. A bot that ends takes its store with it. */
const remembered = new WeakMap<Bot, RememberedContainers>();
/**
 * The window types a late window can have: the 9-wide chest, trapped chest and barrel types,
 * which are `generic_<cols>x<rows>`, and the furnace. A crafting window is not one of them.
 */
const CONTAINER_WINDOW = /^minecraft:(generic_\d+x\d+|furnace)$/;
/** The window type mineflayer gives a furnace. */
const FURNACE_WINDOW = 'minecraft:furnace';
/**
 * The library's message when the bot's inventory cannot take the withdrawn stacks: "Bot inventory
 * is full" from the pre-check, "destination full" when a transfer stops part-way.
 */
const INVENTORY_FULL = /full/i;
/** A full container: the library's own wording is not known, so the word `full` is the match. */
const CONTAINER_FULL = /full/i;

type Window = NonNullable<Bot['currentWindow']>;
/** A window `open` can return: a chest-like container or a furnace. */
type Opening = Container | Furnace;

/** What the open race produced: the open window, or the outcome that ended it. */
type Opened<W> = { window: W } | { outcome: ActionOutcome };

/** A window the action can open: the blocks it accepts and the mineflayer call that opens each. */
interface Opener<W> {
  accepts(name: string): boolean;
  open(bot: Bot, block: Block): Promise<W>;
}

/** The container blocks only: `deposit` and `withdraw` take these. */
const CONTAINER_OPENER: Opener<Container> = {
  accepts: (name) => CONTAINER_BLOCKS.has(name),
  open: (bot, block) => bot.openContainer(block),
};

/** `open` takes a container or a furnace; a furnace is opened with mineflayer's own call. */
const ANY_OPENER: Opener<Opening> = {
  accepts: (name) => CONTAINER_BLOCKS.has(name) || name === 'furnace',
  open: (bot, block) =>
    block.name === 'furnace' ? bot.openFurnace(block) : bot.openContainer(block),
};

/** The block at a position when the opener accepts it, else null. */
function blockFor(bot: Bot, at: Position, accepts: (name: string) => boolean): Block | null {
  const block = bot.blockAt(new Vec3(at.x, at.y, at.z));
  return block && accepts(block.name) ? block : null;
}

/**
 * How many of an item the bot holds in its main inventory and hotbar, read from the open window.
 * While a container is open, mineflayer applies the clicks to the window; `bot.inventory` only
 * catches up when the window closes, so it is stale during `fn`.
 */
function inventoryCount(container: Container, itemId: number): number {
  // `count` covers the window's player region: main inventory and hotbar, not armor or off-hand.
  return container.count(itemId, null);
}

/** Mineflayer's internal window sync: a click the server ignores, answered with the full window. */
type SyncableBot = Bot & { _syncWindow?: (window: Container) => Promise<void> };

/**
 * Waits until the server has run every click sent so far, then reports whether it did in time.
 * Mineflayer waits on the server only for player and crafting windows, so a chest click returns
 * while the server may not have run it yet: the client view is ahead of the chest. The sync is
 * answered after those clicks, so the counts read after it are the chest's. A bot without the sync
 * (an older protocol, which waits per click) has nothing to settle.
 */
async function settle(ctx: ActionContext, container: Container): Promise<boolean> {
  const sync = (ctx.bot as SyncableBot)._syncWindow;
  if (!sync) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), SETTLE_WAIT_MS * ctx.timeScale);
  });
  const synced = sync.call(ctx.bot, container).then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([synced, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The window's stacks summed per item name. */
function contentsOf(window: Opening): Record<string, number> {
  const totals = new Map<string, number>();
  for (const item of window.containerItems()) {
    totals.set(item.name, (totals.get(item.name) ?? 0) + item.count);
  }
  return Object.fromEntries(totals);
}

/** The registry id of an item name, or null when the name is unknown. */
function itemIdOf(bot: Bot, name: string): number | null {
  const items = bot.registry.itemsByName;
  return Object.hasOwn(items, name) ? (items[name]?.id ?? null) : null;
}

/** Whether an open window is a furnace. */
function isFurnace(window: Opening): window is Furnace {
  return window.type === FURNACE_WINDOW;
}

/** One furnace slot as a stack, or null when the slot is empty. */
function stackAt(slot: { name: string; count: number } | null | undefined): ContainerStack | null {
  return slot ? { item: slot.name, count: slot.count } : null;
}

/**
 * A furnace's three slots and its progress as a whole percent. Mineflayer gives progress as a
 * fraction, and holds null until the server sends the first progress value.
 */
function furnaceSlots(furnace: Furnace): FurnaceSlots {
  const fraction = typeof furnace.progress === 'number' ? furnace.progress : 0;
  const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return {
    input: stackAt(furnace.slots[0]),
    fuel: stackAt(furnace.slots[1]),
    output: stackAt(furnace.slots[2]),
    progress: Math.round(clamped * 100),
  };
}

/** The store of the containers this bot has opened: what `recall` reads. */
export function rememberedContainers(bot: Bot): RememberedContainers {
  let store = remembered.get(bot);
  if (!store) {
    store = new RememberedContainers();
    remembered.set(bot, store);
  }
  return store;
}

/**
 * Walks to the container at `at` when it is out of reach, opens it, runs `fn` and closes it.
 * The open is raced against a timer and the signal, because `openContainer` waits for
 * `windowOpen` with no timeout. A window that opens after the race is lost is closed at once.
 * The close runs in `finally`, so an abort or a throw never leaves a window open.
 */
async function withContainer<W extends Opening>(
  ctx: ActionContext,
  at: Position,
  opener: Opener<W>,
  fn: (window: W) => Promise<ActionOutcome>,
): Promise<ActionOutcome> {
  const { bot, signal, timeScale } = ctx;
  // An earlier open that lost its race must not close this action's window.
  lateWindowDrop.get(bot)?.();
  if (signal.aborted) return cancelled();
  const block = blockFor(bot, at, opener.accepts);
  if (!block) return failed('not_found', 'no container at that position');
  const center = new Vec3(at.x + 0.5, at.y + 0.5, at.z + 0.5);
  if (bot.entity.position.distanceTo(center) > REACH) {
    const walk = await moveNear(bot, at, 3, { signal, timeScale });
    if (!walk.ok) {
      return outcomeOfMove(walk);
    }
  }

  let lost = false;
  // The grace timer that drops this open's listener after a lost race. Cleared when the drop runs.
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const onLateWindow = (window: Window): void => {
    if (!lost) return;
    // The late window has arrived, so the listener and its grace timer have done their job.
    dropLateWindow();
    // Only a container is closed: a crafting window may be the one the next action is waiting for.
    if (typeof window.type !== 'string' || !CONTAINER_WINDOW.test(window.type)) return;
    bot.closeWindow(window).catch((error: unknown) => {
      console.warn(`late container window did not close: ${errorText(error)}`);
    });
  };
  bot.on('windowOpen', onLateWindow);
  // Removes this open's late-window listener. A lost open may never settle, so this is also
  // called from a timer and from the next open on the same bot.
  const dropLateWindow = (): void => {
    bot.off('windowOpen', onLateWindow);
    if (graceTimer !== undefined) clearTimeout(graceTimer);
    graceTimer = undefined;
    if (lateWindowDrop.get(bot) === dropLateWindow) lateWindowDrop.delete(bot);
  };
  lateWindowDrop.set(bot, dropLateWindow);
  const attempt: Promise<Opened<W>> = opener.open(bot, block).then(
    (window): Opened<W> => ({ window }),
    (error: unknown): Opened<W> => {
      const raw = errorText(error);
      console.warn(`container did not open: ${raw}`);
      return { outcome: failed('blocked', 'the container did not open', {}, raw) };
    },
  );
  // The late-window listener stays until the open settles: a window that opens after the race
  // is lost arrives through it.
  void attempt.finally(dropLateWindow);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const lostRace = new Promise<Opened<W>>((resolve) => {
    timer = setTimeout(() => {
      lost = true;
      resolve({ outcome: failed('blocked', 'container did not open') });
    }, OPEN_WAIT_MS * timeScale);
    onAbort = () => {
      lost = true;
      resolve({ outcome: cancelled() });
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

  let opened: Opened<W>;
  try {
    opened = await Promise.race([attempt, lostRace]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
  // A lost open may never settle, so its listener is dropped after a grace period too.
  if (lost) {
    graceTimer = setTimeout(dropLateWindow, LATE_WINDOW_WAIT_MS * timeScale);
    // Unref'd: the grace period alone must not keep the process alive.
    graceTimer.unref();
  }
  if ('outcome' in opened) return opened.outcome;

  try {
    return await fn(opened.window);
  } finally {
    // A close error must not replace the outcome that `fn` produced.
    try {
      await opened.window.close();
    } catch (error: unknown) {
      console.warn(`container did not close: ${errorText(error)}`);
    }
  }
}

/** Moves `count` of an item from the container into the bot's inventory. */
async function withdraw(
  ctx: ActionContext,
  container: Container,
  itemId: number,
  count: number,
  item: string,
): Promise<ActionOutcome> {
  const have = container.containerCount(itemId, null);
  if (have < count) {
    return failed('not_found', `container has only ${have} ${item}`, { moved: 0 });
  }
  if (ctx.signal.aborted) return cancelled({ moved: 0 });
  const before = inventoryCount(container, itemId);
  const end = await transferItems(ctx, container, 'withdraw', itemId, count);
  const error = end.error;
  // The window is the truth: the transfer moves what fits, then may stop. The server confirms it first.
  const confirmed = await settle(ctx, container);
  const moved = Math.max(0, inventoryCount(container, itemId) - before);
  if (!confirmed) return failed('internal', 'server did not confirm the withdraw', { moved });
  if (end.aborted) return cancelled({ moved });
  if (error !== null && !INVENTORY_FULL.test(error)) {
    return failed('internal', error, { moved });
  }
  if (moved < count) return failed('not_possible', 'inventory full', { moved });
  return completed({ moved, container: contentsOf(container) });
}

/** Moves `count` of an item from the bot's inventory into the container. */
async function deposit(
  ctx: ActionContext,
  container: Container,
  itemId: number,
  count: number,
  item: string,
): Promise<ActionOutcome> {
  const held = inventoryCount(container, itemId);
  if (held < count) {
    return failed('missing_materials', `inventory has only ${held} ${item}`, { moved: 0 });
  }
  if (ctx.signal.aborted) return cancelled({ moved: 0 });
  const end = await transferItems(ctx, container, 'deposit', itemId, count);
  const error = end.error;
  // The window is the truth: the transfer moves what fits, then may stop. The server confirms it first.
  const confirmed = await settle(ctx, container);
  const moved = Math.max(0, held - inventoryCount(container, itemId));
  if (!confirmed) return failed('internal', 'server did not confirm the deposit', { moved });
  if (end.aborted) return cancelled({ moved });
  if (error !== null && !CONTAINER_FULL.test(error)) {
    return failed('internal', error, { moved });
  }
  if (moved < count) return failed('not_possible', 'container full', { moved });
  return completed({ moved, container: contentsOf(container) });
}

/**
 * `open`: opens the container or furnace and reports what it holds. A furnace also reports its
 * input, fuel, output and progress. A completed open is remembered, so `recall` can read it later;
 * an open that fails, is cancelled or loses its race remembers nothing.
 */
export const openAction: ActionHandler<'open'> = {
  kind: 'open',
  timeoutMs: 30_000,
  async run(ctx, action) {
    return withContainer(ctx, action.at, ANY_OPENER, async (window) => {
      const contents = Object.entries(contentsOf(window)).map(([item, count]) => ({ item, count }));
      const stored: OpenedContents = { contents };
      if (isFurnace(window)) stored.furnace = furnaceSlots(window);
      rememberedContainers(ctx.bot).record(action.at, stored, Date.now());
      return completed({ ...stored });
    });
  },
};

/** `deposit`: moves `count` of `item` from the bot's inventory into the container. */
export const depositAction: ActionHandler<'deposit'> = {
  kind: 'deposit',
  timeoutMs: 30_000,
  async run(ctx, action) {
    const itemId = itemIdOf(ctx.bot, action.item);
    if (itemId === null) return failed('invalid_args', 'unknown item');
    return withContainer(ctx, action.at, CONTAINER_OPENER, (container) =>
      deposit(ctx, container, itemId, action.count, action.item),
    );
  },
};

/** `withdraw`: moves `count` of `item` from the container into the bot's inventory. */
export const withdrawAction: ActionHandler<'withdraw'> = {
  kind: 'withdraw',
  timeoutMs: 30_000,
  async run(ctx, action) {
    const itemId = itemIdOf(ctx.bot, action.item);
    if (itemId === null) return failed('invalid_args', 'unknown item');
    return withContainer(ctx, action.at, CONTAINER_OPENER, (container) =>
      withdraw(ctx, container, itemId, action.count, action.item),
    );
  },
};
