import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { hazardReason, unbreakableReason } from './bare-hand.ts';
import type { Block } from './bot-types.ts';
import { feetCell } from './feet-cell.ts';
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

/**
 * What a pillar step reports: `why` names the failed part, `headroom` with the refusal in `refusals`.
 * `unplaced` carries the error text the placement threw, when it threw.
 */
export type PillarResult =
  | { ok: true }
  | {
      ok: false;
      why: 'headroom' | 'entity' | 'unplaced' | 'not_risen' | 'aborted';
      error?: string | undefined;
    };

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

/**
 * Blocks whose right-click opens a screen, rings, toggles or eats. Vanilla uses such a block when a
 * player right-clicks it, unless the player sneaks: a placement against one needs the sneak.
 */
const OPENS_ON_USE = new Set([
  'crafting_table',
  'chest',
  'trapped_chest',
  'ender_chest',
  'furnace',
  'blast_furnace',
  'smoker',
  'barrel',
  'anvil',
  'chipped_anvil',
  'damaged_anvil',
  'enchanting_table',
  'grindstone',
  'loom',
  'cartography_table',
  'fletching_table',
  'smithing_table',
  'stonecutter',
  'lever',
  'note_block',
  'jukebox',
  'dispenser',
  'dropper',
  'hopper',
  'brewing_stand',
  'beacon',
  'bell',
  'cake',
  'respawn_anchor',
]);
/** Names ending in a door, bed, gate, button, sign or box part: each is used on right-click. */
const OPENS_ON_USE_SUFFIX = /(^|_)(bed|door|trapdoor|fence_gate|button|shulker_box|sign)$/;

/** True when a right-click on the block uses it (opens, toggles or eats), so a placement against it needs the sneak. */
export function opensOnUse(name: string): boolean {
  return OPENS_ON_USE.has(name) || OPENS_ON_USE_SUFFIX.test(name);
}

/**
 * Places `face`-ward against `reference`. Holds the sneak for the send when the reference opens on use:
 * the server then places the block instead of using the reference. The sneak is released after, also when
 * the placement throws.
 */
export async function placeAgainst(
  bot: Bot,
  reference: Parameters<Bot['placeBlock']>[0],
  face: Vec3,
): Promise<void> {
  const sneak = opensOnUse(reference.name);
  if (sneak) bot.setControlState('sneak', true);
  try {
    await bot.placeBlock(reference, face);
  } finally {
    if (sneak) bot.setControlState('sneak', false);
  }
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
  const feet = feetCell(bot);
  for (const dy of [2, 3]) {
    const at = feet.offset(0, dy, 0);
    const block = bot.blockAt(at);
    if (passable(block)) continue;
    const refusal = overheadRefusal(bot, feet, at);
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

/**
 * Why the cell `at` above `feet` cannot be cleared for the pillar's jump, or null when it can: air, or a
 * solid block the bare hand may dig. Judged without digging.
 */
function overheadRefusal(bot: Bot, feet: Vec3, at: Vec3): string | null {
  const block = bot.blockAt(at);
  if (passable(block)) return null;
  if (block === null || !solid(block)) return `${block?.name ?? 'unloaded cell'} overhead`;
  const own = [feet, feet.offset(0, 1, 0)];
  return unbreakableReason(block) ?? hazardReason(bot, block, at, own, true);
}

/** True when both cells above `feet` pass the headroom check a pillar from `feet` makes. */
function headroomClear(bot: Bot, feet: Vec3): boolean {
  return [2, 3].every((dy) => overheadRefusal(bot, feet, feet.offset(0, dy, 0)) === null);
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
 * block its hitbox stands on is the nearest), and null when none qualifies. With `needHeadroom`, the cell
 * must also pass `headroomClear`.
 */
export function edgeCell(bot: Bot, feet: Vec3, needHeadroom = false): Vec3 | null {
  const at = bot.entity.position;
  const cells = CARDINAL_STEPS.map((step) => feet.plus(step)).filter(
    (cell) =>
      solid(bot.blockAt(cell.offset(0, -1, 0))) &&
      passable(bot.blockAt(cell)) &&
      passable(bot.blockAt(cell.offset(0, 1, 0))) &&
      !entityInCell(bot, cell) &&
      (!needHeadroom || headroomClear(bot, cell)),
  );
  const gap = (cell: Vec3) => (cell.x + 0.5 - at.x) ** 2 + (cell.z + 0.5 - at.z) ** 2;
  cells.sort((a, b) => gap(a) - gap(b));
  return cells[0] ?? null;
}

/**
 * True when `cell` may be dug for a crowded pillar: solid, not unbreakable, and digging it now is hazard-free
 * (`strictFalling`). `own` are the bot's cells, which do not count as a neighbour.
 */
function sideDiggable(bot: Bot, cell: Vec3, own: readonly Vec3[]): boolean {
  const block = bot.blockAt(cell);
  return (
    block !== null &&
    solid(block) &&
    unbreakableReason(block) === null &&
    hazardReason(bot, block, cell, own, true) === null
  );
}

/**
 * The cell a crowded pillar digs into: a cardinal neighbour of `feet` on solid ground, whose feet and head
 * cells are solid and diggable with no hazard. Of those, the one farthest from the entities sharing the
 * feet cell. Null when none qualifies.
 */
export function sideDigCell(bot: Bot, feet: Vec3): Vec3 | null {
  const own = [feet, feet.offset(0, 1, 0)];
  const crowd = Object.values(bot.entities).filter(
    (entity) => entity !== bot.entity && entityOverlapsCell(entity, feet),
  );
  const away = (cell: Vec3): number =>
    crowd.length === 0
      ? 0
      : Math.min(
          ...crowd.map(
            (entity) =>
              (cell.x + 0.5 - entity.position.x) ** 2 + (cell.z + 0.5 - entity.position.z) ** 2,
          ),
        );
  const cells = CARDINAL_STEPS.map((step) => feet.plus(step)).filter(
    (cell) =>
      solid(bot.blockAt(cell.offset(0, -1, 0))) &&
      sideDiggable(bot, cell, own) &&
      sideDiggable(bot, cell.offset(0, 1, 0), own),
  );
  cells.sort((a, b) => away(b) - away(a));
  return cells[0] ?? null;
}

/**
 * Digs the side cell `cell` for a crowded pillar: its head first, then its feet, each with the best tool or
 * the hand, and each judged again at dig time. False when a gate refuses, a dig throws, or the signal
 * aborts; the caller then keeps the refusal.
 */
export async function digSideCell(
  bot: Bot,
  feet: Vec3,
  cell: Vec3,
  o: PillarOptions,
): Promise<boolean> {
  const b = bot as LooseBot;
  const own = [feet, feet.offset(0, 1, 0)];
  for (const at of [cell.offset(0, 1, 0), cell]) {
    // A superseded pillar takes no second cell: the first dig may have aborted the move.
    if (o.signal.aborted || !sideDiggable(bot, at, own)) return false;
    try {
      const block = bot.blockAt(at) as Block;
      const tool = b.pathfinder?.bestHarvestTool?.(block);
      if (tool) await bot.equip(tool as never, 'hand');
      await bot.dig(block, true);
    } catch (error) {
      o.sink.log(
        JSON.stringify({
          event: 'stall_diag',
          reason: 'pillar_side_dig_failed',
          error: errorText(error),
        }),
      );
      return false;
    }
  }
  return !o.signal.aborted;
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
  if (entityInCell(bot, feetCell(bot))) return { ok: false, why: 'entity' };
  const startY = b.entity.position.y;
  let placed = false;
  let failure: string | undefined;
  try {
    await bot.equip(item as never, 'hand');
    // The cell the bot began in becomes the new floor: place on the block under it once the bot is up.
    const cell = feetCell(bot);
    const ground = bot.blockAt(cell.offset(0, -1, 0));
    // Aim, forced, at the point placeBlock aims at (the top face's centre of the ground block), before the
    // jump. Its own unforced turn to that point can take ~11 ticks, and the placement would go out too late.
    await bot.lookAt(cell.offset(0.5, 0, 0.5), true);
    bot.setControlState('jump', true);
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
          await placeAgainst(bot, ground, new Vec3(0, 1, 0));
          placed = true;
        }
      }
      if (placed && b.entity.position.y - startY >= RISE) break;
    }
  } catch (error) {
    failure = errorText(error);
    o.sink.log(
      JSON.stringify({
        event: 'stall_diag',
        reason: 'escape_pillar_failed',
        error: failure,
      }),
    );
  } finally {
    release(bot);
  }
  if (placed && b.entity.position.y - startY >= RISE) return { ok: true };
  if (o.signal.aborted) return { ok: false, why: 'aborted' };
  if (!placed) return { ok: false, why: 'unplaced', error: failure };
  return { ok: false, why: 'not_risen' };
}
