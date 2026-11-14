import { Vec3 } from 'vec3';

/**
 * A recipient closer than this (blocks) is too close for a toss to land past them: the items fall
 * short of, or onto, the recipient, who does not move to collect them. The Body steps back first.
 */
export const STEP_BACK_BELOW = 1.5;
/** The distance (blocks) the Body steps back to from a recipient that is too close. */
export const STEP_BACK_TO = 2;

/**
 * The point `distance` blocks from `recipient`, on the line from the recipient through `body`, at
 * the body's height. Only the x and z axes count, so the step is level. Null when the two stand on
 * the same spot: there is no line to step along, so the Body does not step.
 */
export function stepBackPoint(
  body: Vec3,
  recipient: Vec3,
  distance: number = STEP_BACK_TO,
): Vec3 | null {
  const dx = body.x - recipient.x;
  const dz = body.z - recipient.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return null;
  return new Vec3(
    recipient.x + (dx / length) * distance,
    body.y,
    recipient.z + (dz / length) * distance,
  );
}

/**
 * The turns (radians) the Body tries around the recipient when the straight-back spot is blocked:
 * 45 and 90 degrees either side. The straight-back turn comes first.
 */
export const STEP_BACK_TURNS: readonly number[] = [
  0,
  Math.PI / 4,
  -Math.PI / 4,
  Math.PI / 2,
  -Math.PI / 2,
];

/**
 * The spots the Body may step back to, in the order it tries them: the straight-back point, then
 * the same point rotated around `recipient` by each of `STEP_BACK_TURNS`, at the body's height and
 * `distance` blocks out. Empty when the two stand on the same spot.
 */
export function stepBackSpots(
  body: Vec3,
  recipient: Vec3,
  distance: number = STEP_BACK_TO,
): Vec3[] {
  const straight = stepBackPoint(body, recipient, distance);
  if (!straight) return [];
  const dx = straight.x - recipient.x;
  const dz = straight.z - recipient.z;
  return STEP_BACK_TURNS.map((turn) => {
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    return new Vec3(recipient.x + dx * cos - dz * sin, body.y, recipient.z + dx * sin + dz * cos);
  });
}

/** The distances (blocks) from the recipient the Body tries a step back to, for each turn. */
export const STEP_BACK_DISTANCES: readonly number[] = [2, 2.5, 3];

/** The part of a block the step back reads: its name and bounding box (or shapes, when no box is given). */
export interface StepBlock {
  name: string;
  boundingBox?: string;
  shapes?: readonly unknown[];
}

/** The block at a cell, as the Body's world reports it (null or undefined for an unloaded cell). */
export type BlockLookup = (cell: Vec3) => StepBlock | null | undefined;

/** True when a block stops a body: a solid bounding box. Air and non-colliding blocks do not. */
export function blocksBody(block: StepBlock | null | undefined): boolean {
  if (!block) return false;
  if (block.boundingBox !== undefined) return block.boundingBox === 'block';
  return (block.shapes ?? []).length > 0;
}

/** A block the Body can stand on: solid, or a bed (whose box is not a full block). */
function isFloor(block: StepBlock | null | undefined): boolean {
  if (!block) return false;
  return blocksBody(block) || block.name.endsWith('_bed');
}

/** The point `distance` blocks from `recipient` at `turn` (radians) from the straight-back line. */
function turnedSpot(body: Vec3, recipient: Vec3, distance: number, turn: number): Vec3 | null {
  const straight = stepBackPoint(body, recipient, distance);
  if (!straight) return null;
  const dx = straight.x - recipient.x;
  const dz = straight.z - recipient.z;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return new Vec3(recipient.x + dx * cos - dz * sin, body.y, recipient.z + dx * sin + dz * cos);
}

/** The block index of a coordinate. Rounded to 1e-6 first, so a spot on a block edge is not split by float error. */
function blockIndex(coord: number): number {
  return Math.floor(Number(coord.toFixed(6)));
}

/** A cell the Body can stand in: its feet and head cells do not block a body, and its floor is solid or a bed. */
function standable(cell: Vec3, blockAt: BlockLookup): boolean {
  return (
    !blocksBody(blockAt(cell)) &&
    !blocksBody(blockAt(cell.offset(0, 1, 0))) &&
    isFloor(blockAt(cell.offset(0, -1, 0)))
  );
}

/**
 * The standable blocks the Body may step back to, in the order it tries them. For each turn in
 * `STEP_BACK_TURNS`, the spot at each of `STEP_BACK_DISTANCES` from the recipient is mapped to its
 * block. A block is skipped when it is the Body's own, when its centre is under `STEP_BACK_BELOW`
 * from the recipient or more than `reach` away, when it is not standable, or when an earlier spot
 * already gave it. Each one is returned as its centre at the Body's height: the point to walk to.
 */
export function stepBackCells(
  body: Vec3,
  recipient: Vec3,
  blockAt: BlockLookup,
  reach: number,
): Vec3[] {
  const here = new Vec3(Math.floor(body.x), Math.floor(body.y), Math.floor(body.z));
  const seen = new Set<string>();
  const cells: Vec3[] = [];
  for (const turn of STEP_BACK_TURNS) {
    for (const distance of STEP_BACK_DISTANCES) {
      const spot = turnedSpot(body, recipient, distance, turn);
      if (!spot) return [];
      const cell = new Vec3(blockIndex(spot.x), here.y, blockIndex(spot.z));
      const key = `${cell.x},${cell.z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (cell.x === here.x && cell.z === here.z) continue;
      const centre = new Vec3(cell.x + 0.5, cell.y, cell.z + 0.5);
      const gap = Math.hypot(centre.x - recipient.x, centre.z - recipient.z);
      if (gap < STEP_BACK_BELOW || gap > reach) continue;
      if (!standable(cell, blockAt)) continue;
      cells.push(centre);
    }
  }
  return cells;
}
