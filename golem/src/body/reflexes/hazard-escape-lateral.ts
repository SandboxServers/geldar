import {
  type BlockReader,
  HAZARD_CELLS,
  HAZARD_FLOORS,
  isOpenCell,
  type ScanBlock,
} from './hazard-escape-cells.ts';

/** How far the swim-up looks for open water to steer to when a ceiling is over the head. */
const BREATH_RADIUS = 4;

/** How far the sideways search looks for a breathable cell, in steps through water and air. */
const LATERAL_RADIUS = 8;
/** A sideways target is replaced in a later window only for an exit this many steps nearer. */
const LATERAL_HYSTERESIS = 2;
/** Cells a sideways swim will not enter: they burn. */
const LATERAL_AVOID = new Set(['lava', 'fire', 'soul_fire']);

/** A cell the Body can swim or stand in: no solid block (water and air are both `empty`). */
function passable(block: ScanBlock | null): boolean {
  return block !== null && block.boundingBox === 'empty';
}

/** A cell a reachability search reached: its column and the steps from the Body's column to it. */
interface ReachedCell {
  x: number;
  z: number;
  steps: number;
}

/**
 * Breadth-first search from the Body's column, out to `radius` steps through the cells `enter` admits.
 * Returns the cells reached in search order (the Body's own column first) and the cell each was reached
 * from. A solid block in the way is a wall, so a route goes round it. Shared by the undercut column
 * search and the sideways exit search, so both count only cells the Body can swim to.
 */
function reachCells(
  from: { x: number; y: number; z: number },
  radius: number,
  enter: (x: number, z: number) => boolean,
): { cells: ReachedCell[]; parent: Map<string, { x: number; z: number } | null> } {
  const cx = Math.floor(from.x);
  const cz = Math.floor(from.z);
  const key = (x: number, z: number): string => `${x},${z}`;
  const parent = new Map<string, { x: number; z: number } | null>([[key(cx, cz), null]]);
  const seen = new Set<string>([key(cx, cz)]);
  const cells: ReachedCell[] = [{ x: cx, z: cz, steps: 0 }];
  for (let at = 0; at < cells.length; at++) {
    const cell = cells[at] as ReachedCell;
    if (cell.steps === radius) continue;
    for (const side of SIDES) {
      const x = cell.x + side.dx;
      const z = cell.z + side.dz;
      if (seen.has(key(x, z)) || !enter(x, z)) continue;
      seen.add(key(x, z));
      parent.set(key(x, z), { x: cell.x, z: cell.z });
      cells.push({ x, z, steps: cell.steps + 1 });
    }
  }
  return { cells, parent };
}

/**
 * The nearest column within 4 blocks whose cells at the Body's head level and the one above are
 * passable, so a swimmer that steers there rises into air. The Body must be able to swim to it: a
 * solid block in the way is a wall, and the route may go round it (up to 8 steps). Null when none is in reach.
 */
export function findBreathingColumn(
  read: BlockReader,
  from: { x: number; y: number; z: number },
): { x: number; z: number } | null {
  const feet = Math.floor(from.y);
  const cx = Math.floor(from.x);
  const cz = Math.floor(from.z);
  const { cells } = reachCells(
    from,
    LATERAL_RADIUS,
    (x, z) => passable(read(x, feet, z)) && passable(read(x, feet + 1, z)),
  );
  let best: { x: number; z: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  // A tie goes to the smaller x, then z, as a scan of the square in that order gives.
  const ordered = [...cells].sort((a, b) => a.x - b.x || a.z - b.z);
  for (const cell of ordered) {
    const distance = (cell.x - cx) ** 2 + (cell.z - cz) ** 2;
    if (distance > BREATH_RADIUS * BREATH_RADIUS || distance >= bestDistance) continue;
    if (!passable(read(cell.x, feet + 1, cell.z)) || !passable(read(cell.x, feet + 2, cell.z))) {
      continue;
    }
    best = { x: cell.x, z: cell.z };
    bestDistance = distance;
  }
  return best;
}

/** A breathable cell a pinned swimmer can swim to: where it is, how far, which way it starts, and the route. */
export interface LateralExit {
  x: number;
  z: number;
  /** The side the first step goes: east, south, west or north. */
  direction: string;
  /** Steps from the Body to the exit, through water and air. */
  distance: number;
  /** The cells to swim through in order, the exit last; the first is the next step. */
  path: Array<{ x: number; z: number }>;
}

/** The four horizontal sides, in the order that breaks a tie: east, south, west, north. */
const SIDES = [
  { direction: 'east', dx: 1, dz: 0 },
  { direction: 'south', dx: 0, dz: 1 },
  { direction: 'west', dx: -1, dz: 0 },
  { direction: 'north', dx: 0, dz: -1 },
];

/** A cell a swimmer can pass: no solid block, and not lava or fire (water and air are both fine). */
function swimmable(block: ScanBlock | null): boolean {
  return block !== null && block.boundingBox === 'empty' && !LATERAL_AVOID.has(block.name);
}

/** A cell a Body can breathe in: its head level can be swum through and the cell above is open air. */
function breathableAt(read: BlockReader, x: number, feet: number, z: number): boolean {
  return swimmable(read(x, feet + 1, z)) && isOpenCell(read(x, feet + 2, z));
}

/**
 * True when a swimmer whose feet are in this cell is held safely: water at the feet is fine unless lava
 * or magma lies within two blocks below it; air at the feet needs a solid floor under it that is not a
 * hazard (no void, no lava, no cactus). Unloaded floors are not solid, so they do not count.
 */
function supported(read: BlockReader, x: number, feet: number, z: number): boolean {
  if (read(x, feet, z)?.name === 'water') {
    return ![read(x, feet - 1, z), read(x, feet - 2, z)].some(
      (cell) => cell?.name === 'lava' || cell?.name === 'magma_block',
    );
  }
  const floor = read(x, feet - 1, z);
  return (
    floor !== null &&
    floor.boundingBox === 'block' &&
    !HAZARD_CELLS.has(floor.name) &&
    !HAZARD_FLOORS.has(floor.name)
  );
}

/**
 * The nearest breathable cell a pinned swimmer can reach: a breadth-first search out to 8 steps
 * through water and air, so a solid block in the way is a wall and the route goes round it. A cell
 * is breathable when its head level is swimmable and the cell above is open air, which covers dry
 * air and the surface of a lake. `keep` (the last target) stays while it is no more than one step
 * further than the nearest, so the target changes only for a gain of 2 steps. Null when none is in range.
 */
export function findLateralExit(
  read: BlockReader,
  from: { x: number; y: number; z: number },
  keep?: { x: number; z: number },
): LateralExit | null {
  const feet = Math.floor(from.y);
  const cx = Math.floor(from.x);
  const cz = Math.floor(from.z);
  const key = (x: number, z: number): string => `${x},${z}`;
  const { cells, parent } = reachCells(from, LATERAL_RADIUS, (x, z) => {
    if (!swimmable(read(x, feet, z)) || !swimmable(read(x, feet + 1, z))) return false;
    return supported(read, x, feet, z);
  });
  const found = cells.filter(
    (cell) =>
      cell.steps > 0 &&
      breathableAt(read, cell.x, feet, cell.z) &&
      supported(read, cell.x, feet, cell.z),
  );
  const nearest = found[0];
  if (!nearest) return null;
  const kept = keep ? found.find((cell) => cell.x === keep.x && cell.z === keep.z) : undefined;
  const chosen = kept && kept.steps < nearest.steps + LATERAL_HYSTERESIS ? kept : nearest;
  const path: Array<{ x: number; z: number }> = [];
  let step: { x: number; z: number } | null | undefined = { x: chosen.x, z: chosen.z };
  while (step && (step.x !== cx || step.z !== cz)) {
    path.unshift(step);
    step = parent.get(key(step.x, step.z));
  }
  const first = path[0];
  if (!first) return null;
  const side = SIDES.find(
    (s) => s.dx === Math.sign(first.x - cx) && s.dz === Math.sign(first.z - cz),
  );
  return {
    x: chosen.x,
    z: chosen.z,
    direction: side?.direction ?? '',
    distance: chosen.steps,
    path,
  };
}
