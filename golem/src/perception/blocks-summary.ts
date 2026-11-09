/** A point in the world, in blocks. */
export interface Point {
  x: number;
  y: number;
  z: number;
}

/** A block the summary describes: its kind and block coordinates. */
export interface SummarizedBlock {
  type: string;
  x: number;
  y: number;
  z: number;
}

/** The 8 compass points, clockwise from north. Minecraft: north is -z, east is +x. */
const COMPASS = [
  'north',
  'north_east',
  'east',
  'south_east',
  'south',
  'south_west',
  'west',
  'north_west',
] as const;

/**
 * The compass point of an offset in the world's x and z (north is -z, east is +x), or `here` when
 * the offset is under half a block on both axes. It reads the world axes, not the bot's yaw.
 */
export function compass(dx: number, dz: number): string {
  if (Math.abs(dx) < 0.5 && Math.abs(dz) < 0.5) return 'here';
  // Angle clockwise from north: north (0, -1) is 0, east (1, 0) is pi/2.
  const angle = Math.atan2(dx, -dz);
  const index = Math.round(angle / (Math.PI / 4));
  return COMPASS[((index % 8) + 8) % 8] ?? 'here';
}

/** The distance from a point to the centre of a block. */
export function distanceToBlock(from: Point, block: Point): number {
  return Math.hypot(block.x + 0.5 - from.x, block.y + 0.5 - from.y, block.z + 0.5 - from.z);
}

/** Orders two blocks by x, then y, then z: the tie-break that keeps the summary byte-stable. */
export function byCoordinates(a: Point, b: Point): number {
  return a.x - b.x || a.y - b.y || a.z - b.z;
}

/** A kind's clause part: its nearest block's distance (whole blocks) and direction. */
function where(from: Point, block: Point): string {
  const distance = Math.round(distanceToBlock(from, block));
  const direction = compass(block.x + 0.5 - from.x, block.z + 0.5 - from.z).replace('_', '-');
  return `${distance} ${direction}`;
}

/**
 * The fixed-template sentence for the `blocks_summary`: one clause per block kind, joined by `; `,
 * nearest kind first and ties by name. A single block reads `chest 3 east`, several read
 * `oak_log x12, nearest 7 north`. Distances are whole blocks, directions the 8-point compass
 * with `-` inside a name. The same blocks and position always give the same bytes.
 */
export function summarizeBlocks(from: Point, blocks: readonly SummarizedBlock[]): string {
  const kinds = new Map<string, { count: number; nearest: SummarizedBlock; distance: number }>();
  for (const block of blocks) {
    const distance = distanceToBlock(from, block);
    const seen = kinds.get(block.type);
    if (!seen) {
      kinds.set(block.type, { count: 1, nearest: block, distance });
      continue;
    }
    seen.count += 1;
    const closer =
      distance < seen.distance ||
      (distance === seen.distance && byCoordinates(block, seen.nearest) < 0);
    if (closer) {
      seen.nearest = block;
      seen.distance = distance;
    }
  }
  const ordered = [...kinds.entries()].sort(
    ([nameA, a], [nameB, b]) =>
      a.distance - b.distance || (nameA < nameB ? -1 : nameA > nameB ? 1 : 0),
  );
  return ordered
    .map(([name, kind]) =>
      kind.count === 1
        ? `${name} ${where(from, kind.nearest)}`
        : `${name} x${kind.count}, nearest ${where(from, kind.nearest)}`,
    )
    .join('; ');
}
