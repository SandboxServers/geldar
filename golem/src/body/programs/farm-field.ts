import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Block } from '../../actions/bot-types.ts';
import { isOwnPlacement } from '../../actions/own-placements.ts';
import { ownerRecordAt } from '../../actions/protected-blocks.ts';
import { canSeeBlock } from '../../perception/notable-blocks.ts';
import { CROP_MAX_AGE, FOOD_RANGE } from '../../perception/surroundings/food-known.ts';

/** How far above and below the Body's feet the field is read. */
const VERTICAL_REACH = 3;

export type CropState = 'ripe' | 'unripe' | 'empty';
export type CellOwner = 'own' | 'other' | 'unknown';

/** A crop (or empty farmland) cell the Body can see, with who owns it. */
export interface FieldCell {
  x: number;
  y: number;
  z: number;
  state: CropState;
  owner: CellOwner;
}

/** The age a crop block reports, or -1 when the age is not readable (so the crop reads unripe). */
export function ageOf(block: Block): number {
  try {
    const age = (block.getProperties() as { age?: unknown }).age;
    return typeof age === 'number' ? age : -1;
  } catch {
    return -1;
  }
}

/**
 * Who owns the cell: the Body's own placement, a world-generated block (no owner), another
 * player's block, or unknown (no record, or the record is unreadable). Decision 0164: unknown
 * ownership is protected, so the program never treats it as its own.
 */
export function ownerOf(bot: Bot, cell: { x: number; y: number; z: number }): CellOwner {
  if (isOwnPlacement(bot, cell)) return 'own';
  const answer = ownerRecordAt(new Vec3(cell.x, cell.y, cell.z));
  if (answer === null || !answer.known) return 'unknown';
  return answer.owner === null ? 'own' : 'other';
}

/**
 * The state of the cell at `pos`, when the Body can see it: the crop block is loaded, in line of
 * sight, sits on farmland, and is a crop (ripe at its maximum age), or it is empty farmland and
 * `replant` is set. Anything else (unloaded, hidden, not on farmland, another block) is null.
 */
export function cropStateAt(
  bot: Bot,
  pos: Vec3,
  replant: boolean,
): { name: string; state: CropState } | null {
  const block = bot.blockAt(pos);
  if (!block || !canSeeBlock(bot, block)) return null;
  const below = bot.blockAt(pos.offset(0, -1, 0));
  if (!below || below.name !== 'farmland') return null;
  if (block.name === 'air') return replant ? { name: 'air', state: 'empty' } : null;
  if (!Object.hasOwn(CROP_MAX_AGE, block.name)) return null;
  const max = CROP_MAX_AGE[block.name] as number;
  return { name: block.name, state: ageOf(block) >= max ? 'ripe' : 'unripe' };
}

/**
 * The crop cells within reach of the Body, nearest first (ties by x, y, z), at most `maxCells`.
 * Reach is `Math.min(FOOD_RANGE, radius)` in blocks, straight-line from the Body's feet.
 */
export function readField(bot: Bot, radius: number, maxCells: number, replant = true): FieldCell[] {
  const reach = Math.min(FOOD_RANGE, radius);
  const origin = bot.entity.position.floored();
  const found: Array<{ dist: number; x: number; y: number; z: number; state: CropState }> = [];
  for (let dx = -reach; dx <= reach; dx += 1) {
    for (let dz = -reach; dz <= reach; dz += 1) {
      for (let dy = -VERTICAL_REACH; dy <= VERTICAL_REACH; dy += 1) {
        const dist = Math.hypot(dx, dy, dz);
        if (dist > reach) continue;
        const pos = origin.offset(dx, dy, dz);
        const seen = cropStateAt(bot, pos, replant);
        if (seen) found.push({ dist, x: pos.x, y: pos.y, z: pos.z, state: seen.state });
      }
    }
  }
  found.sort((a, b) => a.dist - b.dist || a.x - b.x || a.y - b.y || a.z - b.z);
  return found.slice(0, maxCells).map(({ x, y, z, state }) => ({
    x,
    y,
    z,
    state,
    owner: ownerOf(bot, { x, y, z }),
  }));
}
