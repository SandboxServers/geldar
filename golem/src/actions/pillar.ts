import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { hazardReason, unbreakableReason } from './bare-hand.ts';
import type { Block } from './bot-types.ts';
import { errorText } from './outcome.ts';
import type { DiagSink } from './stall-diag.ts';

/** Ticks a pillar's jump is given to rise and place the block. */
const PILLAR_TICKS = 20;
/** The pillar places once the feet are this far above the start: the box has left the new block's cell. */
const PILLAR_CLEAR = 1.0;
/** A pillar worked when the bot ends this far above its start, on the placed block. */
const RISE = 0.9;
/** Overlap no deeper than this does not count: flush contact is not a collision. */
const EPSILON = 1e-3;
/** Box of an entity that reports no size: a player's. */
const DEFAULT_WIDTH = 0.6;
const DEFAULT_HEIGHT = 1.8;

export type LooseBot = Bot & {
  entity: { position: Vec3; isInWater?: boolean; height?: number; onGround?: boolean };
  pathfinder?: {
    bestHarvestTool?: (block: Block) => unknown;
    stop(): void;
    setGoal(g: null): void;
  };
};

/** What a pillar step reports: `why` names the failed part, `headroom` with the refusal in `refusals`. */
export type PillarResult =
  | { ok: true }
  | { ok: false; why: 'headroom' | 'entity' | 'unplaced' | 'not_risen' | 'aborted' };

export interface PillarOptions {
  signal: AbortSignal;
  sink: DiagSink;
}

/** True when the block is a full solid cube. */
export const solid = (block: Block | null): boolean =>
  block !== null && block.boundingBox === 'block';
/** True when the block is open to a body, and not lava. */
export const passable = (block: Block | null): boolean =>
  block !== null && block.boundingBox === 'empty' && block.name !== 'lava';

/** Stops the movement controls a rung may hold. */
export function release(bot: Bot): void {
  for (const control of ['forward', 'jump', 'sprint'] as const) bot.setControlState(control, false);
}

/** The first inventory item that is a placeable block, by registry name. */
export function heldBlock(bot: Bot): unknown {
  return bot.inventory.items().find((item) => {
    const info = bot.registry.blocksByName[item.name];
    return info !== undefined && info.boundingBox === 'block' && info.diggable !== false;
  });
}

/**
 * True when the entity's box (its width centred on its position, from its feet up to its height)
 * overlaps the unit cube of `cell` by more than `EPSILON` on every axis.
 */
export function entityOverlapsCell(
  entity: { position: Vec3; width?: number; height?: number },
  cell: Vec3,
): boolean {
  const half = (entity.width ?? DEFAULT_WIDTH) / 2;
  const height = entity.height ?? DEFAULT_HEIGHT;
  const p = entity.position;
  return (
    p.x - half < cell.x + 1 - EPSILON &&
    p.x + half > cell.x + EPSILON &&
    p.z - half < cell.z + 1 - EPSILON &&
    p.z + half > cell.z + EPSILON &&
    p.y < cell.y + 1 - EPSILON &&
    p.y + height > cell.y + EPSILON
  );
}

/** True when another entity's box overlaps the cell (the bot's own box does not count). */
export function entityInCell(bot: Bot, cell: Vec3): boolean {
  return Object.values(bot.entities).some(
    (entity) => entity !== bot.entity && entityOverlapsCell(entity, cell),
  );
}

/**
 * Makes the two cells above the bot's head free for the pillar's jump: air passes, and a solid block
 * the bare hand may dig is dug first. Anything else (unbreakable, hazardous, lava) is refused with a
 * reason that names the headroom, and the jump is not tried.
 */
async function clearHeadroom(bot: Bot, o: PillarOptions, refusals: string[]): Promise<boolean> {
  const b = bot as LooseBot;
  const feet = b.entity.position.floored();
  const own = [feet, feet.offset(0, 1, 0)];
  for (const dy of [2, 3]) {
    const at = feet.offset(0, dy, 0);
    const block = bot.blockAt(at);
    if (passable(block)) continue;
    const refusal =
      block === null || !solid(block)
        ? `${block?.name ?? 'unloaded cell'} overhead`
        : (unbreakableReason(block) ?? hazardReason(bot, block, at, own, true));
    if (refusal) {
      refusals.push(`no headroom for a pillar: ${refusal}`);
      return false;
    }
    // A superseded ladder takes no second cell: the first dig may have aborted the move.
    if (o.signal.aborted) return false;
    try {
      const tool = b.pathfinder?.bestHarvestTool?.(block as Block);
      if (tool) await bot.equip(tool as never, 'hand');
      await bot.dig(block as Block, true);
    } catch (error) {
      refusals.push(`no headroom for a pillar: ${errorText(error)}`);
      return false;
    }
  }
  if (o.signal.aborted) return false;
  return true;
}

/** The four horizontal steps, in a fixed order. */
const CARDINAL_STEPS: readonly Vec3[] = [
  new Vec3(1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, -1),
];

/**
 * The cell beside the feet cell that a pillar can rise from: solid under it, open and passable with
 * the cell above it free, and no other entity in it. The nearest to the bot's position wins (the
 * block its hitbox stands on is the nearest), and null when none qualifies.
 */
export function edgeCell(bot: Bot, feet: Vec3): Vec3 | null {
  const at = bot.entity.position;
  const cells = CARDINAL_STEPS.map((step) => feet.plus(step)).filter(
    (cell) =>
      solid(bot.blockAt(cell.offset(0, -1, 0))) &&
      passable(bot.blockAt(cell)) &&
      passable(bot.blockAt(cell.offset(0, 1, 0))) &&
      !entityInCell(bot, cell),
  );
  const gap = (cell: Vec3) => (cell.x + 0.5 - at.x) ** 2 + (cell.z + 0.5 - at.z) ** 2;
  cells.sort((a, b) => gap(a) - gap(b));
  return cells[0] ?? null;
}

/**
 * Jumps and places `item` under the feet, then reports whether the bot ended higher than it began
 * and the block went down. The block is placed only once the feet are a full block up (`PILLAR_CLEAR`):
 * earlier the bot's own box still fills the cell and the server refuses the placement. The caller
 * checks the cell below is solid and that the bot stands on the ground.
 */
export async function pillarStep(
  bot: Bot,
  item: unknown,
  o: PillarOptions,
  refusals: string[],
): Promise<PillarResult> {
  const b = bot as LooseBot;
  if (!(await clearHeadroom(bot, o, refusals))) {
    return { ok: false, why: o.signal.aborted ? 'aborted' : 'headroom' };
  }
  // Another entity's box in the cell the block goes into would refuse the placement.
  if (entityInCell(bot, b.entity.position.floored())) return { ok: false, why: 'entity' };
  const startY = b.entity.position.y;
  let placed = false;
  try {
    await bot.equip(item as never, 'hand');
    await bot.lookAt(b.entity.position.offset(0, -1, 0), true);
    bot.setControlState('jump', true);
    // The cell the bot began in becomes the new floor: place on the block under it once the bot is up.
    const cell = b.entity.position.floored();
    const ground = bot.blockAt(cell.offset(0, -1, 0));
    for (let i = 0; i < PILLAR_TICKS && !o.signal.aborted; i++) {
      await bot.waitForTicks(1);
      if (
        !placed &&
        !o.signal.aborted &&
        b.entity.position.y - startY >= PILLAR_CLEAR &&
        ground &&
        solid(ground)
      ) {
        if (passable(bot.blockAt(cell))) {
          await bot.placeBlock(ground, new Vec3(0, 1, 0));
          placed = true;
        }
      }
      if (placed && b.entity.position.y - startY >= RISE) break;
    }
  } catch (error) {
    o.sink.log(
      JSON.stringify({
        event: 'stall_diag',
        reason: 'escape_pillar_failed',
        error: errorText(error),
      }),
    );
  } finally {
    release(bot);
  }
  if (placed && b.entity.position.y - startY >= RISE) return { ok: true };
  if (o.signal.aborted) return { ok: false, why: 'aborted' };
  return { ok: false, why: placed ? 'not_risen' : 'unplaced' };
}
