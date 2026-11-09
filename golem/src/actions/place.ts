import { Vec3 } from 'vec3';
import { type ActionOutcome, cancelled, completed, failed } from './outcome.ts';
import { type MoveResult, moveNear } from './pathing.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/** Cells a placement may replace: the target cell must hold one of these. */
const REPLACEABLE = new Set([
  'air',
  'cave_air',
  'void_air',
  'water',
  'short_grass',
  'tall_grass',
  'fern',
  'snow',
]);
/** Farther than this from the target, the bot walks closer first. */
const REACH = 4.5;
/** How close `moveNear` brings the bot to the target. */
const WALK_RANGE = 3;
/** Reference candidates for a block at a position, in the order they are tried. */
const NEIGHBOR_OFFSETS: readonly Vec3[] = [
  new Vec3(0, -1, 0),
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
  new Vec3(0, 1, 0),
];

/** Where the block goes: a position, or `'feet'` for the cell the bot's feet are in (decision 0031). */
type Spot = { x: number; y: number; z: number } | 'feet';

/** Places a block from the inventory, held in the hand, at a position or at the bot's feet. */
export const placeHandler: ActionHandler<'place'> = {
  kind: 'place',
  timeoutMs: 30_000,
  run: (ctx, action) => place(ctx, action.block, action.at),
};

/** The index of the first solid candidate, in the order given; null when none is solid. */
export function pickReference(solid: readonly boolean[]): number | null {
  const index = solid.indexOf(true);
  return index === -1 ? null : index;
}

/** True when the cell now holds `block`, or its wall form (a torch placed on a side face). */
export function confirmsPlacement(name: string, block: string): boolean {
  return name === block || name.replace('wall_', '') === block;
}

async function place(ctx: ActionContext, block: string, at: Spot): Promise<ActionOutcome> {
  const { bot } = ctx;
  const stack = bot.inventory.items().find((item) => item.name === block);
  if (!stack) return failed('missing_materials', `no ${block} in the inventory`);
  const boundingBox = bot.registry.blocksByName[block]?.boundingBox;
  if (boundingBox === undefined) return failed('not_possible', `${block} is not a block`);
  if (at === 'feet' && boundingBox !== 'empty') {
    return failed('blocked', 'target is inside the bot');
  }

  const target = at === 'feet' ? floor(bot.entity.position) : new Vec3(at.x, at.y, at.z);
  const targetCell = bot.blockAt(target);
  if (!targetCell) return failed('not_possible', 'target is not loaded');
  if (!REPLACEABLE.has(targetCell.name)) return failed('blocked', 'target occupied');

  if (bot.entity.position.distanceTo(target) > REACH) {
    const move = await moveNear(bot, target, WALK_RANGE, {
      signal: ctx.signal,
      timeScale: ctx.timeScale,
    });
    if (!move.ok) return moveOutcome(move);
  }
  if (ctx.signal.aborted) return cancelled();

  // The bot's own body is the two cells from its feet up; a colliding block there blocks the placement.
  const body = floor(bot.entity.position);
  for (const dy of [0, 1]) {
    const cell = bot.blockAt(new Vec3(body.x, body.y + dy, body.z));
    if (cell && cell.boundingBox !== 'empty') return failed('blocked', 'target is inside the bot');
  }

  // At `feet` the reference is the block below; otherwise the first solid neighbor in order.
  const candidates =
    at === 'feet'
      ? [target.offset(0, -1, 0)]
      : NEIGHBOR_OFFSETS.map((o) => target.offset(o.x, o.y, o.z));
  const cells = candidates.map((position) => bot.blockAt(position));
  const index = pickReference(cells.map((cell) => cell?.boundingBox === 'block'));
  const reference = index === null ? undefined : cells[index];
  const referencePos = index === null ? undefined : candidates[index];
  if (!reference || !referencePos) return failed('blocked', 'nothing to place against');

  if (bot.heldItem?.name !== block) {
    await bot.equip(stack, 'hand');
    if (ctx.signal.aborted) return cancelled();
  }

  const face = new Vec3(
    target.x - referencePos.x,
    target.y - referencePos.y,
    target.z - referencePos.z,
  );
  try {
    await bot.placeBlock(reference, face);
  } catch (error) {
    const message = errorText(error);
    if (/did not answer the placement|did not fire within timeout/.test(message)) {
      return failed('timeout', message);
    }
    if (/refused to place/.test(message)) return failed('blocked', message);
    throw error;
  }
  if (ctx.signal.aborted) return cancelled();

  // Only the target block is checked: a bed placed here also makes a second block.
  const placed = bot.blockAt(target)?.name ?? '';
  if (!confirmsPlacement(placed, block)) {
    return failed('blocked', `${block} not confirmed at the target, found ${placed || 'nothing'}`);
  }
  return completed({ block, at: spot(target), reference: spot(referencePos) });
}

/** Maps a walk that did not arrive to an outcome. */
function moveOutcome(move: Extract<MoveResult, { ok: false }>): ActionOutcome {
  return move.reason === 'cancelled' ? cancelled() : failed(move.reason, move.message);
}

/** The cell a position is in. */
function floor(position: Vec3): Vec3 {
  return new Vec3(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z));
}

/** A plain position for the outcome detail. */
function spot(position: Vec3): { x: number; y: number; z: number } {
  return { x: position.x, y: position.y, z: position.z };
}

/** The error text, cut to the message limit. */
function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}
