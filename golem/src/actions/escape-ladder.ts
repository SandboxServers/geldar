import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { hazardReason, unbreakableReason } from './bare-hand.ts';
import { inPit, stairs } from './escape-stairs.ts';
import { errorText } from './outcome.ts';
import { heldBlock, type LooseBot, passable, pillarStep, release, solid } from './pillar.ts';
import type { DiagSink } from './stall-diag.ts';

/** The rungs of the hard-stuck ladder, in the only order they run. */
export type Rung = 'water_exit' | 'jump' | 'sprint_jump' | 'dig' | 'stairs' | 'pillar';

/** Ticks a rung is given to show movement. */
const RUNG_TICKS = 20;
/** A rung worked when the bot ended this far (blocks, horizontal) from where it began. */
const FREE_DISTANCE = 1.2;
/** Ticks the swim-up of the water exit may take. */
const SWIM_TICKS = 40;

/** What a finished ladder reports. `refusal` names a block the dig rung would not take, and why. */
export type LadderResult =
  | { ok: true; rung: Rung }
  | { ok: false; reason: 'needs_rescue'; message: string; refusal?: string };

interface LadderOptions {
  signal: AbortSignal;
  toward: { x: number; z: number };
  sink: DiagSink;
}

const horizontal = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);

/** True when the bot stands in water (the entity flag, or water in its feet cell). */
export function inWater(bot: Bot): boolean {
  const b = bot as LooseBot;
  if (b.entity.isInWater === true) return true;
  if (typeof b.blockAt !== 'function') return false;
  return b.blockAt(b.entity.position.floored())?.name === 'water';
}

/** The axis step toward `toward`, larger axis first. */
function stepToward(from: Vec3, toward: { x: number; z: number }): Vec3 {
  const dx = toward.x - from.x;
  const dz = toward.z - from.z;
  if (Math.abs(dx) >= Math.abs(dz)) return new Vec3(Math.sign(dx) || 1, 0, 0);
  return new Vec3(0, 0, Math.sign(dz));
}

/** The nearest horizontal neighbour (feet cell side) that is solid with two free cells above it. */
export function nearestLedge(bot: Bot): Vec3 | null {
  const feet = (bot as LooseBot).entity.position.floored();
  let best: Vec3 | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    for (const dy of [0, -1]) {
      const stand = feet.offset(dx, dy, dz);
      if (!solid(bot.blockAt(stand))) continue;
      if (
        !passable(bot.blockAt(stand.offset(0, 1, 0))) &&
        bot.blockAt(stand.offset(0, 1, 0))?.name !== 'water'
      )
        continue;
      if (!passable(bot.blockAt(stand.offset(0, 2, 0)))) continue;
      const score = Math.abs(dy) + 0.1 * (Math.abs(dx) + Math.abs(dz));
      if (score < bestScore) {
        best = stand;
        bestScore = score;
      }
    }
  }
  return best;
}

async function ticks(
  bot: Bot,
  n: number,
  signal: AbortSignal,
  stop?: () => boolean,
): Promise<void> {
  for (let i = 0; i < n && !signal.aborted; i++) {
    await bot.waitForTicks(1);
    if (stop?.()) return;
  }
}

async function lookHorizontal(bot: Bot, dir: Vec3): Promise<void> {
  const at = (bot as LooseBot).entity.position;
  await bot.lookAt(at.offset(dir.x * 4, 1.62, dir.z * 4), true);
}

/** Holds jump to swim up, then jumps toward the nearest solid block with two free cells above. */
async function waterExit(bot: Bot, o: LadderOptions): Promise<boolean> {
  const start = (bot as LooseBot).entity.position.clone();
  try {
    bot.setControlState('jump', true);
    await ticks(bot, SWIM_TICKS, o.signal, () => !inWater(bot));
    const ledge = nearestLedge(bot);
    const dir = ledge
      ? new Vec3(Math.sign(ledge.x + 0.5 - start.x), 0, Math.sign(ledge.z + 0.5 - start.z))
      : stepToward(start, o.toward);
    await lookHorizontal(bot, dir);
    bot.setControlState('forward', true);
    await ticks(bot, RUNG_TICKS, o.signal, () => !inWater(bot) && moved(bot, start));
  } finally {
    release(bot);
  }
  return !inWater(bot) && moved(bot, start);
}

function moved(bot: Bot, start: Vec3): boolean {
  return horizontal((bot as LooseBot).entity.position, start) >= FREE_DISTANCE;
}

/** Jump in place, or sprint-jump toward the goal; true when the bot moved. */
async function hop(bot: Bot, o: LadderOptions, sprint: boolean): Promise<boolean> {
  const start = (bot as LooseBot).entity.position.clone();
  try {
    if (sprint) {
      await lookHorizontal(bot, stepToward(start, o.toward));
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
    }
    bot.setControlState('jump', true);
    await ticks(bot, RUNG_TICKS, o.signal, () => moved(bot, start));
  } finally {
    release(bot);
  }
  return moved(bot, start);
}

/**
 * Digs the block in front (feet then head level) toward the goal, with the best tool or bare hands.
 * Any breakable block may be dug by hand (slowly, with no drop); only an unbreakable block or a
 * dangerous one (water, lava or a falling block behind it) is refused, with the reason.
 */
async function digAhead(bot: Bot, o: LadderOptions, refusals: string[]): Promise<boolean> {
  const b = bot as LooseBot;
  // A tunnel out of a pit does not climb, and ruins the wall the stairs would use: stairs go next.
  if (inPit(bot)) return false;
  const start = b.entity.position.clone();
  const feet = start.floored();
  const dir = stepToward(start, o.toward);
  for (const dy of [0, 1]) {
    const block = bot.blockAt(feet.plus(dir).offset(0, dy, 0));
    if (!solid(block) || block === null) continue;
    const tool = b.pathfinder?.bestHarvestTool?.(block);
    const at = feet.plus(dir).offset(0, dy, 0);
    const refusal =
      unbreakableReason(block) ?? hazardReason(bot, block, at, [feet, feet.offset(0, 1, 0)], false);
    if (refusal) {
      refusals.push(refusal);
      return false;
    }
    // A superseded ladder (its move aborted) takes no more blocks.
    if (o.signal.aborted) return false;
    try {
      if (tool) await bot.equip(tool as never, 'hand');
      await bot.dig(block, true);
    } catch (error) {
      o.sink.log(
        JSON.stringify({
          event: 'stall_diag',
          reason: 'escape_dig_failed',
          error: errorText(error),
        }),
      );
      return false;
    }
  }
  await lookHorizontal(bot, dir);
  try {
    bot.setControlState('forward', true);
    await ticks(bot, RUNG_TICKS, o.signal, () => moved(bot, start));
  } finally {
    release(bot);
  }
  return moved(bot, start);
}

/** The pillar rung: places the first held block under the feet, true when the bot rose onto it. */
async function pillar(bot: Bot, o: LadderOptions, refusals: string[]): Promise<boolean> {
  const item = heldBlock(bot);
  if (!item) return false;
  return (await pillarStep(bot, item, o, refusals)).ok;
}

/** Fixed text of the last-resort outcome: facts only. */
export function rescueMessage(tried: readonly Rung[]): string {
  return `no way out: tried ${tried.join(', ')}`;
}

/**
 * The hard-stuck ladder. In water it first swims up and jumps to the nearest ledge; then, strictly
 * in order, jump, sprint-jump toward the goal, dig the adjacent block toward the goal, and place a
 * held block under the feet. Each rung logs one `stall_diag` line (never rate-limited). Returns the
 * rung that freed the bot, or `needs_rescue` when all fail.
 */
export async function escapeLadder(bot: Bot, o: LadderOptions): Promise<LadderResult> {
  const b = bot as LooseBot;
  b.pathfinder?.stop();
  b.pathfinder?.setGoal(null);
  const tried: Rung[] = [];
  const refusals: string[] = [];
  const rungs: Array<[Rung, () => Promise<boolean>]> = [
    ['jump', () => hop(bot, o, false)],
    ['sprint_jump', () => hop(bot, o, true)],
    ['dig', () => digAhead(bot, o, refusals)],
    ['stairs', () => stairs(bot, o, refusals)],
    ['pillar', () => pillar(bot, o, refusals)],
  ];
  if (inWater(bot)) rungs.unshift(['water_exit', () => waterExit(bot, o)]);
  for (const [rung, run] of rungs) {
    if (o.signal.aborted) break;
    tried.push(rung);
    const worked = await run();
    o.sink.log(
      JSON.stringify({
        event: 'stall_diag',
        reason: 'escape_ladder',
        rung,
        worked,
        in_water: inWater(bot),
        ...(refusals.length > 0 && (rung === 'dig' || rung === 'stairs' || rung === 'pillar')
          ? { refusal: refusals[refusals.length - 1] }
          : {}),
      }),
    );
    if (worked) return { ok: true, rung };
  }
  const refusal = refusals[0];
  return {
    ok: false,
    reason: 'needs_rescue',
    message: rescueMessage(tried),
    ...(refusal ? { refusal } : {}),
  };
}
