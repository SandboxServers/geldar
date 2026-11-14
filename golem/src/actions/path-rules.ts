/**
 * Pure rules of the path search, kept apart from the walk: the corner rule (no diagonal past a solid side),
 * the dry end of a walk, and the map from a pathfinder error to a move reason. None of them starts a walk
 * or moves the bot.
 */

/** A block as the pathfinder's `getBlock` returns it: prismarine fields plus its own flags. */
interface PathBlock {
  physical?: boolean;
  safe?: boolean;
  type?: number;
}

/** The parts of a pathfinder `Movements` that the corner rule reads and wraps. */
interface DiagonalMovements {
  carpets?: Set<number>;
  getBlock(node: unknown, dx: number, dy: number, dz: number): PathBlock;
  getMoveDiagonal(node: unknown, dir: { x: number; z: number }, neighbors: unknown[]): void;
}

/** True for a carpet: `physical` to the library, but flat, so it never presses the bot sideways. */
function isFlat(m: DiagonalMovements, block: PathBlock): boolean {
  return block.type !== undefined && Boolean(m.carpets?.has(block.type));
}

/**
 * Allows a diagonal step only when both orthogonal side cells are free. At foot level a side cell
 * blocks when it is solid, or unsafe (fences, walls, fire, lava, unloaded: `safe` is false and
 * `physical` may be too); flat blocks do not. At head level only a solid block blocks (an overhang).
 * The library accepts a diagonal when one side is free, so the bot cuts a corner, presses against
 * the block and Paper rejects its position every tick (live: the bed walk past the crafting table
 * rubber-banded until the 600-tick stall rule fired). With both sides free it never touches one.
 */
export function forbidCornerCutting(movements: unknown): void {
  const m = movements as DiagonalMovements;
  const original = m.getMoveDiagonal.bind(m);
  const sideBlocked = (node: unknown, dx: number, dz: number): boolean => {
    const foot = m.getBlock(node, dx, 0, dz);
    if (foot.safe === false || (foot.physical && !isFlat(m, foot))) return true;
    const head = m.getBlock(node, dx, 1, dz);
    return Boolean(head.physical) && !isFlat(m, head);
  };
  m.getMoveDiagonal = (node, dir, neighbors) => {
    if (sideBlocked(node, dir.x, 0) || sideBlocked(node, 0, dir.z)) return;
    original(node, dir, neighbors);
  };
}

/** The parts of a pathfinder near goal that a walk reads: whether a node ends the walk. */
export interface EndGoal {
  isEnd(node: { x: number; y: number; z: number }): boolean;
}

/**
 * Wraps a near goal so that a node whose feet cell is water is never the end of the walk. `isWater`
 * reads the feet cell by coordinates. The wrapper keeps the goal's other methods (through the prototype).
 */
export function dryGoal<G extends EndGoal>(
  goal: G,
  isWater: (x: number, y: number, z: number) => boolean,
): G {
  const dry = Object.create(goal) as G;
  dry.isEnd = (node) => goal.isEnd(node) && !isWater(node.x, node.y, node.z);
  return dry;
}

/**
 * Maps a pathfinder error to a move reason. `NoPath` means the way is blocked; `Timeout` (the path
 * search ran out of time) is `timeout`, which runs no escape ladder; `GoalChanged` means something
 * else took over. Anything else is null: not a move result.
 */
export function classifyPathError(error: unknown): 'blocked' | 'timeout' | 'interrupted' | null {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'NoPath') return 'blocked';
  if (name === 'Timeout') return 'timeout';
  if (name === 'GoalChanged') return 'interrupted';
  return null;
}
