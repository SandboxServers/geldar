/**
 * Soft-dig pathing (decision C5-01 soft-dig pathing, Proposed). `goto` may dig through a strict set
 * of natural soft blocks (leaves, vines, snow layers, plant cover) so an agent stuck on an oak
 * canopy can cross or descend it. Everything else stays undiggable: `mine` and `place` own real
 * block work. The idea (cheap soft blocks are crossable, replan on stall) comes from the goldar
 * repo (MIT); the code here is our own.
 */

/** A block as the pathfinder hands it to `safeToBreak`. */
interface DigBlock {
  name?: string;
  type?: number;
  position: { x: number; y: number; z: number };
}

/** The neighbor facts the rule reads; the library's `Movements.getBlock` returns them. */
interface DigNeighbor {
  liquid?: boolean;
  canFall?: boolean;
}

/** The parts of a pathfinder `Movements` that the soft-dig rule reads and replaces. */
export interface SoftDigMovements {
  canDig: boolean;
  digCost: number;
  dontCreateFlow: boolean;
  dontMineUnderFallingBlock: boolean;
  bot: { health?: number };
  getBlock(pos: DigBlock['position'], dx: number, dy: number, dz: number): DigNeighbor;
  safeToBreak(block: DigBlock): boolean;
}

/** Digging stops below this health (half hearts), so a fall after a dig cannot kill. */
export const MIN_DIG_HEALTH = 8;
/** Per-block labor multiplier: leaves come out near 3 (library: (1 + 3 * seconds) * digCost). */
export const SOFT_DIG_COST = 2;

/** Fixed texts for a failed or partial walk (no library message reaches the agent). */
export const NO_PATH_TEXT = 'no path to the target';
export const SEARCH_TIMEOUT_TEXT = 'the path search ran out of time';
export const PARTIAL_TEXT =
  'partial: the goal is unreachable, walked to the closest reachable spot';

const PLANT_COVER = new Set([
  'short_grass',
  'grass',
  'tall_grass',
  'fern',
  'large_fern',
  'dandelion',
  'poppy',
  'azure_bluet',
  'oxeye_daisy',
  'cornflower',
  'lily_of_the_valley',
  'allium',
  'blue_orchid',
  'red_tulip',
  'orange_tulip',
  'white_tulip',
  'pink_tulip',
  'dead_bush',
  'sweet_berry_bush',
]);

/** True for the natural soft blocks a walk may dig. A name test only: placed look-alikes do not exist. */
export function isSoftDigName(name: string | undefined): boolean {
  if (!name) return false;
  return name.endsWith('_leaves') || name === 'vine' || name === 'snow' || PLANT_COVER.has(name);
}

const SIDES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 0],
  [0, -1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * Switches digging on for a `Movements` and narrows it to the soft whitelist. A block is diggable
 * only when its name is whitelisted, no fluid touches it on any face, nothing that falls (sand,
 * gravel) sits above it, and the bot's health is at least `MIN_DIG_HEALTH`.
 */
export function installSoftDig(movements: unknown): void {
  const m = movements as SoftDigMovements;
  m.canDig = true;
  m.digCost = SOFT_DIG_COST;
  m.dontCreateFlow = true;
  m.dontMineUnderFallingBlock = true;
  m.safeToBreak = (block: DigBlock): boolean => {
    if (!isSoftDigName(block.name)) return false;
    const health = m.bot.health;
    if (health !== undefined && health < MIN_DIG_HEALTH) return false;
    for (const [dx, dy, dz] of SIDES) {
      if (m.getBlock(block.position, dx, dy, dz).liquid) return false;
    }
    return !m.getBlock(block.position, 0, 1, 0).canFall;
  };
}
