import type { Bot } from 'mineflayer';

/**
 * How many of an item the bot holds in `bot.inventory` (main and hotbar slots 9 to 44 only; armor
 * and off-hand are outside that range). That view
 * is current when no window is open, and after one closes. While a window is open, clicks apply to
 * the window and `bot.inventory` catches up only on close: a count taken during a transfer reads
 * the open window instead.
 */
export function heldCount(bot: Bot, itemId: number, metadata: number | null = null): number {
  return bot.inventory.count(itemId, metadata);
}
