import type { Action } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import type { Block, Item } from './bot-types.ts';
import { outcomeOfMove } from './move-outcome.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { ensurePathfinder, type MoveResult, moveNear } from './pathing.ts';
import { pollUntil } from './poll.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/** The `mine` action as the contract types it. */
type MineAction = Extract<Action, { do: 'mine' }>;
type FailedMove = Extract<MoveResult, { ok: false }>;
/** The part of an inventory stack that the delta reads. */
export type ItemStack = Pick<Item, 'name' | 'count'>;

/** How far from the bot a block is searched for, in blocks. */
const SEARCH_DISTANCE = 32;
/** How close the bot walks to a block it cannot dig from where it stands. */
const DIG_RANGE = 3;
/** How close the bot walks to a broken block's drop to pick it up: onto its cell, so it is in reach. */
const PICKUP_RANGE = 0;
/** How many walks a drop gets at most: the drop cell, then the neighbour nearest the drop entity. */
const PICKUP_WALKS = 2;
/** How near a drop entity must be to the drop cell for the walk order to follow it, in blocks. */
const DROP_ENTITY_RANGE = 2;
/** How many cells a drop falls at most, to the lowest air cell under the broken block. */
const FALL_CELLS = 16;
/** Pickup polls at one world tick each, before timeScale. A drop waits about 10 server ticks. */
const DROP_POLLS = 60;
/** How far from the broken block a drop entity is looked for, in blocks. */
const DROP_REACH = 3;
/** Player box half-width and height, in blocks. */
const PLAYER_HALF_WIDTH = 0.3;
const PLAYER_HEIGHT = 1.8;
/** The vanilla pickup box grows the player box by 1.0 across and 0.5 up and down. */
const PICKUP_GROW_XZ = 1.0;
const PICKUP_GROW_Y = 0.5;
/** Item entity size, in blocks. */
const ITEM_HALF_WIDTH = 0.125;
const ITEM_HEIGHT = 0.25;
/** Walk-and-nudge rounds for a drop that is still outside the pickup box. */
const PICKUP_ATTEMPTS = 3;
/** Ticks the bot walks straight at a drop it could not reach by path. */
const NUDGE_TICKS = 5;

/** The per-name gain between two inventory snapshots. Only positive differences are kept. */
export function inventoryDelta(before: ItemStack[], after: ItemStack[]): Record<string, number> {
  const totals = (stacks: ItemStack[]): Map<string, number> => {
    const sums = new Map<string, number>();
    for (const stack of stacks) sums.set(stack.name, (sums.get(stack.name) ?? 0) + stack.count);
    return sums;
  };
  const had = totals(before);
  const delta: Record<string, number> = {};
  for (const [name, count] of totals(after)) {
    const gained = count - (had.get(name) ?? 0);
    if (gained > 0) delta[name] = gained;
  }
  return delta;
}

/**
 * Breaks `count` blocks of one kind, nearest first. Finds blocks in loaded chunks (Mineflayer's
 * own world knowledge, not the Mind's snapshot; see 5.2 and wave 4). A block that cannot be
 * reached or dug is never tried again in this action.
 */
async function mineBlocks(ctx: ActionContext, action: MineAction): Promise<ActionOutcome> {
  const { bot, signal } = ctx;
  const info = Object.hasOwn(bot.registry.blocksByName, action.block)
    ? bot.registry.blocksByName[action.block]
    : undefined;
  if (!info) return failed('invalid_args', `unknown block ${action.block}`);
  // `bestHarvestTool` and `stop` need the pathfinder, which only exists after this call.
  ensurePathfinder(bot);
  const wanted = new Set<number>([info.id]);
  const start = snapshot(bot);
  const tried = new Set<string>();
  let mined = 0;
  let lastMined = '';

  while (mined < action.count) {
    if (signal.aborted) return abort(bot, mined);
    const found = bot.findBlocks({
      matching: (block: Block) => wantedAt(wanted, tried, block),
      maxDistance: SEARCH_DISTANCE,
      count: 1,
    });
    const at = found[0];
    if (!at) {
      return failed('not_found', `no ${action.block} within ${SEARCH_DISTANCE} blocks`, { mined });
    }
    tried.add(at.toString());
    // Breaking the block under the feet would drop the bot.
    if (standsOn(bot, at)) return failed('not_possible', 'would drop the bot', { mined });

    // Mineflayer's own dig reach comes first. A block in reach needs no walk, and a high block of
    // a trunk has no standing cell for the pathfinder to walk to.
    const target = bot.blockAt(at);
    if (!(target && bot.canDigBlock(target))) {
      const reach = await moveNear(bot, at, DIG_RANGE, { signal, timeScale: ctx.timeScale });
      if (!reach.ok) return fromMove(bot, reach, mined);
      if (standsOn(bot, at)) return failed('not_possible', 'would drop the bot', { mined });
    }
    if (signal.aborted) return abort(bot, mined);

    const block = bot.blockAt(at);
    if (!block || !wanted.has(block.type)) continue;

    // The fastest tool in the inventory; null when no item helps. A block that needs a tool
    // cannot be harvested without one of the listed tools.
    const tool = bot.pathfinder.bestHarvestTool(block);
    if (block.harvestTools && !block.canHarvest(tool?.type ?? null)) {
      return failed('missing_materials', `needs ${toolNames(bot, block).join(' or ')}`, { mined });
    }
    if (tool) await bot.equip(tool, 'hand');
    if (signal.aborted) return abort(bot, mined);

    // What the inventory had gained when this block broke: its own drop must add to it.
    const baseline = inventoryDelta(start, snapshot(bot));
    let error = await digOnce(bot, block, signal);
    // `canDigBlock` is a distance test only: a block in reach can still be occluded. One walk
    // toward it, then one more dig, is the fix for "not in view".
    if (error !== null && !signal.aborted && /not in view/.test(error)) {
      const reach = await moveNear(bot, at, DIG_RANGE, { signal, timeScale: ctx.timeScale });
      if (!reach.ok) return fromMove(bot, reach, mined);
      if (signal.aborted) return abort(bot, mined);
      if (standsOn(bot, at)) return failed('not_possible', 'would drop the bot', { mined });
      error = await digOnce(bot, block, signal);
    }
    if (error !== null) {
      if (signal.aborted) return abort(bot, mined);
      return failed(digReason(error), error, { mined });
    }
    // The block is broken even if the abort came during the dig, so it counts.
    mined += 1;
    lastMined = block.name;
    if (signal.aborted) return abort(bot, mined);

    // The drop falls to the lowest air cell under the block. A walk there can fail (a high block
    // has no standing cell); that is not a failed action: the wait and the inventory say whether
    // the drop arrived.
    const spot = dropSpot(bot, at);
    const pickup = await walkToDrop(ctx, bot, spot);
    if (!pickup.ok && pickup.reason === 'cancelled') return abort(bot, mined);
    await reachDrop(ctx, bot, spot.offset(0.5, 0.5, 0.5));
    if (signal.aborted) return abort(bot, mined);
    await waitForDrop(ctx, bot, block, start, mined, baseline);
    if (signal.aborted) return abort(bot, mined);
  }
  return completed({
    mined,
    collected: inventoryDelta(start, snapshot(bot)),
    // Fixed text around the game's own block name: the gap can be walked into with goto.
    hint: `you mined ${lastMined}; the space is open`,
  });
}

/**
 * Waits for the drops of `mined` blocks to reach the inventory. Polls once per world tick
 * (`waitForTicks(1)`), at most `60 * timeScale` times, and stops at once when a dropped item name
 * has gained at least `mined` since the start of the action and at least one more than at the
 * block's break (`baseline`, for blocks that drop several items). The count is cumulative: a drop
 * of an earlier block that arrives late cannot end the wait for this one.
 */
async function waitForDrop(
  ctx: ActionContext,
  bot: Bot,
  block: Block,
  start: ItemStack[],
  mined: number,
  baseline: Record<string, number>,
): Promise<void> {
  const names = dropNames(bot, block);
  await pollUntil(
    bot,
    ctx.signal,
    () => {
      const gained = inventoryDelta(start, snapshot(bot));
      // A block that drops several items must add at least one beyond what was there at its break.
      return names.some(
        (name) => (gained[name] ?? 0) >= Math.max(mined, (baseline[name] ?? 0) + 1),
      );
    },
    { polls: Math.ceil(DROP_POLLS * ctx.timeScale) },
  );
}

/** The item names a block drops. A drop entry is an item ID, or a rule that holds one. */
function dropNames(bot: Bot, block: Block): string[] {
  const names: string[] = [];
  for (const entry of block.drops ?? []) {
    if (typeof entry === 'number') {
      const name = bot.registry.items[entry]?.name;
      if (name) names.push(name);
      continue;
    }
    const id = typeof entry.drop === 'number' ? entry.drop : entry.drop.id;
    const name = bot.registry.items[id]?.name;
    if (name) names.push(name);
  }
  return names;
}

/** The names of the tools a block accepts, from its harvest tool IDs. */
function toolNames(bot: Bot, block: Block): string[] {
  return Object.keys(block.harvestTools ?? {}).map(
    (id) => bot.registry.items[Number(id)]?.name ?? id,
  );
}

/**
 * One dig of `block`. Resolves to the rejection message, or null when the block was broken.
 * `stopDigging` ends a dig already in progress, so an abort during the dig takes effect.
 */
async function digOnce(bot: Bot, block: Block, signal: AbortSignal): Promise<string | null> {
  const stopDig = (): void => bot.stopDigging();
  signal.addEventListener('abort', stopDig, { once: true });
  try {
    await bot.dig(block);
    return null;
  } catch (error) {
    return errorText(error);
  } finally {
    signal.removeEventListener('abort', stopDig);
  }
}

/** Maps a dig rejection to a failure reason. Only the messages Mineflayer uses are matched. */
function digReason(message: string): 'interrupted' | 'not_possible' | 'blocked' | 'internal' {
  if (/aborted/.test(message)) return 'interrupted';
  if (/Infinity/.test(message)) return 'not_possible';
  if (/not in view/.test(message)) return 'blocked';
  return 'internal';
}

/**
 * The `findBlocks` matcher. Mineflayer first probes each chunk palette with position-less blocks
 * (`position` is null), which must be answered on the type alone; cells carry their position.
 */
function wantedAt(wanted: Set<number>, tried: Set<string>, block: Block): boolean {
  if (!wanted.has(block.type)) return false;
  const at = block.position as Vec3 | null;
  return !at || !tried.has(at.toString());
}

/** Whether the bot stands on the block at `at`: breaking it would drop the bot. */
function standsOn(bot: Bot, at: Vec3): boolean {
  return at.equals(bot.entity.position.floored().offset(0, -1, 0));
}

/** The lowest air cell under `at`, where a drop from the block at `at` falls to. */
function dropSpot(bot: Bot, at: Vec3): Vec3 {
  let spot = at;
  for (let step = 0; step < FALL_CELLS; step++) {
    const below = bot.blockAt(spot.offset(0, -1, 0));
    if (below?.boundingBox !== 'empty') break;
    spot = spot.offset(0, -1, 0);
  }
  return spot;
}

/**
 * Walks the bot to a drop so it can pick it up. The drop cell comes first. A cell with a block
 * above it cannot be stood on, so that walk can fail; the next walk aims at a neighbour cell, the
 * one nearest the drop entity. Stops at the first walk that arrives, or at `PICKUP_WALKS`.
 */
async function walkToDrop(ctx: ActionContext, bot: Bot, spot: Vec3): Promise<MoveResult> {
  let result: MoveResult = { ok: true, distance: 0 };
  for (const cell of pickupCells(bot, spot).slice(0, PICKUP_WALKS)) {
    result = await moveNear(bot, cell, PICKUP_RANGE, {
      signal: ctx.signal,
      timeScale: ctx.timeScale,
    });
    if (result.ok || result.reason === 'cancelled') break;
  }
  return result;
}

/**
 * Brings the bot into the pickup box of the drop near `at` (the centre of the cell the drop falls
 * to), when the walks did
 * not. The item can land a cell away from the cell the walk aimed at, so it is looked up again in
 * each round. A round walks onto the item's cell (the walk can fail when a block is above that
 * cell), then walks straight at the item for a few ticks. Ends when the item is gone or in the box,
 * or after `PICKUP_ATTEMPTS` rounds. Whether the item arrived is for `waitForDrop` and the inventory.
 */
async function reachDrop(ctx: ActionContext, bot: Bot, at: Vec3): Promise<void> {
  const { signal } = ctx;
  for (let round = 0; round < PICKUP_ATTEMPTS; round++) {
    const drop = nearestDrop(bot, at);
    if (!drop || inPickupBox(bot.entity.position, drop.position) || signal.aborted) return;
    const cell = drop.position.floored();
    if (!bot.entity.position.floored().equals(cell)) {
      const walk = await moveNear(bot, cell, PICKUP_RANGE, { signal, timeScale: ctx.timeScale });
      if (!walk.ok && walk.reason === 'cancelled') return;
    }
    const latest = nearestDrop(bot, at);
    if (!latest || inPickupBox(bot.entity.position, latest.position)) continue;
    void bot.lookAt(latest.position).catch(() => undefined);
    bot.setControlState('forward', true);
    try {
      await bot.waitForTicks(Math.ceil(NUDGE_TICKS * ctx.timeScale));
    } finally {
      bot.setControlState('forward', false);
    }
  }
}

/** The item entity nearest the point `at` within `DROP_REACH`, if any. */
function nearestDrop(bot: Bot, at: Vec3): { position: Vec3 } | undefined {
  let best: { position: Vec3 } | undefined;
  let bestDistance = DROP_REACH;
  for (const entity of Object.values(bot.entities)) {
    if (entity.name !== 'item') continue;
    const distance = entity.position.distanceTo(at);
    if (distance < bestDistance) {
      best = entity;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Whether the player at `player` (feet position) can pick up an item at `item`: the item's box must
 * meet the player's box grown by the pickup inflation. An item 1.43 blocks from the centre of the
 * player's cell is out of reach, though the cell is next to it.
 */
function inPickupBox(player: Vec3, item: Vec3): boolean {
  const reach = PLAYER_HALF_WIDTH + PICKUP_GROW_XZ + ITEM_HALF_WIDTH;
  if (Math.abs(player.x - item.x) > reach || Math.abs(player.z - item.z) > reach) return false;
  const low = player.y - PICKUP_GROW_Y;
  const high = player.y + PLAYER_HEIGHT + PICKUP_GROW_Y;
  return item.y + ITEM_HEIGHT >= low && item.y <= high;
}

/**
 * The cells a drop walk may aim at: the drop cell, then its four horizontal neighbours. When an
 * item entity lies near the drop cell, the cells are ordered nearest that entity first.
 */
function pickupCells(bot: Bot, spot: Vec3): Vec3[] {
  const cells = [
    spot,
    spot.offset(1, 0, 0),
    spot.offset(-1, 0, 0),
    spot.offset(0, 0, 1),
    spot.offset(0, 0, -1),
  ];
  const drop = Object.values(bot.entities).find(
    (entity) => entity.name === 'item' && entity.position.distanceTo(spot) < DROP_ENTITY_RANGE,
  );
  if (!drop) return cells;
  // Horizontal distance from the drop entity to the centre of a cell.
  const gap = (cell: Vec3): number =>
    Math.hypot(cell.x + 0.5 - drop.position.x, cell.z + 0.5 - drop.position.z);
  return cells.sort((a, b) => gap(a) - gap(b));
}

/** The current inventory as plain stacks. */
function snapshot(bot: Bot): ItemStack[] {
  return bot.inventory.items().map((item) => ({ name: item.name, count: item.count }));
}

/** Stops digging and walking, then ends the action as cancelled. */
function abort(bot: Bot, mined: number): ActionOutcome {
  bot.stopDigging();
  bot.pathfinder.stop();
  // `stop()` alone defers to the next path reset (see haltPathing in pathing.ts); setGoal(null) clears it.
  bot.pathfinder.setGoal(null);
  return cancelled({ mined });
}

/** Turns a failed move into the action's failure, keeping the blocks broken so far. */
function fromMove(bot: Bot, move: FailedMove, mined: number): ActionOutcome {
  if (move.reason === 'cancelled') return abort(bot, mined);
  return outcomeOfMove(move, { mined });
}

/** The `mine` handler: breaks `count` blocks and reports what the inventory gained. */
export const mineAction: ActionHandler<'mine'> = {
  kind: 'mine',
  timeoutMs: 180_000,
  run: mineBlocks,
};
