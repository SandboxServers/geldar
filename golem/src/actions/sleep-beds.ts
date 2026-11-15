import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import type { Block } from './bot-types.ts';
import { bedKey, footPosition, headPosition } from './sleep-census.ts';
import { NO_PATH_TEXT } from './soft-dig.ts';

/** The shape of a full solid cube, as a block's `shapes` lists it: min x, y, z, then max x, y, z. */
const FULL_CUBE = [0, 0, 0, 1, 1, 1];

/** The failure text of a bed the Body's check or the server finds obstructed (the server's fact, sleep-refusal.ts). */
export const OBSTRUCTED_TEXT = 'the bed is obstructed';

/** How long a bed refused as obstructed or without a path stays ranked last for the same Body (decision 0341). */
export const REFUSAL_MEMORY_MS = 10 * 60_000;

/** How far, in blocks on each axis, a Body counts as beside a bed (decision 0341). */
const BESIDE_RANGE = 1;

/** The time each bed of one Body was refused, by bed key. A Body's memory is dropped with the Body. */
const refusals = new WeakMap<Bot, Map<string, number>>();

/** Records that the Body refused this bed (as obstructed, or with no path), so the next sleep ranks it last. */
export function rememberRefusal(bot: Bot, bed: Block, now = Date.now()): void {
  const byBed = refusals.get(bot) ?? new Map<string, number>();
  byBed.set(bedKey(bed), now);
  refusals.set(bot, byBed);
}

/** True when this Body refused the bed within REFUSAL_MEMORY_MS. An older record is dropped. */
export function wasRefused(bot: Bot, bed: Block, now = Date.now()): boolean {
  const key = bedKey(bed);
  const at = refusals.get(bot)?.get(key);
  if (at === undefined) return false;
  if (now - at < REFUSAL_MEMORY_MS) return true;
  refusals.get(bot)?.delete(key);
  return false;
}

/** True for the failure texts the bed memory keeps: an obstructed bed and a bed with no path. */
export function isRefusalToRemember(message: string): boolean {
  return message === OBSTRUCTED_TEXT || message === NO_PATH_TEXT;
}

/** True when the Body stands within BESIDE_RANGE of the bed on every axis, so no walk is needed. */
export function isBeside(bot: Bot, bed: Block): boolean {
  const at = bot.entity.position.floored();
  return (
    Math.abs(at.x - bed.position.x) <= BESIDE_RANGE &&
    Math.abs(at.y - bed.position.y) <= BESIDE_RANGE &&
    Math.abs(at.z - bed.position.z) <= BESIDE_RANGE
  );
}

/**
 * True when the Body's own check finds the bed obstructed before it walks (decision 0341): both the cell above the
 * head and the cell above the foot are solid cubes. One blocked cell is not enough to skip, and neither is a slab,
 * stair, lantern, glass, leaves or any cell whose shape cannot be read, so the real attempt decides those. Mineflayer's
 * bed check has no obstruction test, and entities are not counted: a monster in the bed box is left to the server's
 * monsters refusal. Either bed half gives the same answer.
 */
export function isObstructed(bot: Bot, bed: Block): boolean {
  const head = headPosition(bed);
  const foot = footPosition(bed);
  if (head === undefined || foot === undefined) return false;
  return suffocates(bot, head.offset(0, 1, 0)) && suffocates(bot, foot.offset(0, 1, 0));
}

/**
 * True only for a loaded cell of a full solid cube that does not let light through: the conservative reading of the
 * server's suffocating rule. Any doubt (an unloaded cell, an unreadable shape, a transparent block) reads as not solid.
 */
function suffocates(bot: Bot, position: Vec3): boolean {
  const block = bot.blockAt(position);
  if (block?.boundingBox !== 'block' || block.transparent !== false) return false;
  const shapes: readonly (readonly number[])[] | undefined = block.shapes;
  return (
    shapes?.length === 1 &&
    shapes[0]?.length === 6 &&
    shapes[0].every((value, i) => value === FULL_CUBE[i])
  );
}
