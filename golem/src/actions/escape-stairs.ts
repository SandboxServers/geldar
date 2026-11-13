import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { digTicks, hazardReason, unbreakableReason } from './bare-hand.ts';
import type { Block } from './bot-types.ts';
import { feetCell } from './feet-cell.ts';
import { errorText } from './outcome.ts';
import { isDoorLike } from './path-doors.ts';
import { protectedReason } from './protected-blocks.ts';
import type { DiagSink } from './stall-diag.ts';

/** Steps (one block of height each) a staircase climbs at most. */
export const MAX_STAIR_STEPS = 12;
/** A pit wall must stand this many blocks above the bot's feet cell to count as a pit wall. */
const WALL_HEIGHT = 2;
/** Ticks one climbing hop may take. */
const HOP_TICKS = 20;
/** A hop worked when the bot rose this far. */
const RISE = 0.9;

const DIRS: readonly Vec3[] = [
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
];

type StairBot = Bot & {
  entity: { position: Vec3 };
  pathfinder?: { bestHarvestTool?: (block: Block) => unknown };
};

interface StairOptions {
  signal: AbortSignal;
  toward: { x: number; z: number };
  sink: DiagSink;
}

/** A solid block that is a wall for the climb. A door or a fence gate is not: the bot walks through it. */
const solid = (block: Block | null): boolean =>
  block !== null && block.boundingBox === 'block' && !isDoorLike(block);

/** Solid cells stacked above `cell` (inclusive), up to `WALL_HEIGHT` + 1. */
function wallHeight(bot: Bot, cell: Vec3): number {
  let n = 0;
  while (n <= WALL_HEIGHT && solid(bot.blockAt(cell.offset(0, n, 0)))) n++;
  return n;
}

const open = (block: Block | null): boolean =>
  block !== null && block.boundingBox === 'empty' && block.name !== 'lava';

/**
 * A neighbour cell the bot can jump onto: solid at feet level with two free cells above it. This is
 * the jump-up half of `nearestLedge` (escape-ladder.ts). A floor one block lower is not a way up.
 */
function jumpLedge(bot: Bot, cell: Vec3): boolean {
  const above = bot.blockAt(cell.offset(0, 1, 0));
  return (
    solid(bot.blockAt(cell)) &&
    (open(above) || above?.name === 'water') &&
    open(bot.blockAt(cell.offset(0, 2, 0)))
  );
}

/**
 * True when the bot stands on solid ground in a pit: at least one side is a pit wall (`WALL_HEIGHT`
 * solid blocks high) and no side is a ledge the jump rung can use. The floor beside the bot may be
 * flat and open: a flat-floored cavity is still a pit. Open ground with no wall is not. Standing in
 * air (no solid ground under the feet) is not a pit.
 */
export function inPit(bot: Bot): boolean {
  const feet = feetCell(bot);
  if (!solid(bot.blockAt(feet.offset(0, -1, 0)))) return false;
  if (!DIRS.some((d) => wallHeight(bot, feet.plus(d)) >= WALL_HEIGHT)) return false;
  return DIRS.every((d) => !jumpLedge(bot, feet.plus(d)));
}

/** The wall to dig into: the side facing the goal when it is a wall, else the first wall. */
function pickDirection(from: Vec3, toward: { x: number; z: number }): Vec3 {
  const dx = toward.x - from.x;
  const dz = toward.z - from.z;
  const ordered =
    Math.abs(dx) >= Math.abs(dz)
      ? [new Vec3(Math.sign(dx) || 1, 0, 0), new Vec3(0, 0, Math.sign(dz) || 1)]
      : [new Vec3(0, 0, Math.sign(dz)), new Vec3(Math.sign(dx) || 1, 0, 0)];
  return ordered[0] ?? DIRS[0] ?? new Vec3(1, 0, 0);
}

function log(o: StairOptions, fields: Record<string, unknown>): void {
  o.sink.log(JSON.stringify({ event: 'stall_diag', reason: 'escape_stairs', ...fields }));
}

/**
 * One-wide staircase out of a pit. Each step clears the two cells above the wall block next to the
 * bot (the block itself stays as the stair), then hops onto it: one block of height per two digs.
 * Every dig is checked for water, lava and falling blocks first; a refusal is pushed on `refusals`
 * with its plain-word reason and the climb stops. True when the bot ends at least a block higher.
 */
export async function stairs(bot: Bot, o: StairOptions, refusals: string[]): Promise<boolean> {
  const b = bot as StairBot;
  if (!inPit(bot)) return false;
  const startY = b.entity.position.y;
  const first = feetCell(bot);
  let dir = pickDirection(b.entity.position, o.toward);
  if (wallHeight(bot, first.plus(dir)) < WALL_HEIGHT) {
    dir = DIRS.find((d) => wallHeight(bot, first.plus(d)) >= WALL_HEIGHT) ?? dir;
  }
  for (let step = 1; step <= MAX_STAIR_STEPS && !o.signal.aborted; step++) {
    const feet = feetCell(bot);
    const stand = feet.plus(dir);
    if (!solid(bot.blockAt(stand))) break;
    const own = [feet, feet.offset(0, 1, 0)];
    let dug = 0;
    for (const dy of [1, 2]) {
      const at = stand.offset(0, dy, 0);
      const target = bot.blockAt(at);
      if (!solid(target) || target === null) continue;
      const refusal =
        unbreakableReason(target) ??
        hazardReason(bot, target, at, own, true) ??
        protectedReason(bot, target, at);
      if (refusal) {
        refusals.push(refusal);
        log(o, { step, stopped: 'refused', refusal });
        return b.entity.position.y - startY >= RISE;
      }
      // A superseded ladder digs no second cell and no further tool.
      if (o.signal.aborted) return b.entity.position.y - startY >= RISE;
      try {
        const tool = b.pathfinder?.bestHarvestTool?.(target);
        if (tool) await bot.equip(tool as never, 'hand');
        await bot.dig(target, true);
        dug++;
      } catch (error) {
        log(o, { step, stopped: 'dig_failed', error: errorText(error) });
        return b.entity.position.y - startY >= RISE;
      }
    }
    log(o, {
      step,
      dug,
      y: b.entity.position.y,
      dig_ticks: digTicks(bot, bot.blockAt(stand) as Block),
    });
    const before = b.entity.position.y;
    await bot.lookAt(b.entity.position.offset(dir.x * 4, 1.62, dir.z * 4), true);
    try {
      bot.setControlState('forward', true);
      bot.setControlState('jump', true);
      for (let i = 0; i < HOP_TICKS && !o.signal.aborted; i++) {
        await bot.waitForTicks(1);
        if (b.entity.position.y - before >= RISE) break;
      }
    } finally {
      for (const c of ['forward', 'jump'] as const) bot.setControlState(c, false);
    }
    if (b.entity.position.y - before < RISE) {
      log(o, { step, stopped: 'no_rise' });
      break;
    }
  }
  return b.entity.position.y - startY >= RISE;
}
