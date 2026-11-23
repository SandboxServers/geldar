import type { Action } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { BUILDING_REFUSAL } from '../building/names.ts';
import { unbreakableReason } from './bare-hand.ts';
import type { Block } from './bot-types.ts';
import { type ItemStack, inventoryDelta } from './mine.ts';
import { cellOf, MINE_CELL_MESSAGE } from './mine-cell.ts';
import { outcomeOfMove } from './move-outcome.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { ensurePathfinder, moveNear } from './pathing.ts';
import { pollUntil } from './poll.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/** The `break` action as the contract types it. */
type BreakAction = Extract<Action, { do: 'break' }>;

/** How close the bot walks to a cell it cannot dig from where it stands, in blocks. */
const DIG_RANGE = 3;
/** How close the bot walks to the broken cell to pick up its drop: onto the cell, so it is in reach. */
const PICKUP_RANGE = 0;
/** Pickup polls at one world tick each, before timeScale. A drop waits about 10 server ticks. */
const DROP_POLLS = 60;
/** The air state id. A broken cell reads as this. */
const AIR = 0;

/**
 * The `break` handler (decision 0421). Digs exactly the named cell or fails with the reason. No
 * ownership gate (0420) and no dig-safety refusal (0428): lava, a falling column or a liquid next
 * to the cell does not stop the dig. Refused with the neutral message while the flag is off.
 */
export function breakHandler(enabled: boolean): ActionHandler<'break'> {
  return {
    kind: 'break',
    timeoutMs: 120_000,
    run: async (ctx, action) => {
      if (!enabled) return failed('not_possible', BUILDING_REFUSAL);
      return breakCell(ctx, action);
    },
  };
}

/** Walks within reach of the cell, digs it, checks it is air, then walks onto it and waits for the drop. */
async function breakCell(ctx: ActionContext, action: BreakAction): Promise<ActionOutcome> {
  const { bot, signal, timeScale } = ctx;
  const cell = cellOf(action.at);
  if (cell === null) return failed('invalid_args', MINE_CELL_MESSAGE.notWhole);
  // `bestHarvestTool` needs the pathfinder, which only exists after this call.
  ensurePathfinder(bot);
  const first = bot.blockAt(cell);
  if (!first) return failed('not_possible', MINE_CELL_MESSAGE.notLoaded);
  if (first.type === AIR) return failed('not_found', 'that block is air');
  const refusal = unbreakableReason(first);
  if (refusal) return failed('not_possible', refusal);

  if (!bot.canDigBlock(first)) {
    const walk = await moveNear(bot, cell, DIG_RANGE, { signal, timeScale });
    if (!walk.ok) return walk.reason === 'cancelled' ? abort(bot) : outcomeOfMove(walk, {});
  }
  if (signal.aborted) return abort(bot);

  // The walk may have changed the cell: the dig uses what it holds now, and only that cell.
  const block = bot.blockAt(cell);
  if (!block) return failed('not_possible', MINE_CELL_MESSAGE.notLoaded);
  if (block.type === AIR) return failed('not_found', 'that block is air');
  if (!bot.canDigBlock(block)) return failed('out_of_reach', MINE_CELL_MESSAGE.outOfReach);

  const tool = bot.pathfinder.bestHarvestTool(block);
  if (tool) await bot.equip(tool, 'hand');
  if (signal.aborted) return abort(bot);

  const start = snapshot(bot);
  const error = await digOnce(bot, block, signal);
  if (error !== null) {
    if (signal.aborted) return abort(bot);
    return failed(digReason(error), error);
  }
  if (signal.aborted) return abort(bot);

  // The cell must be air now; a dig that reported success but left a block is a failure.
  const after = bot.blockAt(cell);
  if (!after || after.type !== AIR) {
    return failed('no_effect', `the cell still holds ${after?.name ?? 'an unloaded block'}`);
  }

  // Walk onto the broken cell so the drop is in reach. A walk that fails is not a failed break:
  // the wait and the inventory say whether the drop arrived.
  const pickup = await moveNear(bot, cell, PICKUP_RANGE, { signal, timeScale });
  if (!pickup.ok && pickup.reason === 'cancelled') return abort(bot);
  await pollUntil(bot, signal, () => gained(start, bot), {
    polls: Math.ceil(DROP_POLLS * timeScale),
  });
  if (signal.aborted) return abort(bot);
  return completed({
    broken: block.name ?? 'block',
    collected: inventoryDelta(start, snapshot(bot)),
  });
}

/** One dig of `block`. Resolves to the rejection message, or null when the block was broken. */
async function digOnce(bot: Bot, block: Block, signal: AbortSignal): Promise<string | null> {
  const stopDig = (): void => bot.stopDigging();
  signal.addEventListener('abort', stopDig, { once: true });
  try {
    await bot.dig(block);
    return null;
  } catch (caught) {
    return errorText(caught);
  } finally {
    signal.removeEventListener('abort', stopDig);
  }
}

/** Maps a dig rejection to a failure reason. Only the messages Mineflayer uses are matched. */
function digReason(message: string): 'blocked' | 'not_possible' | 'internal' {
  if (/Infinity/.test(message)) return 'not_possible';
  if (/not in view/.test(message)) return 'blocked';
  return 'internal';
}

/** Whether anything was gained since `start`: the drop has reached the inventory. */
function gained(start: ItemStack[], bot: Bot): boolean {
  return Object.keys(inventoryDelta(start, snapshot(bot))).length > 0;
}

/** The current inventory as plain stacks. */
function snapshot(bot: Bot): ItemStack[] {
  return bot.inventory.items().map((item) => ({ name: item.name, count: item.count }));
}

/** Stops digging and walking, then ends the action as cancelled. */
function abort(bot: Bot): ActionOutcome {
  bot.stopDigging();
  bot.pathfinder.stop();
  // `stop()` alone defers to the next path reset (see haltPathing in pathing.ts); setGoal(null) clears it.
  bot.pathfinder.setGoal(null);
  return cancelled();
}

/** The handler as the registry holds it by default: the flag is off. */
export const breakAction = breakHandler(false);
