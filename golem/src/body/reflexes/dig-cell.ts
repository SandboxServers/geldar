import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import type { ReflexContext } from '../reflex.ts';

/**
 * The blocks a reflex may dig out of a wall: plain terrain and the seal blocks the Body places.
 * No chests, ore, obsidian, doors, beds or anything that falls.
 */
export const DIGGABLE_BLOCKS: ReadonlySet<string> = new Set([
  'dirt',
  'grass_block',
  'coarse_dirt',
  'podzol',
  'cobblestone',
  'cobbled_deepslate',
  'netherrack',
  'stone',
  'andesite',
  'diorite',
  'granite',
  'deepslate',
  'tuff',
]);

/** Longest eye-to-cell-center distance a dig is tried from, in blocks (survival reach is 4.5). */
const REACH = 4.5;

/** True while the cell holds a block (the bot reads its own client world). */
export function holds(bot: Bot, cell: Vec3): boolean {
  return (bot.blockAt(cell)?.boundingBox ?? 'empty') !== 'empty';
}

/** Equips the fastest tool for the block when the pathfinder plugin is loaded; never throws. */
async function equipBest(bot: Bot, block: NonNullable<ReturnType<Bot['blockAt']>>): Promise<void> {
  const loaded: unknown = (bot as { pathfinder?: unknown }).pathfinder;
  if (!loaded) return;
  try {
    const tool = bot.pathfinder.bestHarvestTool(block);
    if (tool) await bot.equip(tool, 'hand');
  } catch {
    // Digging by hand still works; a failed equip is not a failed dig.
  }
}

/**
 * Digs exactly the block in `cell` with `bot.dig`, never "the nearest block of that name". Returns
 * true when the cell is open afterwards (also when it already was). It refuses a block outside
 * `allow`, an undiggable block, and a cell out of reach, and returns false without digging.
 */
export async function digCell(
  ctx: ReflexContext,
  cell: Vec3,
  allow: ReadonlySet<string> = DIGGABLE_BLOCKS,
): Promise<boolean> {
  const { bot } = ctx;
  const block = bot.blockAt(cell);
  if (!block || block.boundingBox === 'empty') return true;
  if (ctx.signal.aborted || !allow.has(block.name) || block.diggable === false) return false;
  const eye = bot.entity.position.offset(0, bot.entity.height ?? 1.62, 0);
  if (eye.distanceTo(cell.offset(0.5, 0.5, 0.5)) > REACH) return false;
  await equipBest(bot, block);
  const stop = (): void => bot.stopDigging();
  ctx.signal.addEventListener('abort', stop, { once: true });
  try {
    await bot.dig(block, true);
  } catch {
    // A dig rejected or interrupted: the cell tells whether it opened.
  } finally {
    ctx.signal.removeEventListener('abort', stop);
  }
  return !holds(bot, cell);
}
