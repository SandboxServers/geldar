import { Vec3 } from 'vec3';
import type { ActionContext } from './registry.ts';

type Bot = ActionContext['bot'];

/** Slack on the top of a block, so a position a rounding error below it still counts as standing on it. */
const TOP_EPSILON = 1e-3;

/**
 * The cell the bot's feet are in. A partial-height block the bot stands on (a dirt path at 15/16, soul
 * sand at 7/8, a slab, a snow layer) puts the feet in the cell above it: the cell under a position is
 * floor(position), but a bot standing on that block sits at its top, which is in the cell above.
 */
export function feetCell(bot: Bot): Vec3 {
  const { position } = bot.entity;
  const cell = new Vec3(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z));
  const shapes: readonly (readonly number[])[] = bot.blockAt(cell)?.shapes ?? [];
  let top = Number.NEGATIVE_INFINITY;
  for (const shape of shapes) top = Math.max(top, shape[4] ?? 0);
  return top > Number.NEGATIVE_INFINITY && top <= position.y - cell.y + TOP_EPSILON
    ? cell.offset(0, 1, 0)
    : cell;
}
