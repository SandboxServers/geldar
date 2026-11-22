import type { Vec3 } from 'vec3';

/** Tall plants: a placement fills the cell above the one it names, as the server does for a door. */
export const TALL_PLANTS: ReadonlySet<string> = new Set([
  'sunflower',
  'lilac',
  'rose_bush',
  'peony',
  'large_fern',
  'tall_grass',
  'pitcher_plant',
]);

/**
 * How many cells a block item fills: `single`, `up` (a door or tall plant, whose second half is the
 * cell above) or `bed` (whose second half lies beside it, see `freeBeside`).
 */
export type Footprint = 'single' | 'bed' | 'up';

/** The footprint of a block item by its name. */
export function footprintOf(block: string): Footprint {
  if (block.endsWith('_bed')) return 'bed';
  if (block.endsWith('_door') || TALL_PLANTS.has(block)) return 'up';
  return 'single';
}

/** The cell a two-cell item's second half goes in when placed at `target`; null for other items. */
export function upperCell(block: string, target: Vec3): Vec3 | null {
  return footprintOf(block) === 'up' ? target.offset(0, 1, 0) : null;
}
