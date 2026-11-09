import type { Action } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Block } from '../../actions/bot-types.ts';
import { runAction } from '../../actions/registry.ts';
import type { Reflex, ReflexContext, ReflexOutcome, Trigger } from '../reflex.ts';
import type { BodyView } from '../view.ts';
import { DIGGABLE_BLOCKS, type DigResult, digCellWhy, holds } from './dig-cell.ts';

/** Blocks the Body seals itself in with, in the order it prefers them (all common digging drops). */
export const SEAL_BLOCKS: readonly string[] = [
  'dirt',
  'cobblestone',
  'cobbled_deepslate',
  'netherrack',
  'stone',
  'andesite',
  'diorite',
  'granite',
  'deepslate',
];
/** Blocks that fall when the block under them goes, so they are no safe wall, roof or floor. */
const FALLING = new Set(['sand', 'red_sand', 'gravel']);
/** The four horizontal directions, in the order a burrow is tried. */
const DIRECTIONS: readonly Vec3[] = [
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
];
/** Ticks the Body walks at most to cross one cell. */
const WALK_TICKS = 40;
/** How close to a cell's center the walk stops, in blocks. */
const ARRIVED = 0.25;

/** A 1x2 pocket dug into a wall, and the two cells that close it again. */
export interface BurrowPlan {
  /** The cell the Body stands in now (feet level) and the cell above it: the burrow's mouth. */
  mouth: [Vec3, Vec3];
  /** The pocket: the feet cell and the head cell above it, to be dug out. */
  pocket: [Vec3, Vec3];
  /** The cells around the pocket (far end, flanks, floor, roof) that must stay solid. */
  closed: Vec3[];
}

/** What the Body remembers of the burrow it dug, until it leaves at dawn. */
interface Burrow {
  mouth: [Vec3, Vec3];
  seal: string;
}

/** The burrows dug so far, by view (one view per Body, so one burrow per Body). */
const burrows = new WeakMap<BodyView, Burrow>();

/** True for a block that is solid, can be dug, and does not fall. */
function isWall(block: Block | null): boolean {
  return block !== null && block.boundingBox === 'block' && !FALLING.has(block.name);
}

/** True for a block the Body may dig out: a wall block `digCell` will accept (the allowlist). */
function isDiggable(block: Block | null): boolean {
  return (
    isWall(block) && block !== null && DIGGABLE_BLOCKS.has(block.name) && block.diggable !== false
  );
}

/**
 * Looks for a wall next to the Body that holds a 1x2 pocket: both pocket cells are diggable and
 * every other side of the pocket (far end, both flanks, floor, roof) is solid and does not fall.
 * Returns null when no direction qualifies, so the reflex refuses instead of digging a death trap.
 */
export function planBurrow(blockAt: (cell: Vec3) => Block | null, feet: Vec3): BurrowPlan | null {
  const up = new Vec3(0, 1, 0);
  for (const dir of DIRECTIONS) {
    const side = new Vec3(dir.z, 0, dir.x);
    const low = feet.plus(dir);
    const high = low.plus(up);
    const closed = [
      low.plus(dir),
      high.plus(dir),
      low.plus(side),
      low.minus(side),
      high.plus(side),
      high.minus(side),
      low.minus(up),
      high.plus(up),
    ];
    if (!isDiggable(blockAt(low)) || !isDiggable(blockAt(high))) continue;
    if (!closed.every((cell) => isWall(blockAt(cell)))) continue;
    return { mouth: [feet, feet.plus(up)], pocket: [low, high], closed };
  }
  return null;
}

/** The first seal block the Body carries, or null. */
export function pickSeal(count: (item: string) => number): string | null {
  return SEAL_BLOCKS.find((name) => count(name) > 0) ?? null;
}

/** Runs one action through the registry; true when it completed. */
async function act(ctx: ReflexContext, action: Action): Promise<boolean> {
  const run = await runAction(ctx.registry, ctx.bot, action, {
    signal: ctx.signal,
    timeScale: ctx.timeScale,
  });
  return run.state === 'completed';
}

/** Walks straight into the cell next to the Body, a few ticks at a time. */
async function stepInto(bot: Bot, cell: Vec3): Promise<boolean> {
  const center = new Vec3(cell.x + 0.5, bot.entity.position.y, cell.z + 0.5);
  try {
    await bot.lookAt(center.offset(0, bot.entity.height ?? 1.62, 0), true);
    bot.setControlState('forward', true);
    for (let i = 0; i < WALK_TICKS; i++) {
      const at = bot.entity.position;
      if (Math.hypot(at.x - center.x, at.z - center.z) < ARRIVED) return true;
      await bot.waitForTicks(1);
    }
    return false;
  } finally {
    bot.setControlState('forward', false);
  }
}

/** The outcome detail for a dig that failed: the step, then why. */
function digDetail(step: string, dug: DigResult): string {
  return dug.cause === undefined ? step : `${step}: ${dug.cause}`;
}

/** Digs `first`, then `second`; stops at the first that fails. */
async function digBoth(ctx: ReflexContext, first: Vec3, second: Vec3): Promise<DigResult> {
  const one = await digCellWhy(ctx, first);
  return one.ok ? digCellWhy(ctx, second) : one;
}

/** Digs the pocket cell by cell, steps in and seals the mouth. */
async function burrow(ctx: ReflexContext, view: BodyView): Promise<ReflexOutcome> {
  const { bot } = ctx;
  // Decide first: a plan that does not exist must not cost the intent its running action.
  const plan = planBurrow((cell) => bot.blockAt(cell), bot.entity.position.floored());
  if (!plan) return { result: 'abandoned', detail: 'no suitable block' };
  await ctx.cancelAction();

  // The cancel took time: the closed cells are checked again before each dig and before the step in.
  const breached = (): boolean => !plan.closed.every((cell) => isWall(bot.blockAt(cell)));
  for (const cell of plan.pocket) {
    if (breached()) return { result: 'failed', detail: 'pocket wall breached' };
    const dug = await digCellWhy(ctx, cell);
    if (!dug.ok) return { result: 'failed', detail: digDetail('could not dig the pocket', dug) };
  }
  if (breached()) return { result: 'failed', detail: 'pocket wall breached' };
  const [low] = plan.pocket;
  if (!(await stepInto(bot, low))) return { result: 'failed', detail: 'could not step in' };
  const seal = pickSeal((item) => view.inventoryCount(item));
  if (seal === null) return { result: 'failed', detail: 'nothing to seal with' };
  // The lower mouth cell first: the upper one rests on it.
  for (const cell of plan.mouth) {
    const at = { x: cell.x, y: cell.y, z: cell.z };
    if (!(await act(ctx, { do: 'place', block: seal, at }))) {
      return { result: 'failed', detail: `could not seal ${at.x} ${at.y} ${at.z}` };
    }
  }
  burrows.set(view, { mouth: plan.mouth, seal });
  return { result: 'handled', detail: 'sealed in' };
}

/** Opens the mouth again (the exact two cells it was sealed at) and walks out. */
async function leave(ctx: ReflexContext, view: BodyView, dug: Burrow): Promise<ReflexOutcome> {
  await ctx.cancelAction();
  const [lower, upper] = dug.mouth;
  const opened = await digBoth(ctx, upper, lower);
  if (!opened.ok) return { result: 'failed', detail: digDetail('could not open the seal', opened) };
  if (!(await stepInto(ctx.bot, lower))) return { result: 'failed', detail: 'could not step out' };
  burrows.delete(view);
  return { result: 'handled', detail: 'left at dawn' };
}

/** True for a water or lava block (a dug-out cell next to one would flood). */
function isFluid(block: Block | null): boolean {
  return block !== null && (block.name === 'water' || block.name === 'lava');
}

/**
 * The way out of a sealed cell the Body has no burrow state for (it restarted or reconnected
 * while sealed): a direction whose feet and head cells are open or a block the Body may dig, over
 * a solid floor, with no water or lava next to either cell. A direction whose cell two steps out
 * (feet level) is open is preferred: it leads outside instead of into a pocket in the rock.
 * Returns the two cells, feet first, or null.
 */
export function planBreakout(
  blockAt: (cell: Vec3) => Block | null,
  feet: Vec3,
): [Vec3, Vec3] | null {
  const up = new Vec3(0, 1, 0);
  const passable = (block: Block | null): boolean =>
    block !== null && (block.boundingBox === 'empty' || DIGGABLE_BLOCKS.has(block.name));
  const dry = (cell: Vec3): boolean =>
    ![cell, cell.plus(up), cell.minus(up), ...DIRECTIONS.map((d) => cell.plus(d))].some((c) =>
      isFluid(blockAt(c)),
    );
  let fallback: [Vec3, Vec3] | null = null;
  for (const dir of DIRECTIONS) {
    const low = feet.plus(dir);
    const high = low.plus(up);
    const floor = blockAt(low.minus(up));
    if (!passable(blockAt(low)) || !passable(blockAt(high))) continue;
    if (floor === null || floor.boundingBox !== 'block') continue;
    if (!dry(low) || !dry(high)) continue;
    const beyond = blockAt(low.plus(dir));
    if (beyond !== null && beyond.boundingBox === 'empty') return [low, high];
    fallback ??= [low, high];
  }
  return fallback;
}

/** Dawn with no burrow state but a closed cell: dig out through an adjacent diggable block. */
async function breakOut(ctx: ReflexContext): Promise<ReflexOutcome> {
  const { bot } = ctx;
  const way = planBreakout((cell) => bot.blockAt(cell), bot.entity.position.floored());
  if (!way) return { result: 'abandoned', detail: 'no block to dig out through' };
  await ctx.cancelAction();
  const [low, high] = way;
  const dug = await digBoth(ctx, high, low);
  if (!dug.ok) return { result: 'failed', detail: digDetail('could not dig out', dug) };
  if (!holds(bot, low) && !(await stepInto(bot, low))) {
    return { result: 'failed', detail: 'could not step out' };
  }
  return { result: 'handled', detail: 'dug out at dawn' };
}

/**
 * Panic burrow (spec 5.2): at night with no bed and no shelter, dig a 1x2 pocket into a wall (the
 * exact cells, with `bot.dig`), step in and seal the mouth with `place`; at dawn open the seal and
 * walk out. A Body that finds itself closed in by day with no burrow state (it restarted while
 * sealed) digs out through an adjacent diggable block. It refuses (outcome `abandoned`) when no
 * wall next to the Body can hold a pocket, and then leaves the running action alone. It needs the
 * `isNight`, `bedNearby` and `enclosed` reads of the view; a view without them never fires it.
 */
export const panicBurrowReflex: Reflex = {
  name: 'panic_burrow',
  priority: 30,
  cooldownTicks: 200,
  check(view): Trigger | null {
    if (burrows.has(view)) {
      return view.isNight === false ? { phase: 'dawn' } : null;
    }
    if (view.isNight === false && view.enclosed === true) return { phase: 'dawn', orphan: true };
    if (view.isNight !== true || view.bedNearby !== false || view.enclosed !== false) return null;
    return { phase: 'night', bed: false, shelter: false };
  },
  async run(trigger, ctx) {
    const dug = burrows.get(ctx.view);
    if (dug && trigger.phase === 'dawn') return leave(ctx, ctx.view, dug);
    if (trigger.orphan === true) return breakOut(ctx);
    return burrow(ctx, ctx.view);
  },
};
