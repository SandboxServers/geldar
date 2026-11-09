import type { Bot } from 'mineflayer';
import type { Block } from './bot-types.ts';
import { type ActionOutcome, cancelled, errorText, failed } from './outcome.ts';
import type { ActionContext } from './registry.ts';

/** The window of the bot's open container. */
type Window = NonNullable<Bot['currentWindow']>;

/** Wall-clock wait for the table window to open, scaled by 	imeScale. */
const TABLE_OPEN_WAIT_MS = 5_000;
/** The late-window cleanup of the last open per bot, so the next craft can remove a stale one. */
const lateTableWindow = new WeakMap<Bot, () => void>();

/** The open window, or the outcome of the open that failed. */
type Opened = { window: Window } | { outcome: ActionOutcome };

/**
 * Activates the table and waits for its window, bounded and abortable. Mineflayer's own open waits
 * with no timeout. A window that opens after the wait gave up is closed at once.
 */
export async function openTable(ctx: ActionContext, table: Block): Promise<Opened> {
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
  // Unref'd: the late-window grace alone must not keep the process alive.
  timer.unref();
  bot.on('windowOpen', late);
  lateTableWindow.set(bot, () => {
    clearTimeout(timer);
    bot.off('windowOpen', late);
  });
}

/** Removes the bot's late-window listener and its timer, if one is armed. */
export function dropLateTableWindow(bot: Bot): void {
  lateTableWindow.get(bot)?.();
  lateTableWindow.delete(bot);
}
