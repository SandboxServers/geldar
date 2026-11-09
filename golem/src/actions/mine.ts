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
/** How many cells a drop falls at most, to the lowest air cell under the broken block. */
const FALL_CELLS = 16;
/** Pickup polls at one world tick each, before timeScale. A drop waits about 10 server ticks. */
const DROP_POLLS = 60;

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

    const before = snapshot(bot);
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
    if (signal.aborted) return abort(bot, mined);

    // The drop falls to the lowest air cell under the block. A walk there can fail (a high block
    // has no standing cell); that is not a failed action: the wait and the inventory say whether
    // the drop arrived.
    const pickup = await moveNear(bot, dropSpot(bot, at), PICKUP_RANGE, {
      signal,
      timeScale: ctx.timeScale,
    });
    if (!pickup.ok && pickup.reason === 'cancelled') return abort(bot, mined);
    await waitForDrop(ctx, bot, block, before);
    if (signal.aborted) return abort(bot, mined);
  }
  return completed({ mined, collected: inventoryDelta(start, snapshot(bot)) });
}

/**
 * Waits for a drop to reach the inventory. Polls once per world tick (`waitForTicks(1)`), at most
 * `60 * timeScale` times, and stops at once when a dropped item name has gained a count.
 */
async function waitForDrop(
  ctx: ActionContext,
  bot: Bot,
  block: Block,
  before: ItemStack[],
): Promise<void> {
  const names = dropNames(bot, block);
  await pollUntil(
    bot,
    ctx.signal,
    () => {
      const gained = inventoryDelta(before, snapshot(bot));
      return names.some((name) => (gained[name] ?? 0) > 0);
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
