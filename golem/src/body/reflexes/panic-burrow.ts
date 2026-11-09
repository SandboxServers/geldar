import type { Action } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Block } from '../../actions/bot-types.ts';
import { runAction } from '../../actions/registry.ts';
import type { Reflex, ReflexContext, ReflexOutcome, Trigger } from '../reflex.ts';
import type { BodyView } from '../view.ts';

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
/** Mine attempts for one cell: `mine` takes the nearest block of a name, which may be another cell. */
const DIG_ATTEMPTS = 3;
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

/** True for a block the Body may dig out: a wall block that is diggable. */
function isDiggable(block: Block | null): boolean {
  return isWall(block) && block?.diggable !== false;
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
    return { mouth: [feet, feet.plus(up)], pocket: [low, high] };
  }
  return null;
}

/** The first seal block the Body carries, or null. */
export function pickSeal(count: (item: string) => number): string | null {
  return SEAL_BLOCKS.find((name) => count(name) > 0) ?? null;
}

/** Runs one action through the registry; true when it completed. */
async function act(ctx: ReflexContext, action: Action): Promise<boolean> {
  const run = await runAction(ctx.registry, ctx.bot, action, { signal: ctx.signal });
  return run.state === 'completed';
}

/** True while the cell holds a block (the bot reads its own client world). */
function holds(bot: Bot, cell: Vec3): boolean {
  return (bot.blockAt(cell)?.boundingBox ?? 'empty') !== 'empty';
}

/** Mines `name` until the cell is empty, at most `DIG_ATTEMPTS` times. */
async function dig(ctx: ReflexContext, cell: Vec3, name: string): Promise<boolean> {
  for (let i = 0; i < DIG_ATTEMPTS && holds(ctx.bot, cell); i++) {
    if (ctx.signal.aborted || !(await act(ctx, { do: 'mine', block: name, count: 1 }))) break;
  }
  return !holds(ctx.bot, cell);
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

/** Digs the pocket, steps in and seals the mouth. */
async function burrow(ctx: ReflexContext, view: BodyView): Promise<ReflexOutcome> {
  const { bot } = ctx;
  await ctx.cancelAction();
  const feet = bot.entity.position.floored();
  const plan = planBurrow((cell) => bot.blockAt(cell), feet);
  if (!plan) return { result: 'abandoned', detail: 'no suitable block' };

  const [low, high] = plan.pocket;
  const names = [bot.blockAt(low)?.name ?? '', bot.blockAt(high)?.name ?? ''];
  // The lower cell first: it is the nearer, so the nearest-block mine is most likely to take it.
  if (!(await dig(ctx, low, names[0] ?? '')) || !(await dig(ctx, high, names[1] ?? ''))) {
    return { result: 'failed', detail: 'could not dig the pocket' };
  }
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

/** Opens the mouth again and walks out. */
async function leave(ctx: ReflexContext, view: BodyView, dug: Burrow): Promise<ReflexOutcome> {
  await ctx.cancelAction();
  const [lower, upper] = dug.mouth;
  if (!(await dig(ctx, upper, dug.seal)) || !(await dig(ctx, lower, dug.seal))) {
    return { result: 'failed', detail: 'could not open the seal' };
  }
  if (!(await stepInto(ctx.bot, lower))) return { result: 'failed', detail: 'could not step out' };
  burrows.delete(view);
  return { result: 'handled', detail: 'left at dawn' };
}

/**
 * Panic burrow (spec 5.2): at night with no bed and no shelter, dig a 1x2 pocket into a wall with
 * `mine`, step in and seal the mouth with `place`; at dawn open the seal and walk out. It refuses
 * (outcome `abandoned`) when no wall next to the Body can hold a pocket. It needs the `isNight`,
 * `bedNearby` and `enclosed` reads of the view; a view without them never fires it.
 */
export const panicBurrowReflex: Reflex = {
  name: 'panic_burrow',
  priority: 30,
  cooldownTicks: 200,
  check(view): Trigger | null {
    if (burrows.has(view)) {
      return view.isNight === false ? { phase: 'dawn' } : null;
    }
    if (view.isNight !== true || view.bedNearby !== false || view.enclosed !== false) return null;
    return { phase: 'night', bed: false, shelter: false };
  },
  async run(trigger, ctx) {
    const dug = burrows.get(ctx.view);
    if (dug && trigger.phase === 'dawn') return leave(ctx, ctx.view, dug);
    return burrow(ctx, ctx.view);
  },
};
