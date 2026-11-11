import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Block } from './bot-types.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/** Health below this: the Body never drops on purpose (a fall could finish it). */
export const MIN_HEALTH_TO_DROP = 12;
/** Health the Body keeps after the worst fall it chooses. */
const HEALTH_MARGIN = 8;
/** The deepest drop the Body takes on purpose, in blocks. */
export const MAX_DROP = 6;
/** The lowest block row of the world; a column with no floor above it is a void. */
const WORLD_BOTTOM = -64;
/** Ticks one move is tried, and the horizontal distance that counts as free. */
const MOVE_TICKS = 24;
const FREE_DISTANCE = 1.5;
/** The most digs one call makes. */
const MAX_DIGS = 6;

/** Blocks the Body digs with bare hands to get out: leaves and loose or soft ground, never ore or wood. */
const SOFT = new Set([
  'dirt',
  'grass_block',
  'coarse_dirt',
  'podzol',
  'sand',
  'red_sand',
  'gravel',
  'snow',
  'snow_block',
]);
/** Blocks that hurt or kill whoever lands on them. */
const HARMFUL = new Set(['lava', 'magma_block', 'cactus', 'fire', 'soul_fire', 'sweet_berry_bush']);

/** The eight horizontal directions, nearest-first: the four axes, then the diagonals. */
export const EIGHT: readonly Vec3[] = [
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
  new Vec3(1, 0, 1),
  new Vec3(1, 0, -1),
  new Vec3(-1, 0, 1),
  new Vec3(-1, 0, -1),
];

type BlockAt = (cell: Vec3) => Block | null;

/** Fall damage in half hearts for a drop of `blocks` (vanilla: one per block past three). */
export function fallDamage(blocks: number): number {
  return Math.max(0, Math.ceil(blocks - 3));
}

/** Where a fall from a cell ends, and how far it is. */
export interface Drop {
  blocks: number;
  /** `water` cancels the damage; `unsafe` is lava, a cactus, a void or an unloaded column. */
  lands: 'solid' | 'water' | 'unsafe';
}

/** Scans down from `start` (the first cell under the feet) until something stops the fall. */
export function scanDrop(blockAt: BlockAt, start: Vec3): Drop {
  for (let blocks = 0; blocks <= MAX_DROP; blocks++) {
    const cell = start.offset(0, -blocks, 0);
    if (cell.y < WORLD_BOTTOM) return { blocks, lands: 'unsafe' };
    const block = blockAt(cell);
    if (block === null) return { blocks, lands: 'unsafe' };
    if (HARMFUL.has(block.name)) return { blocks, lands: 'unsafe' };
    if (block.name === 'water') return { blocks, lands: 'water' };
    if (block.boundingBox !== 'empty') return { blocks, lands: 'solid' };
  }
  return { blocks: MAX_DROP + 1, lands: 'unsafe' };
}

/**
 * The safe-drop rule: never at low health, never into lava or a void, never deeper than `MAX_DROP`,
 * and the fall must leave `HEALTH_MARGIN` health. Water takes the damage away.
 */
export function dropAllowed(health: number, drop: Drop): boolean {
  if (health < MIN_HEALTH_TO_DROP || drop.lands === 'unsafe' || drop.blocks > MAX_DROP)
    return false;
  return drop.lands === 'water' || fallDamage(drop.blocks) <= health - HEALTH_MARGIN;
}

/** One way off the spot: where to head, whether to jump, and how far it drops. */
export interface Move {
  dir: Vec3;
  jump: boolean;
  drop: number;
}

const empty = (block: Block | null): boolean => block !== null && block.boundingBox === 'empty';

/**
 * The moves from `feet` that a bot may try: a level walk, a one-block step up (jump), or a walk off a
 * ledge that `dropAllowed` accepts. Level moves come first, then steps, then drops shallowest first.
 */
export function planMoves(blockAt: BlockAt, feet: Vec3, health: number): Move[] {
  const moves: Move[] = [];
  const up = new Vec3(0, 1, 0);
  for (const dir of EIGHT) {
    const at = feet.plus(dir);
    if (empty(blockAt(at)) && empty(blockAt(at.plus(up)))) {
      const drop = scanDrop(blockAt, at.minus(up));
      if (drop.blocks === 0 && drop.lands === 'solid') moves.push({ dir, jump: false, drop: 0 });
      else if (dropAllowed(health, drop)) moves.push({ dir, jump: false, drop: drop.blocks });
    } else if (
      empty(blockAt(at.plus(up))) &&
      empty(blockAt(at.plus(up).plus(up))) &&
      empty(blockAt(feet.plus(up).plus(up)))
    ) {
      moves.push({ dir, jump: true, drop: 0 });
    }
  }
  return moves.sort((a, b) => Number(a.drop > 0) - Number(b.drop > 0) || a.drop - b.drop);
}

/** True for a block bare hands can take out quickly: leaves and `SOFT`. */
export function isSoft(block: Block | null): boolean {
  return (
    block !== null &&
    block.diggable !== false &&
    (block.name.endsWith('_leaves') || SOFT.has(block.name))
  );
}

/** Heads for `dir` for up to `MOVE_TICKS` ticks; true once the bot is `FREE_DISTANCE` from where it began. */
async function walk(ctx: ActionContext, dir: Vec3, jump: boolean): Promise<boolean> {
  const { bot } = ctx;
  const start = bot.entity.position.clone();
  try {
    await bot.lookAt(start.offset(dir.x * 4, bot.entity.height ?? 1.62, dir.z * 4), true);
    bot.setControlState('forward', true);
    bot.setControlState('jump', jump);
    for (let i = 0; i < MOVE_TICKS && !ctx.signal.aborted; i++) {
      await bot.waitForTicks(1);
      const at = bot.entity.position;
      if (Math.hypot(at.x - start.x, at.z - start.z) >= FREE_DISTANCE) return true;
    }
    return false;
  } finally {
    bot.setControlState('forward', false);
    bot.setControlState('jump', false);
  }
}

/** Digs one block with bare hands; false on any failure. */
async function dig(bot: Bot, block: Block): Promise<boolean> {
  try {
    await bot.dig(block, true);
    return true;
  } catch (error) {
    console.warn(`unstick dig failed: ${errorText(error)}`);
    return false;
  }
}

/** Digs the soft block under the feet when the fall that follows is allowed. */
async function digDown(bot: Bot, feet: Vec3): Promise<boolean> {
  const floor = feet.offset(0, -1, 0);
  const block = bot.blockAt(floor);
  if (!isSoft(block) || block === null) return false;
  const below = scanDrop((cell) => bot.blockAt(cell), floor.offset(0, -1, 0));
  const drop: Drop = { blocks: below.blocks + 1, lands: below.lands };
  if (!dropAllowed(bot.health ?? 20, drop)) return false;
  return dig(bot, block);
}

/** Digs through the soft block(s) at a neighbour's feet and head cells so the bot can walk there. */
async function digSideways(bot: Bot, feet: Vec3, dir: Vec3): Promise<boolean> {
  const at = feet.plus(dir);
  const cells = [at.offset(0, 1, 0), at];
  const blocks = cells.map((cell) => bot.blockAt(cell));
  if (!blocks.every((block) => empty(block) || isSoft(block))) return false;
  if (!blocks.some(isSoft)) return false;
  if (
    !dropAllowed(
      bot.health ?? 20,
      scanDrop((cell) => bot.blockAt(cell), at.offset(0, -1, 0)),
    )
  ) {
    return false;
  }
  for (const block of blocks) {
    if (block !== null && block.boundingBox !== 'empty' && !(await dig(bot, block))) return false;
  }
  return true;
}

/**
 * Gets a stuck bot free, with bare hands and no blocks placed: first walks or jumps in each of the
 * eight directions (including a deliberate drop off a ledge when `dropAllowed`), then digs sideways
 * (four directions) or down through soft blocks. At most `MAX_DIGS` digs and one try per direction.
 */
export async function unstick(ctx: ActionContext): Promise<ActionOutcome> {
  const { bot } = ctx;
  const where = (): Vec3 => bot.entity.position.floored();
  const health = (): number => bot.health ?? 20;
  let tries = 0;
  for (const move of planMoves((cell) => bot.blockAt(cell), where(), health())) {
    if (ctx.signal.aborted) return cancelled();
    tries++;
    if (await walk(ctx, move.dir, move.jump)) {
      return completed({ method: move.drop > 0 ? 'drop' : 'step', tries });
    }
  }
  let digs = 0;
  for (const dir of EIGHT.slice(0, 4)) {
    if (ctx.signal.aborted) return cancelled();
    if (digs >= MAX_DIGS) break;
    if (!(await digSideways(bot, where(), dir))) continue;
    digs++;
    tries++;
    if (await walk(ctx, dir, false)) return completed({ method: 'dig_sideways', tries });
  }
  if (!ctx.signal.aborted && digs < MAX_DIGS && (await digDown(bot, where()))) {
    await bot.waitForTicks(5);
    return completed({ method: 'dig_down', tries: tries + 1 });
  }
  if (ctx.signal.aborted) return cancelled();
  return failed('blocked', 'unstick: no way out found without blocks or a risky fall', { tries });
}

/** The `unstick` verb: see `unstick`. */
export const unstickAction: ActionHandler<'unstick'> = {
  kind: 'unstick',
  timeoutMs: 20_000,
  run: (ctx) => unstick(ctx),
};
