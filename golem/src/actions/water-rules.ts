import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

/** Block names that put the Body in water: plain water, and the plants and bubbles that grow in it. */
export const WET_CELLS = new Set([
  'water',
  'bubble_column',
  'seagrass',
  'tall_seagrass',
  'kelp',
  'kelp_plant',
]);

/** A predicate over world cells: true when the cell is one of `WET_CELLS`. */
export function wetAt(bot: Bot): (x: number, y: number, z: number) => boolean {
  return (x, y, z) => {
    const name = bot.blockAt(new Vec3(x, y, z))?.name;
    return name !== undefined && WET_CELLS.has(name);
  };
}

/** True when the node's feet cell is water: a walk must not end there. */
export function isWetNode(
  bot: Bot,
  node: { x: number; y: number; z: number } | undefined,
): boolean {
  return node !== undefined && wetAt(bot)(node.x, node.y, node.z);
}

/** What a bank exit costs: a swim's cost (tier-1 `liquidCost` 3) plus one (decision 0194 c). */
export const EXIT_COST = 4;

/** Floors a Body must not climb onto out of the water: heat, cactus and fire. */
const HAZARD_FLOORS = new Set([
  'magma_block',
  'cactus',
  'campfire',
  'soul_campfire',
  'fire',
  'soul_fire',
]);

/** Blocks that fall when nothing holds them up; one over an exit cell lands on the Body. */
const FALLING_BLOCKS = new Set([
  'gravel',
  'suspicious_gravel',
  'sand',
  'suspicious_sand',
  'red_sand',
  'anvil',
  'chipped_anvil',
  'damaged_anvil',
]);

interface Cell {
  name?: string;
  boundingBox?: string;
}

interface Node {
  x: number;
  y: number;
  z: number;
}

/** The parts of the library's `Movements` that the exit rule reads and wraps (pathfinder 2.4.5). */
interface ExitMovements {
  getMoveJumpUp(node: Node, dir: { x: number; z: number }, neighbors: { cost: number }[]): void;
  getBlock(pos: Node, dx: number, dy: number, dz: number): { liquid: boolean; height: number };
}

function cellAt(bot: Bot, x: number, y: number, z: number): Cell | null {
  return bot.blockAt(new Vec3(x, y, z));
}

/**
 * True when a step from the water at `node` onto the bank beside it is a real exit: the feet are
 * in water, the bank is a solid block that is not hazardous, the two cells above it are free and
 * dry, and nothing falls into them.
 */
function isExitBank(bot: Bot, node: Node, dir: { x: number; z: number }): boolean {
  const wet = wetAt(bot);
  if (!wet(node.x, node.y, node.z)) return false;
  const x = node.x + dir.x;
  const z = node.z + dir.z;
  const floor = cellAt(bot, x, node.y, z);
  if (floor?.boundingBox !== 'block' || HAZARD_FLOORS.has(floor.name ?? '')) return false;
  for (const dy of [1, 2]) {
    const cell = cellAt(bot, x, node.y + dy, z);
    if (!cell || cell.boundingBox === 'block' || wet(x, node.y + dy, z)) return false;
  }
  for (const dy of [1, 2, 3]) {
    const name = cellAt(bot, x, node.y + dy, z)?.name;
    if (name !== undefined && FALLING_BLOCKS.has(name)) return false;
  }
  return true;
}

/**
 * Lets the planner climb out of water onto a bank one block above the surface (decision 0194 c).
 * The library refuses a step whose floor is more than 1.2 blocks above the water under the feet
 * (`getMoveJumpUp`, 2.4.5). For a swim node whose bank passes `isExitBank`, the wrapper raises
 * that water cell's height by one while the library's own check runs, then restores `getBlock`.
 * Only this instance is changed. Other nodes go through the library unchanged.
 */
export function allowWaterExit(movements: unknown, bot: Bot): void {
  const m = movements as ExitMovements;
  const jumpUp = m.getMoveJumpUp.bind(m);
  m.getMoveJumpUp = (node, dir, neighbors) => {
    if (!isExitBank(bot, node, dir)) {
      jumpUp(node, dir, neighbors);
      return;
    }
    const previous = m.getBlock;
    const getBlock = previous.bind(m);
    m.getBlock = (pos, dx, dy, dz) => {
      const cell = getBlock(pos, dx, dy, dz);
      const isBase = dx === 0 && dy === -1 && dz === 0 && cell.liquid;
      return isBase ? { ...cell, height: cell.height + 1 } : cell;
    };
    const before = neighbors.length;
    try {
      jumpUp(node, dir, neighbors);
    } finally {
      m.getBlock = previous;
    }
    const exit = neighbors[neighbors.length - 1];
    if (neighbors.length > before && exit) exit.cost = Math.max(exit.cost, EXIT_COST);
  };
}

/** The four steps out of a cell: +x, -x, +z, -z. */
const STEPS = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
];

/** True when a bank exit (`isExitBank`) lies one step from the Body's feet cell (decision 0194 a, c). */
export function exitInReach(bot: Bot, at: { x: number; y: number; z: number }): boolean {
  const node = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) };
  return STEPS.some((dir) => isExitBank(bot, node, dir));
}

/** Each Body's `body_actions.swim` flag. Unset is off, so the 0194 swim code does not run. */
const swimFlag = new WeakMap<Bot, boolean>();

/** Sets the shard's `body_actions.swim` flag for this Body (decision 0194). Called once, at creation. */
export function setSwimEnabled(bot: Bot, on: boolean): void {
  swimFlag.set(bot, on);
}

/** True when the Body's swim flag is on: the goto swims, and the planner may climb a bank out of water. */
export function swimEnabled(bot: Bot): boolean {
  return swimFlag.get(bot) === true;
}
