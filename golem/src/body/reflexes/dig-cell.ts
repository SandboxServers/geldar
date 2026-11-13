import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import { protectedReason } from '../../actions/protected-blocks.ts';
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

/** What `digCellWhy` reports: whether the cell is open afterwards, and why not when it is not. */
export interface DigResult {
  ok: boolean;
  /** A short cause when `ok` is false; goes into the reflex outcome's detail. */
  cause?: string;
}

/**
 * Digs exactly the block in `cell` with `bot.dig`, never "the nearest block of that name". Returns
 * `ok` when the cell is open afterwards (also when it already was), else the cause. It refuses a
 * cell that is not loaded (it could be anything), a block outside `allow`, an undiggable block, and
 * a cell out of reach, and returns without digging.
 */
export async function digCellWhy(
  ctx: ReflexContext,
  cell: Vec3,
  allow: ReadonlySet<string> = DIGGABLE_BLOCKS,
): Promise<DigResult> {
  const { bot } = ctx;
  const block = bot.blockAt(cell);
  if (!block) return { ok: false, cause: 'cell not loaded' };
  if (block.boundingBox === 'empty') return { ok: true };
  if (ctx.signal.aborted) return { ok: false, cause: 'aborted' };
  if (!allow.has(block.name) || block.diggable === false) {
    return { ok: false, cause: `${block.name} is not diggable` };
  }
  // The owner's rule covers the Body's automatic digging too: someone else's work is not dug (review N8).
  const protectedBy = protectedReason(bot, block, cell);
  if (protectedBy !== null) return { ok: false, cause: protectedBy };
  const eye = bot.entity.position.offset(0, bot.entity.height ?? 1.62, 0);
  if (eye.distanceTo(cell.offset(0.5, 0.5, 0.5)) > REACH)
    return { ok: false, cause: 'out of reach' };
  await equipBest(bot, block);
  const stop = (): void => bot.stopDigging();
  ctx.signal.addEventListener('abort', stop, { once: true });
  let thrown: string | undefined;
  try {
    await bot.dig(block, true);
  } catch (error) {
    // A dig rejected or interrupted: the cell tells whether it opened, the cause says why not.
    thrown = error instanceof Error ? error.message : String(error);
  } finally {
    ctx.signal.removeEventListener('abort', stop);
  }
  if (!holds(bot, cell)) return { ok: true };
  return { ok: false, cause: thrown === undefined ? 'the block stayed' : `dig failed: ${thrown}` };
}

/** `digCellWhy` without the cause: true when the cell is open afterwards. */
export async function digCell(
  ctx: ReflexContext,
  cell: Vec3,
  allow: ReadonlySet<string> = DIGGABLE_BLOCKS,
): Promise<boolean> {
  return (await digCellWhy(ctx, cell, allow)).ok;
}
