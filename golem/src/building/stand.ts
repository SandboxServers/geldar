// Stand position for a batch of cells (BLD-09).

/** The block facts the solver reads. A mineflayer `Block` fits; `null` means the chunk is not loaded. */
export interface StandBlock {
  name: string;
  boundingBox: string;
}

export interface Cell {
  x: number;
  y: number;
  z: number;
}

/** Reads the block at a position; null when the chunk is not loaded. */
export type StandWorld = (x: number, y: number, z: number) => StandBlock | null;

/** A stand cell, or `none` when no cell qualifies (the caller defers the batch). */
export type StandResult = Cell | 'none';

export const STAND_REACH = 4.5;
const EYE_HEIGHT = 1.62;
const SIGHT_STEP = 0.05;
/** Search box around the first target: 4 across, and 5 down to 3 up (the reach bounds). */
const SEARCH_XZ = 4;
const SEARCH_DOWN = 5;
const SEARCH_UP = 3;

const FALLING = new Set(['sand', 'red_sand', 'gravel']);

function isFalling(name: string): boolean {
  return FALLING.has(name) || name.endsWith('concrete_powder');
}

function isLiquid(name: string): boolean {
  return name.endsWith('water') || name.endsWith('lava') || name === 'bubble_column';
}

function keyOf(c: Cell): string {
  return `${c.x},${c.y},${c.z}`;
}

function reaches(stand: Cell, target: Cell): boolean {
  const dx = target.x - stand.x;
  const dy = target.y + 0.5 - (stand.y + EYE_HEIGHT);
  const dz = target.z - stand.z;
  return dx * dx + dy * dy + dz * dz <= STAND_REACH * STAND_REACH;
}

/** A ray from the stand's eye to the target centre must pass no solid block before the target. */
function sightClear(world: StandWorld, stand: Cell, target: Cell): boolean {
  const fx = stand.x + 0.5;
  const fy = stand.y + EYE_HEIGHT;
  const fz = stand.z + 0.5;
  const tx = target.x + 0.5;
  const ty = target.y + 0.5;
  const tz = target.z + 0.5;
  const steps = Math.ceil(Math.hypot(tx - fx, ty - fy, tz - fz) / SIGHT_STEP);
  for (let i = 1; i < steps; i++) {
    const f = i / steps;
    const bx = Math.floor(fx + (tx - fx) * f);
    const by = Math.floor(fy + (ty - fy) * f);
    const bz = Math.floor(fz + (tz - fz) * f);
    if (bx === target.x && by === target.y && bz === target.z) return true;
    const block = world(bx, by, bz);
    if (!block || block.boundingBox === 'block') return false;
  }
  return true;
}

function qualifies(
  c: Cell,
  batch: readonly Cell[],
  batchKeys: ReadonlySet<string>,
  world: StandWorld,
): boolean {
  const floor = world(c.x, c.y - 1, c.z);
  const feet = world(c.x, c.y, c.z);
  const head = world(c.x, c.y + 1, c.z);
  const overhead = world(c.x, c.y + 2, c.z);
  if (!floor || !feet || !head || !overhead) return false;
  if (floor.boundingBox !== 'block' || isLiquid(floor.name)) return false;
  if (feet.boundingBox !== 'empty' || head.boundingBox !== 'empty') return false;
  if (isLiquid(feet.name) || isLiquid(head.name)) return false;
  if (isFalling(overhead.name)) return false;
  const below = { x: c.x, y: c.y - 1, z: c.z };
  if (batchKeys.has(keyOf(c)) || batchKeys.has(keyOf(below))) return false;
  if (batchKeys.has(keyOf({ x: c.x, y: c.y + 1, z: c.z }))) return false;
  return batch.every((t) => reaches(c, t) && sightClear(world, c, t));
}

function isBefore(a: Cell, b: Cell | null): boolean {
  if (b === null) return true;
  if (a.y !== b.y) return a.y < b.y;
  if (a.x !== b.x) return a.x < b.x;
  return a.z < b.z;
}

/**
 * The cell to stand on while the batch is worked: solid floor that is not liquid, two empty cells
 * for the body that are not liquid, no falling sand or gravel directly overhead, no batch cell among
 * the floor or body cells, and within reach and line of sight of every target. Fewest moves from
 * `from` (default: the first target) wins; ties go to the lower y, then x, then z.
 */
export function standFor(batch: readonly Cell[], world: StandWorld, from?: Cell): StandResult {
  const first = batch[0];
  if (!first) return 'none';
  const batchKeys = new Set(batch.map(keyOf));
  const origin = from ?? first;
  let best: Cell | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let dy = -SEARCH_DOWN; dy <= SEARCH_UP; dy++) {
    for (let dx = -SEARCH_XZ; dx <= SEARCH_XZ; dx++) {
      for (let dz = -SEARCH_XZ; dz <= SEARCH_XZ; dz++) {
        const c = { x: first.x + dx, y: first.y + dy, z: first.z + dz };
        const cost = Math.abs(c.x - origin.x) + Math.abs(c.y - origin.y) + Math.abs(c.z - origin.z);
        if (cost > bestCost) continue;
        if (!qualifies(c, batch, batchKeys, world)) continue;
        if (cost < bestCost || isBefore(c, best)) {
          best = c;
          bestCost = cost;
        }
      }
    }
  }
  return best ?? 'none';
}
