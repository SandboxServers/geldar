import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Block } from './bot-types.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { lastResortRefused, prefetchOwners, protectedReason } from './protected-blocks.ts';
import type { ActionContext, ActionHandler } from './registry.ts';
import { DEFAULT_DIAG_SINK, emitStallDiag } from './stall-diag.ts';

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

/**
 * Digs one block, with the best tool held when the inventory has one; false on any failure. The
 * pathfinder is halted first (its own tick can stop a dig), and a dig that ends "aborted" is tried
 * once more, since nothing in this call stopped it. Every dig here goes through `protectedReason`
 * first: someone else's work is never dug on the way out (decision 0164).
 */
async function dig(bot: Bot, block: Block, at: Vec3, relaxed = false): Promise<boolean> {
  const protectedBy = protectedReason(bot, block, at);
  if (protectedBy !== null && !(relaxed && !lastResortRefused(bot, block, at))) return false;
  const loose = bot as unknown as {
    pathfinder?: { stop(): void; setGoal(g: null): void; bestHarvestTool?: (b: Block) => unknown };
  };
  loose.pathfinder?.stop();
  loose.pathfinder?.setGoal(null);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const tool = loose.pathfinder?.bestHarvestTool?.(block);
      if (tool) await bot.equip(tool as never, 'hand');
      await bot.dig(block, true);
      // Every block the last-resort pass breaks is logged by name and cell (owner ruling 2026-11-13).
      if (relaxed) {
        DEFAULT_DIAG_SINK.log(
          JSON.stringify({ event: 'unstick_breach', block: block.name, x: at.x, y: at.y, z: at.z }),
        );
      }
      return true;
    } catch (error) {
      const text = errorText(error);
      console.warn(`unstick dig failed: ${text}`);
      if (!/aborted/i.test(text)) return false;
    }
  }
  return false;
}

/** Health the Body keeps after a controlled dig-down. */
const DIG_DOWN_MARGIN = 2;
/** The most blocks one stair-dig step descends, and the most steps one call takes. */
const STAIR_STEP = 1;
const MAX_STAIRS = 4;

/**
 * The controlled dig-down rule (stricter than `dropAllowed` on health, looser on the floor): the Body
 * may dig the one block under its feet when the fall that follows (the dug block plus the drop below)
 * is not into lava, a void or an unloaded column, is within `MAX_DROP`, and costs damage, counted for
 * one block deeper than measured, that leaves `DIG_DOWN_MARGIN` health. At 2 health that allows only a
 * fall of 2 blocks or less; deeper falls are made in one-block stair steps (`digStair`) instead.
 */
export function digDownAllowed(health: number, drop: Drop): boolean {
  if (drop.lands === 'unsafe' || drop.blocks > MAX_DROP) return false;
  return fallDamage(drop.blocks + 1) <= health - DIG_DOWN_MARGIN;
}

/**
 * A cell a dig may take: soft ground always; in the last-resort pass (`relaxed`) also a block that
 * `lastResortRefused` allows (a built block with a known-unowned record).
 */
function digsCell(bot: Bot, block: Block | null, cell: Vec3, relaxed: boolean): boolean {
  if (isSoft(block)) return true;
  return (
    relaxed &&
    block !== null &&
    block.boundingBox !== 'empty' &&
    !lastResortRefused(bot, block, cell)
  );
}

/** Digs the soft block under the feet when the fall that follows is allowed. `elevated` demands a drop below it. */
async function digDown(bot: Bot, feet: Vec3, elevated: boolean, relaxed = false): Promise<boolean> {
  const floor = feet.offset(0, -1, 0);
  const block = bot.blockAt(floor);
  if (block === null || !digsCell(bot, block, floor, relaxed)) return false;
  const below = scanDrop((cell) => bot.blockAt(cell), floor.offset(0, -1, 0));
  if (elevated && below.blocks === 0 && below.lands === 'solid') return false;
  const drop: Drop = { blocks: below.blocks + 1, lands: below.lands };
  if (!digDownAllowed(bot.health ?? 20, drop)) return false;
  return dig(bot, block, floor, relaxed);
}

/**
 * Digs a stair step: the soft blocks at head, feet and one below the feet of a neighbouring column,
 * so the bot walks in and lands `STAIR_STEP` lower. The block under the landing must be solid (not
 * water, lava or a void), or the step is refused.
 */
async function digStair(bot: Bot, feet: Vec3, dir: Vec3, relaxed = false): Promise<boolean> {
  const at = feet.plus(dir);
  const cells = [at.offset(0, 1, 0), at, at.offset(0, -STAIR_STEP, 0)];
  const blocks = cells.map((cell) => ({ cell, block: bot.blockAt(cell) }));
  if (!blocks.every(({ cell, block }) => empty(block) || digsCell(bot, block, cell, relaxed)))
    return false;
  const landing = bot.blockAt(at.offset(0, -STAIR_STEP - 1, 0));
  if (landing === null || landing.boundingBox === 'empty' || HARMFUL.has(landing.name))
    return false;
  if (landing.name === 'water' || landing.name === 'lava') return false;
  for (const { cell, block } of blocks) {
    if (block !== null && block.boundingBox !== 'empty' && !(await dig(bot, block, cell, relaxed)))
      return false;
  }
  return true;
}

/** Digs through the soft block(s) at a neighbour's feet and head cells so the bot can walk there. */
async function digSideways(bot: Bot, feet: Vec3, dir: Vec3, relaxed = false): Promise<boolean> {
  const at = feet.plus(dir);
  const cells = [at.offset(0, 1, 0), at];
  const blocks = cells.map((cell) => ({ cell, block: bot.blockAt(cell) }));
  if (!blocks.every(({ cell, block }) => empty(block) || digsCell(bot, block, cell, relaxed)))
    return false;
  if (!blocks.some(({ cell, block }) => digsCell(bot, block, cell, relaxed))) return false;
  if (
    !dropAllowed(
      bot.health ?? 20,
      scanDrop((cell) => bot.blockAt(cell), at.offset(0, -1, 0)),
    )
  ) {
    return false;
  }
  for (const { cell, block } of blocks) {
    if (block !== null && block.boundingBox !== 'empty' && !(await dig(bot, block, cell, relaxed)))
      return false;
  }
  return true;
}

/**
 * The `no_way_out` diag line, with the steps this call tried. The shared diag line has no field for
 * them, so the line is built by `emitStallDiag` (same snapshot, same rate limit) and gets `tried` added.
 */
function reportNoWayOut(bot: Bot, tried: readonly string[]): void {
  emitStallDiag(
    bot,
    { reason: 'no_way_out' },
    {
      now: () => DEFAULT_DIAG_SINK.now(),
      log: (line) => DEFAULT_DIAG_SINK.log(JSON.stringify({ ...JSON.parse(line), tried })),
    },
  );
}

/** The cells whose ownership the last-resort pass prefetches: the feet and head, and the eight neighbours. */
function escapePoints(feet: Vec3): Vec3[] {
  const ring = EIGHT.map((dir) => feet.plus(dir));
  return [feet, feet.offset(0, 1, 0), ...ring, ...ring.map((cell) => cell.offset(0, 1, 0))];
}

/**
 * The last-resort pass (owner ruling 2026-11-13, decision 0164): the dig strategies once more (sideways,
 * stair, down) with `relaxed` set, so a built block whose record is known unowned may be dug. Only
 * `unstick` calls it, after every other way out failed; `goto` never reaches it. Returns true when a dig
 * freed the bot. `digs` is the count the earlier strategies already spent against `MAX_DIGS`.
 */
async function lastResortDig(
  ctx: ActionContext,
  where: () => Vec3,
  digs: number,
): Promise<boolean> {
  const { bot, signal } = ctx;
  let spent = digs;
  for (const dir of EIGHT.slice(0, 4)) {
    if (signal.aborted || spent >= MAX_DIGS) break;
    if (!(await digSideways(bot, where(), dir, true))) continue;
    spent++;
    if (await walk(ctx, dir, false)) return true;
  }
  for (const dir of EIGHT) {
    if (signal.aborted || spent >= MAX_DIGS) break;
    if (!(await digStair(bot, where(), dir, true))) continue;
    spent++;
    if (await walk(ctx, dir, false)) return true;
  }
  if (!signal.aborted && spent < MAX_DIGS && (await digDown(bot, where(), false, true))) {
    await bot.waitForTicks(5);
    return true;
  }
  return false;
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
  const tried: string[] = [];
  const note = (what: string): void => {
    if (!tried.includes(what)) tried.push(what);
  };
  const done = (method: string): ActionOutcome =>
    completed({ method, tries, tried: [...tried], hint: HINT });
  note('walk');
  for (const move of planMoves((cell) => bot.blockAt(cell), where(), health())) {
    if (ctx.signal.aborted) return cancelled();
    tries++;
    if (await walk(ctx, move.dir, move.jump)) return done(move.drop > 0 ? 'drop' : 'step');
  }
  let digs = 0;
  // Elevated and boxed in (a canopy): get down first, one controlled block or one stair step at a time.
  note('dig_down');
  if (!ctx.signal.aborted && (await digDown(bot, where(), true))) {
    await bot.waitForTicks(5);
    return done('dig_down');
  }
  note('stair_dig');
  for (let step = 0; step < MAX_STAIRS && !ctx.signal.aborted; step++) {
    let stepped = false;
    for (const dir of EIGHT) {
      if (ctx.signal.aborted) return cancelled();
      if (!(await digStair(bot, where(), dir))) continue;
      digs++;
      tries++;
      stepped = await walk(ctx, dir, false);
      if (stepped) break;
    }
    if (!stepped) break;
    await bot.waitForTicks(5);
  }
  if (digs > 0 && !ctx.signal.aborted) return done('stair_dig');
  note('dig_sideways');
  for (const dir of EIGHT.slice(0, 4)) {
    if (ctx.signal.aborted) return cancelled();
    if (digs >= MAX_DIGS) break;
    if (!(await digSideways(bot, where(), dir))) continue;
    digs++;
    tries++;
    if (await walk(ctx, dir, false)) return done('dig_sideways');
  }
  if (!ctx.signal.aborted && digs < MAX_DIGS && (await digDown(bot, where(), false))) {
    await bot.waitForTicks(5);
    tries++;
    return done('dig_down');
  }
  if (ctx.signal.aborted) return cancelled();
  // Last resort (owner ruling 2026-11-13): every other way out failed, so the dig strategies run once more
  // with built blocks of a known-unowned record allowed. The ownership record is prefetched first.
  note('dig_unowned');
  await prefetchOwners(escapePoints(where()), ctx.signal);
  if (ctx.signal.aborted) return cancelled();
  if (await lastResortDig(ctx, where, digs)) return done('dig_unowned');
  reportNoWayOut(bot, tried);
  return failed('blocked', `unstick: no way out found; tried ${tried.join(', ')}`, {
    tries,
    tried,
  });
}

/** Fixed text in every unstick result: what the Mind should do next. */
const HINT = 'you are free; look around and use goto again';

/** The `unstick` verb: see `unstick`. */
export const unstickAction: ActionHandler<'unstick'> = {
  kind: 'unstick',
  timeoutMs: 20_000,
  run: (ctx) => unstick(ctx),
};
