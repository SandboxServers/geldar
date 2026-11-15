import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import type { Block } from './bot-types.ts';
import { isOwnPlacement } from './own-placements.ts';
import {
  digHazard,
  lastResortRefused,
  protectedReason,
  refusedByName,
} from './protected-blocks.ts';
import { isSoft } from './unstick-plan.ts';

/** A block a bare hand can break: not bedrock, barrier and the like (hardness below zero or unknown). */
export function handBreakable(block: Block): boolean {
  const { hardness, diggable } = block as { hardness?: number | null; diggable?: boolean };
  return diggable !== false && typeof hardness === 'number' && hardness >= 0;
}

/** True when a bare hand drops the block itself: no harvest tool is listed for it (dirt, logs, planks). */
export function dropsByHand(block: Block): boolean {
  const tools = (block as { harvestTools?: Record<number, boolean> }).harvestTools;
  return !tools || Object.keys(tools).length === 0;
}

/**
 * A cell a dig may take (owner ruling 2026-11-14, decision 0183): soft ground always; any other block a
 * hand can break, unless a refused name, a liquid or a falling block touches it, or it is someone else's
 * work (`protectedReason`). In the last-resort pass (`relaxed`) `lastResortRefused` decides instead.
 */
export function digsCell(
  bot: Bot,
  block: Block | null,
  cell: Vec3,
  relaxed: boolean,
  refuseOwn = false,
): boolean {
  if (refuseOwn && isOwnPlacement(bot, cell)) return false;
  if (isSoft(block)) return true;
  if (block === null || block.boundingBox === 'empty' || !handBreakable(block)) return false;
  if (refusedByName(block.name) || digHazard(bot, cell)) return false;
  return relaxed
    ? !lastResortRefused(bot, block, cell)
    : protectedReason(bot, block, cell) === null;
}

/** The directions whose feet and head cells a bare hand drops by hand come first; the rest keep their order. */
export function handFirst(bot: Bot, feet: Vec3, dirs: readonly Vec3[]): Vec3[] {
  const needsTool = (dir: Vec3): number => {
    const cells = [feet.plus(dir), feet.plus(dir).offset(0, 1, 0)];
    return cells.some((cell) => {
      const block = bot.blockAt(cell);
      return block !== null && block.boundingBox !== 'empty' && !dropsByHand(block);
    })
      ? 1
      : 0;
  };
  return [...dirs].sort((a, b) => needsTool(a) - needsTool(b));
}
