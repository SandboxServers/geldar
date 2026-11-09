import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { moveNear } from '../../actions/pathing.ts';
import type { Reflex, ReflexOutcome } from '../reflex.ts';

/** A block as the scan reads it: the prismarine fields it needs. */
export interface ScanBlock {
  name: string;
  boundingBox: string;
}

/** Reads one block by coordinates; null when the chunk is not loaded. */
export type BlockReader = (x: number, y: number, z: number) => ScanBlock | null;

/** Blocks the Body must not stand in: they burn, drown, slow or hold it. */
const HAZARD_CELLS = new Set([
  'lava',
  'water',
  'fire',
  'soul_fire',
  'cobweb',
  'powder_snow',
  'sweet_berry_bush',
  'bubble_column',
  'seagrass',
  'tall_seagrass',
  'kelp',
  'kelp_plant',
]);
/** Solid blocks that still hurt to stand on or against. */
const HAZARD_FLOORS = new Set(['magma_block', 'cactus', 'campfire', 'soul_campfire']);

/** Bubbles of air (of 20) at or below which water counts as drowning. */
export const DROWNING_AIR = 8;
/** World ticks the reflex tries before it gives up (10 s at 20 TPS). */
export const ESCAPE_LIMIT_TICKS = 200;
/** How far the search for a safe block reaches, in blocks. */
const SCAN_RADIUS = 8;
/** How far up and down it reaches. */
const SCAN_HEIGHT = 3;
const COOLDOWN_TICKS = 40;

/** True when the Body can stand in this cell: passable and not a hazard. Unloaded is not safe. */
function isOpenCell(block: ScanBlock | null): boolean {
  return block !== null && block.boundingBox === 'empty' && !HAZARD_CELLS.has(block.name);
}

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
  /** True once the time limit has passed. */
  expired(): boolean;
  /** True once the Body stands out of the hazard. */
  reached(): boolean;
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
  try {
    await moveNear(bot, target, 1, {
      signal: controller.signal,
      timeScale: 1,
      stallTicks: 40,
    }).catch(() => undefined);
    const centre = new Vec3(target.x + 0.5, target.y, target.z + 0.5);
    while (!walk.signal.aborted && !walk.expired() && !walk.reached()) {
      await bot.lookAt(centre, true);
      bot.setControlState('forward', true);
      bot.setControlState('jump', true);
      await bot.waitForTicks(1);
    }
  } finally {
    clearInterval(watch);
    walk.signal.removeEventListener('abort', forward);
    bot.setControlState('forward', false);
    bot.setControlState('jump', false);
  }
};

/** Settings a test may change. */
export interface HazardEscapeOptions {
  limitTicks?: number;
  mover?: EscapeMover;
}

/**
 * Leaves lava, fire or deep water: it fires while the Body is in lava, on fire outside water, or
 * in water with air at or below 8 bubbles. It walks to the nearest safe block and gives up after
 * 200 world ticks, raising a `reflex_danger` wake so the Mind hears of it.
 */
export function createHazardEscapeReflex(options: HazardEscapeOptions = {}): Reflex {
  const limitTicks = options.limitTicks ?? ESCAPE_LIMIT_TICKS;
  const mover = options.mover ?? walkOutOfHazard;
  return {
    name: 'hazard_escape',
    priority: 90,
    cooldownTicks: COOLDOWN_TICKS,
    check(view) {
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
        ctx.sink.wake({ reason: 'reflex_danger', tick: ctx.tick, intentId: null, detail });
        return { result: 'abandoned', detail };
      };

      await ctx.cancelAction();
      if (standing() && trigger.hazard === 'fire') {
        return { result: 'abandoned', detail: 'burning, but not standing in a hazard block' };
      }
      const target = findSafeBlock(read, view.position);
      if (!target) return giveUp(`no safe block within ${SCAN_RADIUS} blocks`);
      await mover({ bot, target, signal: ctx.signal, expired, reached: standing });
      if (standing()) return { result: 'handled', detail: `left ${String(trigger.hazard)}` };
      return giveUp(`still in ${String(trigger.hazard)} after ${limitTicks} ticks`);
    },
  };
}
