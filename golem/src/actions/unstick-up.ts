import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { canStepOff } from '../body/view.ts';
import { unbreakableReason } from './bare-hand.ts';
import type { Block } from './bot-types.ts';
import { digSafetyRefusal } from './dig-safety.ts';
import { isOwnPlacement } from './own-placements.ts';
import { protectedReason, refusedByName } from './protected-blocks.ts';
import { digGuardRefuses } from './unstick-guard.ts';

/** Seconds a bare hand takes on a block: about 5 s per point of hardness, at least half a second. Unknown counts as least. */
export function handSeconds(block: Block | null): number {
  if (block === null || block.boundingBox === 'empty') return 0;
  const hardness = (block as { hardness?: number | null }).hardness;
  return Math.max(0.5, 5 * (typeof hardness === 'number' ? hardness : 0));
}

/** A harvest tool digs a block in about a fifth of the hand estimate: a deliberately low divisor (conservative). */
const TOOL_DIVISOR = 5;

/**
 * Seconds one dig of `block` may spend (decision 0210). The hand estimate, unless `bestHarvestTool`, the
 * tool `dig()` equips for the block, has one: then the hand estimate over `TOOL_DIVISOR` (at least 0.5 s).
 */
export function digSeconds(bot: Bot, block: Block | null): number {
  const hand = handSeconds(block);
  if (block === null || hand === 0) return hand;
  const pathfinder = (
    bot as unknown as { pathfinder?: { bestHarvestTool?: (b: Block) => unknown } }
  ).pathfinder;
  return pathfinder?.bestHarvestTool?.(block) ? Math.max(0.5, hand / TOOL_DIVISOR) : hand;
}

/**
 * Hand-dig time one stair step, sideways dig or upward climb may spend (decision 0183). The action's 30 s
 * limit covers this plus the walks and waits around it. A step that would need more is refused before
 * any block is broken.
 */
export const DIG_BUDGET_S = 25;
/** Steps of one block the upward rung climbs at most. */
export const MAX_UP_STEPS = 4;
/** Ticks one hop may take, and the rise that counts as a hop. */
const HOP_TICKS = 20;
const RISE = 0.9;
/** The action's time limit (30 s, `unstick`'s timeout). A climb counts the time already spent against it. */
export const ACTION_LIMIT_S = 30;
/** Seconds kept back from the limit for the hop that follows a climb's digs. */
const HOP_RESERVE_S = 1;

/**
 * Seconds of the action's limit left for one more step, with the hop reserve kept back (decision 0210).
 * Counted from `startedMs`, the start of the whole call, so the walks and digs already spent count.
 */
export function timeLeftS(startedMs: number): number {
  return ACTION_LIMIT_S - HOP_RESERVE_S - (Date.now() - startedMs) / 1000;
}

const UP = new Vec3(0, 1, 0);
/** Stands in for a cell the climb has already left: the shaft is solid for the step-off test. */
const SHAFT_WALL = { name: 'stone', boundingBox: 'block' } as unknown as Block;
/** Underwater plants: a Body in them is in water, so they are not open air. */
const WATER_PLANTS = new Set(['seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'bubble_column']);
/** Blocks a climb never stands under: contact burns, pricks or sets the Body alight. */
const HARMFUL_STAND = new Set(['magma_block', 'cactus', 'fire']);

/** A block that stands solid for a hop: not water, lava or an open cell. */
const solidBlock = (b: Block | null): b is Block => b !== null && b.boundingBox === 'block';
/** An open cell the Body can enter: empty, and not a liquid or an underwater plant. */
const openCell = (b: Block | null): boolean =>
  b !== null &&
  b.boundingBox === 'empty' &&
  b.name !== 'water' &&
  b.name !== 'lava' &&
  !WATER_PLANTS.has(b.name);

/** Where the upward rung ended: freed, the blocks it broke, and the facts that stopped it (or null). */
export interface UpResult {
  freed: boolean;
  dug: number;
  blocked: string | null;
}

/** One climb step: the wall beside the Body, the cells to dig above it, and their hand-dig time. */
interface Step {
  dir: Vec3;
  cells: { cell: Vec3; block: Block }[];
  cost: number;
}

/**
 * Why one cell above the wall may not be dug, or null. Liquids and underwater plants, unbreakable blocks,
 * refused names, a liquid or falling block beside it (`hazardReason`) and someone else's work
 * (`protectedReason`, decision 0164) all refuse. Ownership unknown refuses too, as `isProtected` refuses it.
 */
function cellRefusal(
  bot: Bot,
  block: Block,
  cell: Vec3,
  own: readonly Vec3[],
  refuseOwn: boolean,
): string | null {
  if (refuseOwn && isOwnPlacement(bot, cell)) {
    return `${block.name} at ${cell.x},${cell.y},${cell.z} is the Body's own placement; it is dug last`;
  }
  if (block.name === 'water' || block.name === 'lava' || WATER_PLANTS.has(block.name)) {
    return `${block.name} is above the wall at ${cell.x},${cell.y},${cell.z}; the climb would meet it`;
  }
  const { hardness } = block as { hardness?: number | null };
  if (typeof hardness !== 'number' || hardness < 0) {
    return `${block.name} cannot be broken by a bare hand`;
  }
  if (refusedByName(block.name)) return `${block.name} is not dug on the way out`;
  return (
    unbreakableReason(block) ??
    digSafetyRefusal({ bot, block, at: cell, own }) ??
    protectedReason(bot, block, cell)
  );
}

/**
 * The climb step toward `dir`: the wall cell beside the Body must be solid and not harmful to stand on, its
 * two cells above must be open or diggable, and the Body's head cell must be open. Returns the step, a
 * refusal text, or null when there is no wall that way.
 */
function planStep(bot: Bot, feet: Vec3, dir: Vec3, refuseOwn = false): Step | string | null {
  const stand = feet.plus(dir);
  const wall = bot.blockAt(stand);
  if (!solidBlock(wall)) return null;
  if (HARMFUL_STAND.has(wall.name)) {
    return `${wall.name} at ${stand.x},${stand.y},${stand.z} would hurt the Body on the climb`;
  }
  if (!openCell(bot.blockAt(feet.plus(UP)))) return null;
  const own = [feet, feet.plus(UP)];
  const cells: { cell: Vec3; block: Block }[] = [];
  let cost = 0;
  for (const cell of [stand.plus(UP), stand.plus(UP).plus(UP)]) {
    const block = bot.blockAt(cell);
    if (block?.name === 'fire') {
      return `fire at ${cell.x},${cell.y},${cell.z} would burn the Body on the climb`;
    }
    if (openCell(block)) continue;
    if (block === null) return `the cell at ${cell.x},${cell.y},${cell.z} is not loaded`;
    const refusal = cellRefusal(bot, block, cell, own, refuseOwn);
    if (refusal) return refusal;
    cells.push({ cell, block });
    cost += digSeconds(bot, block);
  }
  return { dir, cells, cost };
}

/**
 * Breaks one block with the best tool held; false when the dig fails, the signal is aborted, or the bot's dig
 * guard refuses the step (decision 0336). Every climb dig asks the guard first, so a cave mouth or liquid that
 * an earlier dig revealed refuses the next one.
 */
async function digBlock(bot: Bot, signal: AbortSignal, block: Block): Promise<boolean> {
  if (digGuardRefuses(bot, block)) return false;
  const loose = bot as unknown as {
    pathfinder?: { stop(): void; setGoal(g: null): void; bestHarvestTool?: (b: Block) => unknown };
    stopDigging?: () => void;
  };
  const onAbort = (): void => loose.stopDigging?.();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    loose.pathfinder?.stop();
    loose.pathfinder?.setGoal(null);
    const tool = loose.pathfinder?.bestHarvestTool?.(block);
    if (tool) await bot.equip(tool as never, 'hand');
    if (signal.aborted) return false;
    await bot.dig(block, true);
    return true;
  } catch {
    return false;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Walks up one block: a jump forward until the Body has risen `RISE`. True when it rose. */
async function hop(bot: Bot, signal: AbortSignal, dir: Vec3): Promise<boolean> {
  const before = bot.entity.position.y;
  await bot.lookAt(bot.entity.position.offset(dir.x * 4, 1.62, dir.z * 4), true);
  try {
    bot.setControlState('forward', true);
    bot.setControlState('jump', true);
    for (let i = 0; i < HOP_TICKS && !signal.aborted; i++) {
      await bot.waitForTicks(1);
      if (bot.entity.position.y - before >= RISE) break;
    }
  } finally {
    bot.setControlState('forward', false);
    bot.setControlState('jump', false);
  }
  return bot.entity.position.y - before >= RISE;
}

/**
 * The upward hand-dig rung (decision 0196): climbs out of a pit one block at a time. Each step digs the two
 * cells above a solid wall beside the Body, then hops onto the wall's top, the same shape as `stairs`
 * (escape-stairs.ts) but with the 25 s hand-dig budget and the refusals of `cellRefusal`. Stops once the
 * Body stands on a cell from which `canStepOff` finds a way out, with every cell it has climbed through
 * counted as solid (the shaft it left is not a way out). Stops too when the budget runs out, when a dig is
 * refused, or when `signal` aborts. Every block broken is counted in `dug`. `startedMs` is when the whole
 * action began: the time it has spent counts against the 30 s limit. `digsLeft` caps the blocks broken.
 */
export async function digUp(
  bot: Bot,
  signal: AbortSignal,
  where: () => Vec3,
  dirs: readonly Vec3[],
  startedMs = Date.now(),
  digsLeft = Number.POSITIVE_INFINITY,
  refuseOwn = false,
): Promise<UpResult> {
  let dug = 0;
  let spent = 0;
  let blocked: string | null = null;
  const left: Vec3[] = [];
  // Any column the Body has climbed through is shaft at every height: the cells above it are not a way out.
  const shaftAt = (at: Vec3): Block | null =>
    left.some((c) => at.x === c.x && at.z === c.z) ? SHAFT_WALL : bot.blockAt(at);
  for (let climb = 0; climb < MAX_UP_STEPS; climb++) {
    if (signal.aborted) return { freed: false, dug, blocked: null };
    const feet = where();
    const options: Step[] = [];
    for (const dir of dirs) {
      const plan = planStep(bot, feet, dir, refuseOwn);
      if (typeof plan === 'string') blocked ??= plan;
      else if (plan !== null) options.push(plan);
    }
    options.sort((a, b) => a.cost - b.cost);
    const pick = options[0];
    if (!pick) return { freed: false, dug, blocked };
    if (spent + pick.cost > DIG_BUDGET_S) {
      const need = Math.ceil(spent + pick.cost);
      return {
        freed: false,
        dug,
        blocked: `the next climb needs about ${need} s of hand digging; the budget is ${DIG_BUDGET_S} s`,
      };
    }
    const elapsedS = (Date.now() - startedMs) / 1000;
    if (elapsedS + spent + pick.cost + HOP_RESERVE_S > ACTION_LIMIT_S) {
      return {
        freed: false,
        dug,
        blocked: `the next climb would run past the ${ACTION_LIMIT_S} s action limit`,
      };
    }
    if (dug + pick.cells.length > digsLeft) {
      return {
        freed: false,
        dug,
        blocked: `the next climb needs ${pick.cells.length} digs and ${digsLeft - dug} are left`,
      };
    }
    spent += pick.cost;
    for (const { cell, block } of pick.cells) {
      if (signal.aborted) return { freed: false, dug, blocked: null };
      if (!(await digBlock(bot, signal, block))) {
        return {
          freed: false,
          dug,
          blocked: `${block.name} at ${cell.x},${cell.y},${cell.z} was not dug`,
        };
      }
      dug++;
    }
    if (signal.aborted) return { freed: false, dug, blocked: null };
    if (!(await hop(bot, signal, pick.dir))) {
      return { freed: false, dug, blocked: 'the Body did not rise onto the cleared wall' };
    }
    left.push(feet);
    if (canStepOff(shaftAt, where())) return { freed: true, dug, blocked: null };
  }
  return { freed: false, dug, blocked: `the climb reached ${MAX_UP_STEPS} blocks with no ledge` };
}
