import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import type { Block } from './bot-types.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import {
  digHazard,
  lastResortRefused,
  prefetchOwners,
  protectedReason,
  refusedByName,
} from './protected-blocks.ts';
import type { ActionContext, ActionHandler } from './registry.ts';
import { DEFAULT_DIAG_SINK, emitStallDiag } from './stall-diag.ts';
import {
  type Drop,
  dropAllowed,
  EIGHT,
  empty,
  fallDamage,
  HARMFUL,
  isSoft,
  MAX_DROP,
  planMoves,
  scanDrop,
} from './unstick-plan.ts';
import { ACTION_LIMIT_S, DIG_BUDGET_S, digSeconds, digUp, timeLeftS } from './unstick-up.ts';

export type { Drop, Move } from './unstick-plan.ts';
export {
  dropAllowed,
  EIGHT,
  fallDamage,
  isSoft,
  MAX_DROP,
  MIN_HEALTH_TO_DROP,
  planMoves,
  scanDrop,
} from './unstick-plan.ts';

/** Ticks one move is tried, and the horizontal distance that counts as free. */
const MOVE_TICKS = 24;
const FREE_DISTANCE = 1.5;
/** The most digs one call makes. */
const MAX_DIGS = 6;

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
async function dig(
  bot: Bot,
  signal: AbortSignal,
  block: Block,
  at: Vec3,
  relaxed = false,
): Promise<boolean> {
  if (signal.aborted) return false;
  const protectedBy = protectedReason(bot, block, at);
  if (protectedBy !== null && !(relaxed && !lastResortRefused(bot, block, at))) return false;
  const loose = bot as unknown as {
    pathfinder?: { stop(): void; setGoal(g: null): void; bestHarvestTool?: (b: Block) => unknown };
    stopDigging?: () => void;
  };
  // A cancel stops the dig in progress. Past this point nothing here touches the pathfinder again.
  const onAbort = (): void => loose.stopDigging?.();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    loose.pathfinder?.stop();
    loose.pathfinder?.setGoal(null);
    for (let attempt = 0; attempt < 2 && !signal.aborted; attempt++) {
      try {
        const tool = loose.pathfinder?.bestHarvestTool?.(block);
        if (tool) await bot.equip(tool as never, 'hand');
        if (signal.aborted) return false;
        await bot.dig(block, true);
        // Every block the last-resort pass breaks is logged by name and cell (owner ruling 2026-11-13).
        if (relaxed) {
          DEFAULT_DIAG_SINK.log(
            JSON.stringify({
              event: 'unstick_breach',
              block: block.name,
              x: at.x,
              y: at.y,
              z: at.z,
              dimension: bot.game?.dimension,
            }),
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
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Hand-dig time one step may spend: at most `DIG_BUDGET_S`, and the step must end inside the call's 30 s
 * limit counted from `started` (decision 0210). The walks and digs already spent are not free again.
 */
function digTimeFits(bot: Bot, blocks: readonly (Block | null)[], started: number): boolean {
  const cost = blocks.reduce((sum, block) => sum + digSeconds(bot, block), 0);
  return cost <= DIG_BUDGET_S && cost <= timeLeftS(started);
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

/** A block a bare hand can break: not bedrock, barrier and the like (hardness below zero or unknown). */
function handBreakable(block: Block): boolean {
  const { hardness, diggable } = block as { hardness?: number | null; diggable?: boolean };
  return diggable !== false && typeof hardness === 'number' && hardness >= 0;
}

/** True when a bare hand drops the block itself: no harvest tool is listed for it (dirt, logs, planks). */
function dropsByHand(block: Block): boolean {
  const tools = (block as { harvestTools?: Record<number, boolean> }).harvestTools;
  return !tools || Object.keys(tools).length === 0;
}

/**
 * A cell a dig may take (owner ruling 2026-11-14, decision 0183): soft ground always; any other block a
 * hand can break, unless a refused name, a liquid or a falling block touches it, or it is someone else's
 * work (`protectedReason`). In the last-resort pass (`relaxed`) `lastResortRefused` decides instead.
 */
function digsCell(bot: Bot, block: Block | null, cell: Vec3, relaxed: boolean): boolean {
  if (isSoft(block)) return true;
  if (block === null || block.boundingBox === 'empty' || !handBreakable(block)) return false;
  if (refusedByName(block.name) || digHazard(bot, cell)) return false;
  return relaxed
    ? !lastResortRefused(bot, block, cell)
    : protectedReason(bot, block, cell) === null;
}

/** The directions whose feet and head cells a bare hand drops by hand come first; the rest keep their order. */
function handFirst(bot: Bot, feet: Vec3, dirs: readonly Vec3[]): Vec3[] {
  const needsTool = (dir: Vec3): number => {
    const cells = [feet.plus(dir), feet.plus(dir).offset(0, 1, 0)];
    return cells.some((cell) => {
      const block = bot.blockAt(cell);
      return block !== null && block.boundingBox !== 'empty' && !dropsByHand(block);
    })
      ? 1
      : 0;
  };
  return [...dirs].sort((a, b) => needsTool(a) - needsTool(b));
}

/** Digs the soft block under the feet when the fall that follows is allowed. `elevated` demands a drop below it. */
export async function digDown(
  bot: Bot,
  signal: AbortSignal,
  feet: Vec3,
  elevated: boolean,
  relaxed: boolean,
  started: number,
): Promise<boolean> {
  const floor = feet.offset(0, -1, 0);
  const block = bot.blockAt(floor);
  if (block === null || !digsCell(bot, block, floor, relaxed)) return false;
  const below = scanDrop((cell) => bot.blockAt(cell), floor.offset(0, -1, 0));
  if (elevated && below.blocks === 0 && below.lands === 'solid') return false;
  const drop: Drop = { blocks: below.blocks + 1, lands: below.lands };
  if (!digDownAllowed(bot.health ?? 20, drop)) return false;
  if (!digTimeFits(bot, [block], started)) return false;
  return dig(bot, signal, block, floor, relaxed);
}

/**
 * Digs a stair step: the soft blocks at head, feet and one below the feet of a neighbouring column,
 * so the bot walks in and lands `STAIR_STEP` lower. The block under the landing must be solid (not
 * water, lava or a void), or the step is refused.
 */
export async function digStair(
  bot: Bot,
  signal: AbortSignal,
  feet: Vec3,
  dir: Vec3,
  relaxed: boolean,
  started: number,
): Promise<boolean> {
  const at = feet.plus(dir);
  const cells = [at.offset(0, 1, 0), at, at.offset(0, -STAIR_STEP, 0)];
  const blocks = cells.map((cell) => ({ cell, block: bot.blockAt(cell) }));
  if (!blocks.every(({ cell, block }) => empty(block) || digsCell(bot, block, cell, relaxed)))
    return false;
  if (
    !digTimeFits(
      bot,
      blocks.map(({ block }) => block),
      started,
    )
  )
    return false;
  const landing = bot.blockAt(at.offset(0, -STAIR_STEP - 1, 0));
  if (landing === null || landing.boundingBox === 'empty' || HARMFUL.has(landing.name))
    return false;
  if (landing.name === 'water' || landing.name === 'lava') return false;
  for (const { cell, block } of blocks) {
    if (signal.aborted) return false;
    if (
      block !== null &&
      block.boundingBox !== 'empty' &&
      !(await dig(bot, signal, block, cell, relaxed))
    )
      return false;
  }
  return true;
}

/** Digs through the soft block(s) at a neighbour's feet and head cells so the bot can walk there. */
async function digSideways(
  bot: Bot,
  signal: AbortSignal,
  feet: Vec3,
  dir: Vec3,
  relaxed: boolean,
  started: number,
): Promise<boolean> {
  const at = feet.plus(dir);
  const cells = [at.offset(0, 1, 0), at];
  const blocks = cells.map((cell) => ({ cell, block: bot.blockAt(cell) }));
  if (!blocks.every(({ cell, block }) => empty(block) || digsCell(bot, block, cell, relaxed)))
    return false;
  if (!blocks.some(({ cell, block }) => digsCell(bot, block, cell, relaxed))) return false;
  if (
    !digTimeFits(
      bot,
      blocks.map(({ block }) => block),
      started,
    )
  )
    return false;
  if (
    !dropAllowed(
      bot.health ?? 20,
      scanDrop((cell) => bot.blockAt(cell), at.offset(0, -1, 0)),
    )
  ) {
    return false;
  }
  for (const { cell, block } of blocks) {
    if (signal.aborted) return false;
    if (
      block !== null &&
      block.boundingBox !== 'empty' &&
      !(await dig(bot, signal, block, cell, relaxed))
    )
      return false;
  }
  return true;
}

/**
 * The `no_way_out` diag line, with the steps this call tried, the health, and the drop beside the feet in
 * each of the eight directions (`scanDrop`: blocks fallen and what lands). The shared diag line has no
 * field for them, so the line is built by `emitStallDiag` (same snapshot, same rate limit) and gets them added.
 */
function reportNoWayOut(bot: Bot, tried: readonly string[]): void {
  const feet = bot.entity.position.floored();
  const drops = EIGHT.map((dir) => ({
    dir: [dir.x, dir.z],
    ...scanDrop((cell) => bot.blockAt(cell), feet.plus(dir).offset(0, -1, 0)),
  }));
  emitStallDiag(
    bot,
    { reason: 'no_way_out' },
    {
      now: () => DEFAULT_DIAG_SINK.now(),
      log: (line) =>
        DEFAULT_DIAG_SINK.log(
          JSON.stringify({ ...JSON.parse(line), tried, health: bot.health ?? 20, drops }),
        ),
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
export async function lastResortDig(
  ctx: ActionContext,
  where: () => Vec3,
  digs: number,
  started: number,
): Promise<boolean> {
  const { bot, signal } = ctx;
  let spent = digs;
  for (const dir of handFirst(bot, where(), EIGHT.slice(0, 4))) {
    if (signal.aborted || spent >= MAX_DIGS) break;
    if (!(await digSideways(bot, signal, where(), dir, true, started))) continue;
    spent++;
    if (await walk(ctx, dir, false)) return true;
  }
  for (const dir of handFirst(bot, where(), EIGHT)) {
    if (signal.aborted || spent >= MAX_DIGS) break;
    if (!(await digStair(bot, signal, where(), dir, true, started))) continue;
    spent++;
    if (await walk(ctx, dir, false)) return true;
  }
  if (
    !signal.aborted &&
    spent < MAX_DIGS &&
    (await digDown(bot, signal, where(), false, true, started))
  ) {
    await bot.waitForTicks(5);
    return true;
  }
  return false;
}

/**
 * The call's own deadline in seconds at timeScale 1 (decision 0210 follow-up): the call returns its
 * result this long after it starts, before the 30 s action limit ends it as a bare "timeout". Scaled by
 * the time scale, as the action timeout is.
 */
export const UNSTICK_DEADLINE_S = 25;

/**
 * Gets a stuck bot free, with bare hands and no blocks placed: first walks or jumps in each of the
 * eight directions (including a deliberate drop off a ledge when `dropAllowed`), then digs sideways
 * (four directions) or down through soft blocks. At most `MAX_DIGS` digs and one try per direction.
 * The steps run against the call's deadline: at the deadline, or on a cancel, the steps are aborted
 * and the call returns at once, even if a step is stalled and never ends. A deadline is a failed call;
 * a cancel is cancelled.
 */
export async function unstick(ctx: ActionContext): Promise<ActionOutcome> {
  if (ctx.signal.aborted) return cancelled();
  const started = Date.now();
  const tried: string[] = [];
  const deadline = new AbortController();
  let stopNow: (value: null) => void = () => undefined;
  const stopped = new Promise<null>((resolve) => {
    stopNow = resolve;
  });
  const onStop = (): void => {
    deadline.abort();
    stopNow(null);
  };
  const timer = setTimeout(onStop, UNSTICK_DEADLINE_S * 1000 * ctx.timeScale);
  ctx.signal.addEventListener('abort', onStop, { once: true });
  try {
    const outcome = await Promise.race([
      unstickSteps({ ...ctx, signal: deadline.signal }, started, tried),
      stopped,
    ]);
    if (outcome !== null) return outcome;
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener('abort', onStop);
  }
  if (ctx.signal.aborted) return cancelled();
  return failed(
    'blocked',
    `unstick stopped after ${UNSTICK_DEADLINE_S} s; the way out was not cleared`,
    { tried: [...tried] },
  );
}

/** The steps of one `unstick` call. `tried` is the call's list of steps, shared with `unstick`. */
async function unstickSteps(
  ctx: ActionContext,
  started: number,
  tried: string[],
): Promise<ActionOutcome> {
  const { bot } = ctx;
  const where = (): Vec3 => bot.entity.position.floored();
  const health = (): number => bot.health ?? 20;
  let tries = 0;
  const note = (what: string): void => {
    if (!tried.includes(what)) tried.push(what);
  };
  const done = (method: string): ActionOutcome =>
    completed({ method, tries, tried: [...tried], hint: HINT });
  note('walk');
  for (const move of planMoves((cell) => bot.blockAt(cell), where(), health())) {
    if (ctx.signal.aborted) return cancelled();
    // A walk costs up to 1.2 s of the limit: a walk that cannot end inside it is not started.
    if (timeLeftS(started) < MOVE_TICKS / 20) break;
    tries++;
    if (await walk(ctx, move.dir, move.jump)) return done(move.drop > 0 ? 'drop' : 'step');
  }
  let digs = 0;
  // Elevated and boxed in (a canopy): get down first, one controlled block or one stair step at a time.
  note('dig_down');
  if (!ctx.signal.aborted && (await digDown(bot, ctx.signal, where(), true, false, started))) {
    await bot.waitForTicks(5);
    return done('dig_down');
  }
  note('stair_dig');
  for (let step = 0; step < MAX_STAIRS && !ctx.signal.aborted; step++) {
    let stepped = false;
    for (const dir of handFirst(bot, where(), EIGHT)) {
      if (ctx.signal.aborted) return cancelled();
      if (!(await digStair(bot, ctx.signal, where(), dir, false, started))) continue;
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
  for (const dir of handFirst(bot, where(), EIGHT.slice(0, 4))) {
    if (ctx.signal.aborted) return cancelled();
    if (digs >= MAX_DIGS) break;
    if (!(await digSideways(bot, ctx.signal, where(), dir, false, started))) continue;
    digs++;
    tries++;
    if (await walk(ctx, dir, false)) return done('dig_sideways');
  }
  if (
    !ctx.signal.aborted &&
    digs < MAX_DIGS &&
    (await digDown(bot, ctx.signal, where(), false, false, started))
  ) {
    await bot.waitForTicks(5);
    tries++;
    return done('dig_down');
  }
  if (ctx.signal.aborted) return cancelled();
  // Upward rung (decision 0196): a pit wall is dug through and climbed, before the last resort.
  note('dig_up');
  let upBlocked: string | null = null;
  if (digs < MAX_DIGS) {
    const up = await digUp(bot, ctx.signal, where, EIGHT, started, MAX_DIGS - digs);
    if (ctx.signal.aborted) return cancelled();
    digs += up.dug;
    upBlocked = up.blocked;
    if (up.freed) {
      tries++;
      return completed({ method: 'dig_up', tries, tried: [...tried], hint: HINT, dug: up.dug });
    }
  }
  // Last resort (owner ruling 2026-11-13): every other way out failed, so the dig strategies run once more
  // with built blocks of a known-unowned record allowed. The ownership record is prefetched first.
  note('dig_unowned');
  await prefetchOwners(escapePoints(where()), ctx.signal);
  if (ctx.signal.aborted) return cancelled();
  if (await lastResortDig(ctx, where, digs, started)) return done('dig_unowned');
  reportNoWayOut(bot, tried);
  const upNote = upBlocked === null ? '' : `; dig_up: ${upBlocked}`;
  const spentS = Math.round((Date.now() - started) / 1000);
  const timeNote = `; ${spentS} s of the ${ACTION_LIMIT_S} s limit used`;
  return failed(
    'blocked',
    `unstick: no way out found; tried ${tried.join(', ')}${upNote}${timeNote}`,
    {
      tries,
      tried,
    },
  );
}

/** Fixed text in every unstick result: what the Mind should do next. */
const HINT = 'you are free; look around and use goto again';

/** The `unstick` verb: see `unstick`. */
export const unstickAction: ActionHandler<'unstick'> = {
  kind: 'unstick',
  timeoutMs: ACTION_LIMIT_S * 1000,
  run: (ctx) => unstick(ctx),
};
