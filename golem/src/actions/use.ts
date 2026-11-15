import type { Action } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { type ActionOutcome, cancelled, completed, failed, type JsonValue } from './outcome.ts';
import { isOwnPlacement } from './own-placements.ts';
import { MESSAGE, reachTarget, SEED_CROPS } from './place.ts';
import { ownerRecordAt, prefetchOwners } from './protected-blocks.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/** Ticks the block is watched for the change after the click; the server answers within a few. */
const CONFIRM_TICKS = 5;

/** Crops that bone meal grows (vanilla 26.1). Stems and the other crops are left out. */
const GROWABLE: ReadonlySet<string> = new Set(['wheat', 'carrots', 'potatoes', 'beetroots']);

/** Blocks with a window: `use` on them is refused, and they keep their own verbs (decision 0218). */
const WINDOW_BLOCK =
  /(chest|barrel|furnace|smoker|hopper|dispenser|dropper|shulker_box|anvil|enchanting_table|lectern|brewing_stand|crafting_table|cartography_table|smithing_table|loom|grindstone|stonecutter|beacon)$/;
/** Beds: sleeping is the `sleep` verb. */
const BED_BLOCK = /(^|_)bed$/;
/** Signs: standing, wall and hanging signs all end in `_sign`; they are edited with `edit_sign`. */
const SIGN_BLOCK = /_sign$/;
/** Redstone that changes a build when used, and is not on the list of `use` targets (decision 0218). */
const BUILD_REDSTONE: ReadonlySet<string> = new Set([
  'repeater',
  'comparator',
  'note_block',
  'daylight_detector',
  'target',
]);
/** Doors, fence gates, trapdoors and buttons: any player may use them, on a build of another player too. */
const OPEN_TO_ALL = /(^|_)door$|_trapdoor$|_fence_gate$|_button$/;

/**
 * Fixed texts for the use: facts only (decision 0154). A refused block is named by its class, so the
 * text states what the block is and never points at another verb (decisions 0058, 0059, 0068).
 */
export const USE_MESSAGE = {
  notYet: 'use is not available',
  both: 'use takes a block or an entity, not both',
  entityNotYet: 'use on an entity is not available',
  noTarget: 'use needs a block position',
  noItem: 'no such item in the inventory',
  container: 'that block is a container',
  bed: 'that block is a bed',
  sign: 'that block is a sign',
  redstone: 'that block is a redstone device',
  notUsable: 'that block cannot be used that way',
  someoneElses: "that block is someone else's work",
  notClear: 'the block above is not clear',
  unchanged: 'the block did not change',
} as const;

/** The three shapes `use` takes once the target is checked: a door-like block, sowing, or bone meal. */
type UseMode = 'activate' | 'sow' | 'grow';

type Cell = NonNullable<ReturnType<Bot['blockAt']>>;

/**
 * The `use` verb: walk in reach, look at the block, click it with the item in hand, and confirm the
 * block changed. Doors, fence gates, trapdoors, non-iron buttons and levers are activated; seeds are
 * sown on farmland; bone meal grows a crop. Ownership is decision 0164 and 0218: another player's
 * recorded block is refused, except the blocks anyone may use. The action shape: decision 0218.
 */
export function useHandler(enabled: boolean): ActionHandler<'use'> {
  return {
    kind: 'use',
    timeoutMs: 30_000,
    run: (ctx, action: Extract<Action, { do: 'use' }>) =>
      enabled ? use(ctx, action) : Promise.resolve(failed('not_possible', USE_MESSAGE.notYet)),
  };
}

/** The handler as the registry holds it by default: the shard flag is off, so the verb is refused. */
export const useAction = useHandler(false);

/** The refusal for a block a `use` never touches, or undefined when the block may be used. */
export function refusalFor(name: string): string | undefined {
  if (WINDOW_BLOCK.test(name)) return USE_MESSAGE.container;
  if (BED_BLOCK.test(name)) return USE_MESSAGE.bed;
  if (SIGN_BLOCK.test(name)) return USE_MESSAGE.sign;
  if (BUILD_REDSTONE.has(name)) return USE_MESSAGE.redstone;
  return undefined;
}

/** True for a door, gate, trapdoor or button that is not iron (iron ones need redstone). */
export function isOpenToAll(name: string): boolean {
  return !name.startsWith('iron_') && OPEN_TO_ALL.test(name);
}

/** What the click does to this block with this item, or undefined when the pair is not a `use`. */
export function modeOf(name: string, item: string | null): UseMode | undefined {
  if (isOpenToAll(name) || name === 'lever') return 'activate';
  if (name === 'farmland' && item !== null && SEED_CROPS.has(item)) return 'sow';
  if (item === 'bone_meal' && GROWABLE.has(name)) return 'grow';
  return undefined;
}

/** A value that changes when the block changes state (a door opening, a crop growing). */
function stateKey(block: Cell | null | undefined): string | null {
  if (!block) return null;
  return `${block.name}:${(block as { stateId?: number }).stateId ?? ''}`;
}

/** The `open` property of a door-like block, as a word, or undefined when the block has none. */
function openWord(block: Cell | null | undefined): 'open' | 'closed' | undefined {
  const read = (block as { getProperties?: () => Record<string, unknown> } | null | undefined)
    ?.getProperties;
  const props = read?.call(block);
  if (typeof props?.open !== 'boolean') return undefined;
  return props.open ? 'open' : 'closed';
}

/** Whether the block the `use` checks now differs from the block it was before the click. */
function hasChanged(bot: Bot, mode: UseMode, target: Vec3, before: string | null, sown?: string) {
  if (mode === 'sow') return bot.blockAt(target.offset(0, 1, 0))?.name === sown;
  return stateKey(bot.blockAt(target)) !== before;
}

/** The item the `use` puts in hand, if the hand does not hold it already; `missing` when it is not carried. */
function itemToHold(
  bot: Bot,
  item: string | undefined,
): { stack: ReturnType<Bot['inventory']['items']>[number] | null; missing: boolean } {
  if (item === undefined || bot.heldItem?.name === item) return { stack: null, missing: false };
  const stack = bot.inventory.items().find((stack) => stack.name === item) ?? null;
  return { stack, missing: stack === null };
}

/** Turns one `use` into its result. Every `await` checks the signal. */
async function use(
  ctx: ActionContext,
  action: Extract<Action, { do: 'use' }>,
): Promise<ActionOutcome> {
  const { bot, signal } = ctx;
  if (action.at !== undefined && action.entity !== undefined) {
    return failed('invalid_args', USE_MESSAGE.both);
  }
  if (action.entity !== undefined) return failed('not_possible', USE_MESSAGE.entityNotYet);
  if (action.at === undefined) return failed('not_possible', USE_MESSAGE.noTarget);

  const target = new Vec3(action.at.x, action.at.y, action.at.z);
  const cell = bot.blockAt(target);
  if (!cell) return failed('not_possible', MESSAGE.notLoaded);
  const refused = refusalFor(cell.name);
  if (refused !== undefined) return failed('not_possible', refused);

  const held = action.item ?? bot.heldItem?.name ?? null;
  const mode = modeOf(cell.name, held);
  if (mode === undefined) return failed('not_possible', USE_MESSAGE.notUsable);
  const { stack, missing } = itemToHold(bot, action.item);
  if (missing) return failed('missing_materials', USE_MESSAGE.noItem);

  // Someone else's recorded block is refused unless anyone may use it (owner rulings, 0218). The
  // owner record is fetched first, so a cold cache does not answer before the chunk is read.
  if (!isOpenToAll(cell.name)) {
    await prefetchOwners([target], signal);
    if (signal.aborted) return cancelled();
    if (!isOwnPlacement(bot, target)) {
      const record = ownerRecordAt(target);
      if (record?.known && record.owner !== null && record.owner !== bot.username) {
        return failed('not_possible', USE_MESSAGE.someoneElses);
      }
    }
  }

  const walked = await reachTarget(ctx, target);
  if (walked) return walked;
  if (signal.aborted) return cancelled();
  if (mode === 'sow' && bot.blockAt(target.offset(0, 1, 0))?.name !== 'air') {
    return failed('not_possible', USE_MESSAGE.notClear);
  }

  if (stack) {
    await bot.equip(stack, 'hand');
    if (signal.aborted) return cancelled();
  }
  // The look is sent before the click, and two ticks pass so the server has it. Sowing and bone
  // meal click the top face; a door, lever or button is clicked at its centre.
  const top = mode === 'activate' ? 0.5 : 1;
  await bot.lookAt(target.offset(0.5, top, 0.5), true);
  await bot.waitForTicks(2);
  if (signal.aborted) return cancelled();

  const before = stateKey(cell);
  const sown = mode === 'sow' ? SEED_CROPS.get(held ?? '') : undefined;
  await bot.activateBlock(cell, new Vec3(0, 1, 0));
  for (let tick = 0; ; tick++) {
    if (signal.aborted) return cancelled();
    if (hasChanged(bot, mode, target, before, sown)) {
      const at = mode === 'sow' ? target.offset(0, 1, 0) : target;
      const state = openWord(bot.blockAt(target));
      const detail: Record<string, JsonValue> = {
        block: sown ?? cell.name,
        at: { x: at.x, y: at.y, z: at.z },
      };
      if (state !== undefined) detail.state = state;
      return completed(detail);
    }
    if (tick >= CONFIRM_TICKS) break;
    await bot.waitForTicks(1);
  }
  return failed('not_possible', USE_MESSAGE.unchanged);
}
