/** The block facts a retreat stand needs. A mineflayer `Block` fits; `null` means the chunk is not loaded. */
export interface StandBlock {
  name: string;
  boundingBox: string;
}

export type BlockAt = (x: number, y: number, z: number) => StandBlock | null;

export interface Cell {
  x: number;
  y: number;
  z: number;
}

/** Search reach from the safe spot: this many blocks across, and this many up or down. */
export const STAND_RADIUS = 6;
export const STAND_DY = 3;

function isLeaves(block: StandBlock): boolean {
  return block.name.endsWith('leaves');
}

/**
 * A cell the Body can stand on and be safe: solid ground under it that is not leaves, two passable
 * cells for the body, and no leaves overhead. An unloaded cell is never safe.
 */
export function isSafeStand(at: BlockAt, c: Cell): boolean {
  const below = at(c.x, c.y - 1, c.z);
  const feet = at(c.x, c.y, c.z);
  const head = at(c.x, c.y + 1, c.z);
  const overhead = at(c.x, c.y + 2, c.z);
  if (!below || !feet || !head || !overhead) return false;
  if (below.boundingBox !== 'block' || isLeaves(below)) return false;
  if (feet.boundingBox !== 'empty' || head.boundingBox !== 'empty') return false;
  return !isLeaves(feet) && !isLeaves(head) && !isLeaves(overhead);
}

/**
 * The safe stand nearest the spot (the spot itself when it is safe), searched within STAND_RADIUS
 * across and STAND_DY up or down. Ties go to the lower y, then the lower x, then the lower z, so the
 * choice is the same every time. Null when nothing nearby is safe: the Body then stays and fights.
 */
export function nearestSafeStand(at: BlockAt, spot: Cell): Cell | null {
  let best: Cell | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let dy = -STAND_DY; dy <= STAND_DY; dy++) {
    for (let dx = -STAND_RADIUS; dx <= STAND_RADIUS; dx++) {
      for (let dz = -STAND_RADIUS; dz <= STAND_RADIUS; dz++) {
        const c = { x: spot.x + dx, y: spot.y + dy, z: spot.z + dz };
        const dist = dx * dx + dy * dy + dz * dz;
        if (dist > bestDist) continue;
        if (!isSafeStand(at, c)) continue;
        if (dist < bestDist || isBefore(c, best)) {
          best = c;
          bestDist = dist;
        }
      }
    }
  }
  return best;
}

function isBefore(a: Cell, b: Cell | null): boolean {
  if (b === null) return true;
  if (a.y !== b.y) return a.y < b.y;
  if (a.x !== b.x) return a.x < b.x;
  return a.z < b.z;
}
