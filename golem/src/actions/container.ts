import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { type ActionOutcome, cancelled, completed, failed } from './outcome.ts';
import { moveNear } from './pathing.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/** The containers Phase 0 opens. Copper chests and their variants are out of scope. */
const CONTAINER_BLOCKS = new Set(['chest', 'trapped_chest', 'barrel']);
/** Farther than this from the block center, the bot walks to the container first. */
const REACH = 4.5;
/** Wall-clock wait for the window to open, scaled by `timeScale`. `openContainer` has no timeout. */
const OPEN_WAIT_MS = 5_000;
/** The library's message when the bot's inventory cannot take the withdrawn stacks. */
const INVENTORY_FULL = /inventory is full/i;
/** A full container: the library's own wording is not known, so the word `full` is the match. */
const CONTAINER_FULL = /full/i;

type Container = Awaited<ReturnType<Bot['openContainer']>>;
type Window = NonNullable<Bot['currentWindow']>;
type Block = NonNullable<ReturnType<Bot['blockAt']>>;
type Position = { x: number; y: number; z: number };

/** What the open race produced: the open container, or the outcome that ended it. */
type Opened = { container: Container } | { outcome: ActionOutcome };

/** The block at a position when it is a container, else null. */
function containerAt(bot: Bot, at: Position): Block | null {
  const block = bot.blockAt(new Vec3(at.x, at.y, at.z));
  return block && CONTAINER_BLOCKS.has(block.name) ? block : null;
}

/** The text of a thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

/** The container's stacks summed per item name. */
function contentsOf(container: Container): Record<string, number> {
  const totals = new Map<string, number>();
  for (const item of container.containerItems()) {
    totals.set(item.name, (totals.get(item.name) ?? 0) + item.count);
  }
  return Object.fromEntries(totals);
}

/** The registry id of an item name, or null when the name is unknown. */
function itemIdOf(bot: Bot, name: string): number | null {
  const items = bot.registry.itemsByName;
  return Object.hasOwn(items, name) ? (items[name]?.id ?? null) : null;
}

/**
 * Walks to the container at `at` when it is out of reach, opens it, runs `fn` and closes it.
 * The open is raced against a timer and the signal, because `openContainer` waits for
 * `windowOpen` with no timeout. A window that opens after the race is lost is closed at once.
 * The close runs in `finally`, so an abort or a throw never leaves a window open.
 */
async function withContainer(
  ctx: ActionContext,
  at: Position,
  fn: (container: Container) => Promise<ActionOutcome>,
): Promise<ActionOutcome> {
  const { bot, signal, timeScale } = ctx;
  if (signal.aborted) return cancelled();
  const block = containerAt(bot, at);
  if (!block) return failed('not_found', 'no container at that position');
  const center = new Vec3(at.x + 0.5, at.y + 0.5, at.z + 0.5);
  if (bot.entity.position.distanceTo(center) > REACH) {
    const walk = await moveNear(bot, at, 3, { signal, timeScale });
    if (!walk.ok) {
      return walk.reason === 'cancelled' ? cancelled() : failed(walk.reason, walk.message);
    }
  }

  let lost = false;
  const onLateWindow = (window: Window): void => {
    if (lost) void bot.closeWindow(window).catch(() => undefined);
  };
  bot.on('windowOpen', onLateWindow);
  const attempt: Promise<Opened> = bot.openContainer(block).then(
    (container): Opened => ({ container }),
    (error: unknown): Opened => ({
      outcome: failed('blocked', `container did not open: ${errorMessage(error)}`),
    }),
  );
  // The late-window listener stays until the open settles: a window that opens after the race
  // is lost arrives through it.
  void attempt.finally(() => bot.off('windowOpen', onLateWindow));

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const lostRace = new Promise<Opened>((resolve) => {
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

  let opened: Opened;
  try {
    opened = await Promise.race([attempt, lostRace]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
  if ('outcome' in opened) return opened.outcome;

  try {
    return await fn(opened.container);
  } finally {
    // A close error must not replace the outcome that `fn` produced.
    try {
      await opened.container.close();
    } catch {
      // The window is gone or the connection dropped; nothing more to do here.
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
  let error: string | null = null;
  try {
    await container.withdraw(itemId, null, count);
  } catch (caught) {
    error = errorMessage(caught);
  }
  // The window is the truth: the library moves what fits, then may throw.
  const moved = inventoryCount(container, itemId) - before;
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
  let error: string | null = null;
  try {
    await container.deposit(itemId, null, count);
  } catch (caught) {
    error = errorMessage(caught);
  }
  // The window is the truth: the library moves what fits, then may throw.
  const moved = held - inventoryCount(container, itemId);
  if (error !== null && !CONTAINER_FULL.test(error)) {
    return failed('internal', error, { moved });
  }
  if (moved < count) return failed('not_possible', 'container full', { moved });
  return completed({ moved, container: contentsOf(container) });
}

/** `open`: opens the container and reports what it holds. */
export const openAction: ActionHandler<'open'> = {
  kind: 'open',
  timeoutMs: 30_000,
  async run(ctx, action) {
    return withContainer(ctx, action.at, async (container) => {
      const contents = contentsOf(container);
      const list = Object.entries(contents).map(([item, count]) => ({ item, count }));
      return completed({ contents: list });
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
    return withContainer(ctx, action.at, (container) =>
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
    return withContainer(ctx, action.at, (container) =>
      withdraw(ctx, container, itemId, action.count, action.item),
    );
  },
};
