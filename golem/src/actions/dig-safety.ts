import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import type { Block } from './bot-types.ts';

/**
 * Blocks that fall when the block under them is removed. The one list every dig path reads
 * (mining, escape, pillar, unstick, reflexes, pathfinder digging, water rules).
 */
export const FALLING_BLOCKS: ReadonlySet<string> = new Set([
  'sand',
  'red_sand',
  'gravel',
  'anvil',
  'chipped_anvil',
  'damaged_anvil',
  'suspicious_sand',
  'suspicious_gravel',
  'dragon_egg',
]);

const LIQUIDS: ReadonlySet<string> = new Set(['water', 'lava']);
const FACES = [
  [0, 1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;
/** How many falling blocks stacked above a dug cell are read, one after another. */
const FALL_STACK = 6;
/** How far above the top of a falling stack the Body still counts as under it. */
const BODY_ABOVE_STACK = 2;

/** Whether a block of this name falls when the block under it is removed. */
export function isFalling(name: string | undefined): boolean {
  return name !== undefined && (FALLING_BLOCKS.has(name) || name.endsWith('_concrete_powder'));
}

/** A falling block, or a pointed dripstone hanging from a ceiling (its tip points down). */
function fallsWhenUndercut(block: Block | null | undefined): boolean {
  if (!block) return false;
  if (isFalling(block.name)) return true;
  const props = (block as { getProperties?: () => Record<string, unknown> }).getProperties?.();
  return block.name === 'pointed_dripstone' && props?.vertical_direction === 'down';
}

/** Whether a cell is walled on all four sides at its own level (no open cell beside it). */
function walledIn(bot: Bot, cell: Vec3): boolean {
  return [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].every(([dx, dz]) => {
    const next = bot.blockAt(cell.offset(dx ?? 0, 0, dz ?? 0));
    return next !== null && next !== undefined && next.boundingBox !== 'empty';
  });
}

/**
 * Whether the Body's head (the last of `own`) is in or beside the column of `at` and no higher than
 * `top`. A stack falling into the dug cell reaches the Body's head from below too, so the bound is
 * on the head only, with no lower limit.
 */
function bodyUnder(own: readonly Vec3[], at: Vec3, top: number): boolean {
  const head = own[own.length - 1];
  return (
    head !== undefined &&
    head.y <= top &&
    Math.abs(head.x - at.x) <= 1 &&
    Math.abs(head.z - at.z) <= 1
  );
}

export interface DigSafetyInput {
  bot: Bot;
  /** The block about to be dug, read from `at`. */
  block: Block;
  /** The cell the dig is made in. */
  at: Vec3;
  /** The Body's cells: `own[0]` is its feet, the last entry is its head (only the head is read). */
  own: readonly Vec3[];
}

/**
 * Why digging `block` at `at` is unsafe for the Body, in plain words, or null. Every dig calls
 * this first. It refuses when:
 * - water or lava lies on a face of the cell (it would flow in);
 * - a run of falling blocks (a stack, up to `FALL_STACK` cells) stands above the cell and the
 *   Body is in or beside that column, up to the top of the stack;
 * - the block is itself falling and the Body is walled in at its feet and head (no open cell to
 *   step into when it drops).
 * Never throws; an unloaded neighbour counts as not dangerous.
 */
export function digSafetyRefusal({ bot, block, at, own }: DigSafetyInput): string | null {
  for (const [dx, dy, dz] of FACES) {
    const cell = at.offset(dx, dy, dz);
    if (own.some((o) => o.equals(cell))) continue;
    const next = bot.blockAt(cell);
    if (next && LIQUIDS.has(next.name)) {
      return `${block.name} is unsafe to dig: ${next.name} would flow in on you`;
    }
  }
  let run = 0;
  let topName: string | undefined;
  for (let dy = 1; dy <= FALL_STACK; dy++) {
    const above = bot.blockAt(at.offset(0, dy, 0));
    if (!fallsWhenUndercut(above)) break;
    run = dy;
    topName ??= above?.name;
  }
  if (run > 0 && bodyUnder(own, at, at.y + run + BODY_ABOVE_STACK)) {
    return `${block.name} is unsafe to dig: ${topName} above it would fall on you`;
  }
  if (
    isFalling(block.name) &&
    own.length >= 2 &&
    walledIn(bot, own[0] as Vec3) &&
    walledIn(bot, own[1] as Vec3)
  ) {
    return `${block.name} falls when dug, and you have no open cell beside you`;
  }
  return null;
}
