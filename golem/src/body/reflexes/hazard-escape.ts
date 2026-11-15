import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { moveNear } from '../../actions/pathing.ts';
import { DEFAULT_DIAG_SINK, type DiagSink } from '../../actions/stall-diag.ts';
import type { Reflex, ReflexContext, ReflexOutcome } from '../reflex.ts';
import { placeFields } from '../where.ts';
import { type BlockReader, HAZARD_FLOORS, isOpenCell } from './hazard-escape-cells.ts';
import { findBreathingColumn, findLateralExit, type LateralExit } from './hazard-escape-lateral.ts';

export type { BlockReader, ScanBlock } from './hazard-escape-cells.ts';
export { findBreathingColumn, findLateralExit, type LateralExit } from './hazard-escape-lateral.ts';

/** Bubbles of air (of 20) at or below which water counts as drowning. */
export const DROWNING_AIR = 8;
/** World ticks the reflex tries before it gives up (10 s at 20 TPS). */
export const ESCAPE_LIMIT_TICKS = 200;
/** How far the search for a safe block reaches, in blocks. */
const SCAN_RADIUS = 8;
/** How far up and down it reaches. */
const SCAN_HEIGHT = 3;
/** Ticks after a give-up in which the reflex stays quiet, so the Mind's next action can run. */
const COOLDOWN_TICKS = 40;
/** The swim-up's share of the time limit; the rest is left for the walk out. */
const SWIM_TICKS = 120;

/** Ticks over which a swim-up must gain height; less than LATERAL_MIN_GAIN blocks in one window is pinned. */
const LATERAL_WINDOW_TICKS = 20;
const LATERAL_MIN_GAIN = 0.3;

/** True when a Body whose feet are in this cell is out of harm: open feet, open head, solid good floor. */
export function isSafeStand(read: BlockReader, x: number, y: number, z: number): boolean {
  if (!isOpenCell(read(x, y, z)) || !isOpenCell(read(x, y + 1, z))) return false;
  const floor = read(x, y - 1, z);
  return floor !== null && floor.boundingBox === 'block' && !HAZARD_FLOORS.has(floor.name);
}

/**
 * The nearest block to stand on within 8 blocks, or null. It is not lava, fire or water, and a
 * water cell over a drop never counts: the floor must be solid and the cell above it open.
 */
export function findSafeBlock(
  read: BlockReader,
  from: { x: number; y: number; z: number },
  radius = SCAN_RADIUS,
): { x: number; y: number; z: number } | null {
  let best: { x: number; y: number; z: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dy = -SCAN_HEIGHT; dy <= SCAN_HEIGHT; dy++) {
        const distance = dx * dx + dz * dz + dy * dy;
        if (distance >= bestDistance) continue;
        if (!isSafeStand(read, from.x + dx, from.y + dy, from.z + dz)) continue;
        best = { x: from.x + dx, y: from.y + dy, z: from.z + dz };
        bestDistance = distance;
      }
    }
  }
  return best;
}

/** What a walk is given: where to go, and how to tell it is over. */
export interface EscapeWalk {
  bot: Bot;
  target: { x: number; y: number; z: number };
  signal: AbortSignal;
  /** The runtime's time scale, for the pathfinder walk. */
  timeScale: number;
  /** True once the time limit has passed. */
  expired(): boolean;
  /** True once the Body stands out of the hazard. */
  reached(): boolean;
  /** Writes one operator line (the lateral fallback engaging or changing target). Optional: a test walk need not set it. */
  note?(fields: Record<string, unknown>): void;
  /** The game tick now. The swim-up's 20-tick window counts these; without it the window counts loop turns. */
  tick?(): number;
}

/** Moves the Body to the target; resolves when it arrived, gave up or was aborted. */
export type EscapeMover = (walk: EscapeWalk) => Promise<void>;

/**
 * The default mover: the pathfinder first (with its corner rule), then straight steering with
 * jump held, which is what swims out of a lava pool the pathfinder will not plan through.
 */
export const walkOutOfHazard: EscapeMover = async (walk) => {
  const { bot, target } = walk;
  const controller = new AbortController();
  const forward = (): void => controller.abort();
  walk.signal.addEventListener('abort', forward, { once: true });
  const watch = setInterval(() => {
    if (walk.expired() || walk.reached()) controller.abort();
  }, 100);
  // The pathfinder does not hold jump, so a Body in water would sink: hold it on every physics tick.
  const holdJump = (): void => {
    if ((bot.entity as unknown as { isInWater?: boolean }).isInWater === true) {
      bot.setControlState('jump', true);
    }
  };
  bot.on('physicsTick', holdJump);
  try {
    await moveNear(bot, target, 1, {
      digTier: false,
      signal: controller.signal,
      timeScale: walk.timeScale,
      stallTicks: 40,
    }).catch(() => undefined);
    const centre = new Vec3(target.x + 0.5, target.y, target.z + 0.5);
    while (!walk.signal.aborted && !walk.expired() && !walk.reached()) {
      // Straight steering ignores the map: stop at a wall or at lava the Body is not already in.
      if (steerBlocked(bot, centre)) break;
      await bot.lookAt(centre, true);
      bot.setControlState('forward', true);
      bot.setControlState('jump', true);
      await bot.waitForTicks(1);
    }
  } finally {
    clearInterval(watch);
    bot.off('physicsTick', holdJump);
    walk.signal.removeEventListener('abort', forward);
    bot.setControlState('forward', false);
    bot.setControlState('jump', false);
  }
};

/** Cells the steering fallback will not walk into unless the Body is already in lava. */
const STEER_AVOID = new Set(['lava', 'fire', 'soul_fire', 'magma_block']);

/** True when one step straight toward `to` runs into a wall at head height or into lava or fire. */
export function steerBlocked(bot: Bot, to: Vec3): boolean {
  const here = bot.entity.position;
  const dx = to.x - here.x;
  const dz = to.z - here.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.01) return false;
  const ahead = here.offset(dx / length, 0, dz / length);
  if (bot.blockAt(ahead.offset(0, 1, 0))?.boundingBox === 'block') return true;
  if ((bot.entity as unknown as Record<string, unknown>).isInLava === true) return false;
  const feet = bot.blockAt(ahead);
  return feet !== null && STEER_AVOID.has(feet.name);
}

/**
 * Swims up with jump held on every physics tick until the Body has air or is out of the water; the
 * way out of deep water with no stand block within range. When a solid block is directly above the
 * head (an undercut bank), it steers to the nearest breathing column, then rises. When the Body
 * gains less than 0.3 blocks in 20 game ticks (pinned under a cap), it swims to the nearest
 * breathable cell through water and air (a lake surface counts), re-picked every window and kept
 * unless another is 2 steps nearer. Between a column and a lateral exit it takes the one with
 * fewer blocks to swim. The target of the walk is not used.
 */
export const swimUp: EscapeMover = async (walk) => {
  const { bot } = walk;
  const read: BlockReader = (x, y, z) => bot.blockAt(new Vec3(x, y, z));
  // Jump is set again on every tick: a handler or the pathfinder may clear it while the Body swims.
  const holdJump = (): void => {
    bot.setControlState('jump', true);
  };
  let steering = false;
  let windowStart = bot.entity.position.y;
  // Loop turns count only when the walk has no game clock; the reflex always gives one.
  let turns = 0;
  const clock = (): number => walk.tick?.() ?? turns;
  let windowTick = clock();
  let sideways: LateralExit | null = null;
  // A window that gains LATERAL_MIN_GAIN keeps the engaged target one more window; the next window decides.
  let keepOneMore = false;
  let noted: { x: number; z: number } | null = null;
  bot.on('physicsTick', holdJump);
  try {
    holdJump();
    while (!walk.signal.aborted && !walk.expired() && !walk.reached()) {
      const here = bot.entity.position;
      if (clock() - windowTick >= LATERAL_WINDOW_TICKS) {
        const gained = here.y - windowStart;
        windowStart = here.y;
        windowTick = clock();
        if (gained < LATERAL_MIN_GAIN) {
          sideways = findLateralExit(read, here, sideways ?? undefined);
          keepOneMore = false;
        } else if (sideways && !keepOneMore) {
          keepOneMore = true;
        } else {
          sideways = null;
          keepOneMore = false;
        }
        if (sideways && (!noted || noted.x !== sideways.x || noted.z !== sideways.z)) {
          walk.note?.({
            event: noted ? 'retarget' : 'engage',
            direction: sideways.direction,
            distance: sideways.distance,
            dy_gained: Math.round(gained * 100) / 100,
          });
          noted = { x: sideways.x, z: sideways.z };
        }
      }
      // A waypoint the Body has stepped into is done; the next one is the next step.
      const waypoint = sideways?.path[0];
      if (
        sideways &&
        waypoint &&
        Math.floor(here.x) === waypoint.x &&
        Math.floor(here.z) === waypoint.z
      ) {
        sideways.path.shift();
      }
      const ceiling = read(Math.floor(here.x), Math.floor(here.y + 1.85), Math.floor(here.z));
      const column = ceiling?.boundingBox === 'block' ? findBreathingColumn(read, here) : null;
      // Both routes are swum at the same speed, so the one with fewer blocks is the faster; a tie keeps the column.
      const lateral = sideways?.path[0] ?? null;
      const columnBlocks = column
        ? Math.hypot(column.x + 0.5 - here.x, column.z + 0.5 - here.z)
        : Number.POSITIVE_INFINITY;
      const lateralBlocks = sideways ? sideways.path.length : Number.POSITIVE_INFINITY;
      const target = lateral && lateralBlocks < columnBlocks ? lateral : column;
      const aim = target ? new Vec3(target.x + 0.5, here.y, target.z + 0.5) : null;
      if (aim) {
        await bot.lookAt(aim, true);
        const wantForward = !steerBlocked(bot, aim);
        if (wantForward !== steering) {
          steering = wantForward;
          bot.setControlState('forward', steering);
        }
      } else if (steering) {
        steering = false;
        bot.setControlState('forward', false);
      }
      await bot.waitForTicks(1);
      turns += 1;
    }
  } finally {
    bot.off('physicsTick', holdJump);
    if (steering) bot.setControlState('forward', false);
    bot.setControlState('jump', false);
  }
};

/** Settings a test may change. */
export interface HazardEscapeOptions {
  limitTicks?: number;
  mover?: EscapeMover;
  /** Used first when the Body is drowning: it swims up until air returns or the head is out. */
  swimmer?: EscapeMover;
  /** Where the oxygen trace lines go (one at the start of a run, one at its end). Default: stdout. */
  diag?: DiagSink;
}

/** True when the cell above the Body's feet holds water or lava. */
function headInLiquid(bot: Bot, feet: { x: number; y: number; z: number }): boolean {
  const head = bot.blockAt(
    new Vec3(Math.floor(feet.x), Math.floor(feet.y) + 1, Math.floor(feet.z)),
  );
  return head?.name === 'water' || head?.name === 'lava';
}

/** The names of the three blocks over the head and the two under the feet, and the nearest open column. */
function surroundings(
  bot: Bot,
  feet: { x: number; y: number; z: number },
): Record<string, unknown> {
  const read: BlockReader = (x, y, z) => bot.blockAt(new Vec3(x, y, z));
  const cx = Math.floor(feet.x);
  const cz = Math.floor(feet.z);
  const base = Math.floor(feet.y);
  const names = (offsets: number[]): Array<string | null> =>
    offsets.map((dy) => read(cx, base + dy, cz)?.name ?? null);
  const exit = findLateralExit(read, feet);
  return {
    above_head: names([2, 3, 4]),
    below_feet: names([-1, -2]),
    nearest_air: exit ? { direction: exit.direction, distance: exit.distance } : null,
  };
}

/** One oxygen trace line: the given fields, then the head's liquid, the water flag and the place. */
function traceLine(ctx: ReflexContext, phase: 'start' | 'end' | 'lateral', fields: object): string {
  const { bot, view } = ctx;
  return JSON.stringify({
    event: 'hazard_escape',
    phase,
    ...fields,
    in_water: view.inFluid === 'water',
    head_liquid: headInLiquid(bot, view.position),
    ...placeFields(view.exactPosition, view.dimension),
  });
}

/**
 * Leaves lava, fire or deep water: it fires while the Body is in lava, on fire outside water, or
 * in water with air at or below 8 bubbles, where it swims up first. It walks to the nearest safe block
 * (air back above 8 counts as out) and gives up after
 * 200 world ticks, raising a `reflex_danger` wake so the Mind hears of it.
 */
export function createHazardEscapeReflex(options: HazardEscapeOptions = {}): Reflex {
  const limitTicks = options.limitTicks ?? ESCAPE_LIMIT_TICKS;
  const mover = options.mover ?? walkOutOfHazard;
  const swimmer = options.swimmer ?? swimUp;
  const diag = options.diag ?? DEFAULT_DIAG_SINK;
  // A trace line that fails must not stop the escape it traces, nor replace its outcome.
  const trace = (line: () => string): void => {
    try {
      diag.log(line());
    } catch {
      // Dropped: the escape matters more than its trace.
    }
  };
  // The tick a give-up opens the quiet window. Cooldown counts from the firing tick, and a run lasts
  // the whole limit, so a cooldown alone lets the reflex fire again the tick it gives up.
  let quietUntil = Number.NEGATIVE_INFINITY;
  const escapeReflex: Reflex = {
    name: 'hazard_escape',
    priority: 90,
    cooldownTicks: COOLDOWN_TICKS,
    check(view) {
      if ((view.tick ?? 0) < quietUntil) return null;
      if (view.inFluid === 'lava') return { hazard: 'lava' };
      if (view.inFluid === 'water' && view.air <= DROWNING_AIR) {
        return { hazard: 'drowning', air: view.air };
      }
      if (view.onFire && view.inFluid !== 'water') return { hazard: 'fire' };
      return null;
    },
    async run(trigger, ctx): Promise<ReflexOutcome> {
      const { bot, view } = ctx;
      const read: BlockReader = (x, y, z) => bot.blockAt(new Vec3(x, y, z));
      const standing = (): boolean => {
        const { x, y, z } = view.position;
        return view.inFluid === null && isOpenCell(read(x, y, z));
      };
      const startTick = view.tick ?? ctx.tick;
      const expired = (): boolean => (view.tick ?? ctx.tick) - startTick >= limitTicks;
      const giveUp = (detail: string): ReflexOutcome => {
        quietUntil = (view.tick ?? ctx.tick) + COOLDOWN_TICKS;
        ctx.sink.wake({ reason: 'reflex_danger', tick: ctx.tick, intentId: null, detail });
        return { result: 'abandoned', detail };
      };

      // Decide first; the running action is cancelled only once the reflex is about to act.
      if (standing() && trigger.hazard === 'fire') {
        return { result: 'abandoned', detail: 'burning, but not standing in a hazard block' };
      }
      const drowning = trigger.hazard === 'drowning';
      const target = findSafeBlock(read, view.position);
      if (!target && !drowning) return giveUp(`no safe block within ${SCAN_RADIUS} blocks`);
      await ctx.cancelAction();
      // Air back above the threshold is out of harm, even while the Body is still in the water.
      const recovered = (): boolean => drowning && view.air > DROWNING_AIR;
      const landed = (): boolean => standing() || recovered();
      const walk = {
        bot,
        signal: ctx.signal,
        timeScale: ctx.timeScale,
        expired,
        reached: landed,
        tick: (): number => view.tick ?? ctx.tick,
      };
      // Drowning always swims up first: with low air the way out is up, not along the bank.
      if (drowning) {
        const surfaced = (): boolean => recovered() || view.inFluid !== 'water';
        // With a safe block in reach the swim gets its share and the walk the rest; with none the swim has all of it.
        const swimLimit = target ? SWIM_TICKS : limitTicks;
        const swimExpired = (): boolean => (view.tick ?? ctx.tick) - startTick >= swimLimit;
        const note = (fields: Record<string, unknown>): void =>
          trace(() => traceLine(ctx, 'lateral', fields));
        await swimmer({
          ...walk,
          target: view.position,
          reached: surfaced,
          expired: swimExpired,
          note,
        });
      }
      if (target && !landed() && !expired()) await mover({ ...walk, target });
      if (landed()) return { result: 'handled', detail: `left ${String(trigger.hazard)}` };
      return giveUp(`still in ${String(trigger.hazard)} after ${limitTicks} ticks`);
    },
  };
  return {
    ...escapeReflex,
    // Two lines per run, at its start and its end, with the air before and after. No periodic line.
    async run(trigger, ctx): Promise<ReflexOutcome> {
      const airBefore = ctx.view.air;
      const mover = trigger.hazard === 'drowning' ? 'swim_up' : 'walk_out';
      trace(() =>
        traceLine(ctx, 'start', {
          hazard: trigger.hazard,
          air_before: airBefore,
          mover,
          ...surroundings(ctx.bot, ctx.view.position),
        }),
      );
      let outcome: ReflexOutcome | undefined;
      try {
        outcome = await escapeReflex.run(trigger, ctx);
        return outcome;
      } finally {
        trace(() =>
          traceLine(ctx, 'end', {
            hazard: trigger.hazard,
            result: outcome?.result ?? 'failed',
            detail: outcome?.detail ?? null,
            air_before: airBefore,
            air_after: ctx.view.air,
          }),
        );
      }
    },
  };
}
