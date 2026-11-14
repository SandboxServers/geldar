import type { Action } from '@geldar/contract';
import { Vec3 } from 'vec3';
import { type ActionOutcome, cancelled, completed, failed } from './outcome.ts';
import { isOwnPlacement } from './own-placements.ts';
import { MESSAGE, reachTarget } from './place.ts';
import { ownerRecordAt } from './protected-blocks.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/** Tillable blocks in vanilla 26.1, with the block each becomes (minecraft-data 3.117 names). */
export const TILLABLE: ReadonlyMap<string, string> = new Map([
  ['dirt', 'farmland'],
  ['grass_block', 'farmland'],
  ['dirt_path', 'farmland'],
  ['coarse_dirt', 'dirt'],
  ['rooted_dirt', 'dirt'],
]);

/** Hoes from the best to the worst; other `_hoe` items come after these, in inventory order. */
const HOE_RANK = [
  'netherite_hoe',
  'diamond_hoe',
  'iron_hoe',
  'copper_hoe',
  'stone_hoe',
  'golden_hoe',
  'wooden_hoe',
];

/** Fixed failure texts for the till: facts only (decision 0154). */
export const TILL_MESSAGE = {
  noHoe: 'no hoe in the inventory',
  notTillable: 'that block cannot be tilled',
  notClear: 'the block above is not clear',
  someoneElses: "that block is someone else's work",
  unchanged: 'the block did not change',
} as const;

/** Ticks the block is watched for the change after the click; the server answers within a few. */
const CONFIRM_TICKS = 5;

/**
 * The `till` verb: walk in reach, look at the top face, click the block with a hoe, and confirm the
 * block changed. Ownership posture: decision 0164 (tilling is not breaking a build; another
 * player's recorded block is refused). The action shape and its receipt: decision 0167.
 */
export const tillAction: ActionHandler<'till'> = {
  kind: 'till',
  timeoutMs: 30_000,
  run: (ctx, action) => till(ctx, action.at),
};

/** The best hoe in the inventory, or undefined when there is none. Ties keep inventory order. */
function bestHoe(items: ReturnType<ActionContext['bot']['inventory']['items']>) {
  const rank = (name: string): number => {
    const at = HOE_RANK.indexOf(name);
    return at === -1 ? HOE_RANK.length : at;
  };
  const hoes = items.filter((item) => item.name.endsWith('_hoe'));
  return [...hoes].sort((a, b) => rank(a.name) - rank(b.name))[0];
}

/** Turns one tillable block into its result: walk in reach, look at its top face, click it with a hoe. */
async function till(
  ctx: ActionContext,
  at: Extract<Action, { do: 'till' }>['at'],
): Promise<ActionOutcome> {
  const { bot } = ctx;
  const hoe = bestHoe(bot.inventory.items());
  if (!hoe) return failed('missing_materials', TILL_MESSAGE.noHoe);
  const target = new Vec3(at.x, at.y, at.z);
  const cell = bot.blockAt(target);
  if (!cell) return failed('not_possible', MESSAGE.notLoaded);
  const result = TILLABLE.get(cell.name);
  if (result === undefined) return failed('not_possible', TILL_MESSAGE.notTillable);
  const above = bot.blockAt(target.offset(0, 1, 0));
  if (!above) return failed('not_possible', MESSAGE.notLoaded);
  if (above.name !== 'air') return failed('not_possible', TILL_MESSAGE.notClear);

  // Someone else's recorded block is refused; the bot's own placements and unknown or natural
  // blocks are allowed (decision 0164: tilling is not breaking a build).
  if (!isOwnPlacement(bot, at)) {
    const record = ownerRecordAt(target);
    if (record?.known && record.owner !== null && record.owner !== bot.username) {
      return failed('not_possible', TILL_MESSAGE.someoneElses);
    }
  }

  const walked = await reachTarget(ctx, target);
  if (walked) return walked;
  if (ctx.signal.aborted) return cancelled();

  if (bot.heldItem?.name !== hoe.name) {
    await bot.equip(hoe, 'hand');
    if (ctx.signal.aborted) return cancelled();
  }
  // The look is sent before the click, and two ticks pass so the server has it.
  await bot.lookAt(target.offset(0.5, 1, 0.5), true);
  await bot.waitForTicks(2);
  if (ctx.signal.aborted) return cancelled();

  await bot.activateBlock(cell, new Vec3(0, 1, 0));
  for (let tick = 0; ; tick++) {
    if (ctx.signal.aborted) return cancelled();
    if (bot.blockAt(target)?.name === result) {
      return completed({ block: result, at: { x: at.x, y: at.y, z: at.z } });
    }
    if (tick >= CONFIRM_TICKS) break;
    await bot.waitForTicks(1);
  }
  return failed('no_effect', TILL_MESSAGE.unchanged);
}
