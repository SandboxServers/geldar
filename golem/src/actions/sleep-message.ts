import type { Bot } from 'mineflayer';

/** The most characters a failure message carries: the executor sends the message to the Mind, capped at 160. */
const MESSAGE_MAX = 160;

/**
 * A tried-beds failure message: `base`, then `; last: ` and the last bed's text, then `tail` (the census and the
 * position). When the whole would pass MESSAGE_MAX, the last bed's text is cut and ends in `...`. The tail is
 * kept whole. A tail so long that no text fits leaves `...` alone (decision 0226).
 */
export function triedMessage(base: string, last: string, tail: string): string {
  const head = `${base}; last: `;
  const room = MESSAGE_MAX - head.length - tail.length;
  if (last.length <= room) return `${head}${last}${tail}`;
  return `${head}${last.slice(0, Math.max(room - 3, 0))}...${tail}`;
}

/** The bot's position in whole blocks, as `x, y, z`. */
export function roundedPosition(bot: Bot): string {
  const { x, y, z } = bot.entity.position;
  return `${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}`;
}
