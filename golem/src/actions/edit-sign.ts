import type { EventEmitter } from 'node:events';
import type { Action } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { isOwnPlacement } from './own-placements.ts';
import { MESSAGE, reachTarget } from './place.ts';
import { pollUntil } from './poll.ts';
import { ownerRecordAt, prefetchOwners } from './protected-blocks.ts';
import type { ActionContext, ActionHandler } from './registry.ts';
import { wrapSignText } from './sign-text.ts';

/** Wall-clock wait for the server to open the sign editor, at a TPS of 20 (scaled by `timeScale`). */
const OPEN_WAIT_MS = 3000;
/** Ticks the sign is watched for the new text after the update is sent. */
const READBACK_TICKS = 10;
/** Ticks to wait after the look, so the server has the new facing before the click. */
const LOOK_TICKS = 2;
/** Item that does nothing when used on a sign; the fallback when the hand cannot be emptied. */
const NEUTRAL_ITEM = 'stick';
/** Mineflayer slots that hold the hotbar and the main inventory (the armour and crafting slots are not room). */
const STORAGE_FROM = 9;
const STORAGE_TO = 45;

/** Fixed texts for the edit: facts only (decision 0154). */
export const EDIT_SIGN_MESSAGE = {
  empty: 'the sign text is empty',
  notSign: 'that block is not a sign',
  someoneElses: "that block is someone else's work",
  waxed: 'that sign is waxed',
  handBusy: 'the hand could not be cleared for the sign',
  noRoom: 'no room in the inventory to empty the hand',
  notYet: 'that block cannot be edited yet',
  notOpened: 'the sign did not open for editing',
  unchanged: 'the sign did not change',
} as const;

/** The sign block names: standing, wall, hanging and wall hanging signs all end in `_sign`. */
const SIGN_BLOCK = /_sign$/;

/** A block entity as prismarine-block returns it; `is_waxed` is the server key, `isWaxed` the library's. */
interface SignEntity {
  is_waxed?: unknown;
  isWaxed?: unknown;
}

/** The raw `open_sign_entity` packet: which side of the sign the server opened for editing. */
interface OpenSignPacket {
  location: { x: number; y: number; z: number };
  isFrontText: boolean;
}

/** What clearing the hand did: whether the hand is free for the click, and which item was put away. */
interface HandClearance {
  ok: boolean;
  emptied: string | null;
  /** The fixed text for the refusal when `ok` is false. */
  refusal: string | null;
}

/**
 * The `edit_sign` verb: walk in reach, empty the hand, look at the sign, click it so the server
 * opens the editor, write the wrapped text on the side it opened, and read the text back.
 * Ownership is decision 0164 (another player's recorded block is refused; the system owner counts
 * as another player). The action shape and its reasons: decision 0192.
 */
export function editSignHandler(enabled: boolean): ActionHandler<'edit_sign'> {
  return {
    kind: 'edit_sign',
    timeoutMs: 15_000,
    run: (ctx, action: Extract<Action, { do: 'edit_sign' }>) =>
      enabled
        ? editSign(ctx, action)
        : Promise.resolve(failed('not_possible', EDIT_SIGN_MESSAGE.notYet)),
  };
}

/** The handler as the registry holds it by default: the shard flag is off, so the verb is refused. */
export const editSignAction = editSignHandler(false);

/** True when the block entity says the sign is waxed; the server keeps the flag in the entity. */
function isWaxed(entity: unknown): boolean {
  if (typeof entity !== 'object' || entity === null) return false;
  const { is_waxed: flag, isWaxed: alias } = entity as SignEntity;
  return Boolean(flag ?? alias);
}

/** True when the hotbar or the main inventory has an empty slot to put the held item into. */
function hasRoomToEmptyHand(bot: Bot): boolean {
  return bot.inventory.slots.slice(STORAGE_FROM, STORAGE_TO).some((slot) => !slot);
}

/**
 * Empties the hand so the click edits the sign rather than acting on a held item. The hand is only
 * unequipped when the inventory has room, since mineflayer tosses the stack on the ground when it
 * has none. Otherwise the stick fallback is used; if there is no stick the hand stays as it is.
 */
async function clearHand(bot: Bot): Promise<HandClearance> {
  const held = bot.heldItem;
  if (!held) return { ok: true, emptied: null, refusal: null };
  const room = hasRoomToEmptyHand(bot);
  if (room) {
    await bot.unequip('hand');
    if (!bot.heldItem) return { ok: true, emptied: held.name, refusal: null };
  }
  const neutral = bot.inventory.items().find((item) => item.name === NEUTRAL_ITEM);
  if (!neutral) {
    return {
      ok: false,
      emptied: null,
      refusal: room ? EDIT_SIGN_MESSAGE.handBusy : EDIT_SIGN_MESSAGE.noRoom,
    };
  }
  await bot.equip(neutral, 'hand');
  return { ok: true, emptied: null, refusal: null };
}

/** Puts back the item `clearHand` emptied from the hand, when the hand is free and the item is still held. */
async function restoreHand(bot: Bot, name: string | null): Promise<void> {
  if (name === null || bot.heldItem) return;
  const item = bot.inventory.items().find((stack) => stack.name === name);
  if (item) await bot.equip(item, 'hand');
}

/**
 * Listens on the raw client for the editor the server opens at `target`. The returned record holds
 * the side the packet names (`isFrontText`) once it arrives; `dispose` removes the listener.
 */
function watchSignOpen(
  bot: Bot,
  target: Vec3,
): { opened: { front: boolean } | null; dispose(): void } {
  const client = bot._client as unknown as EventEmitter;
  const watch: { opened: { front: boolean } | null; dispose(): void } = {
    opened: null,
    dispose: () => client.off('open_sign_entity', onOpen),
  };
  const onOpen = (packet: OpenSignPacket): void => {
    const at = packet.location;
    if (at.x === target.x && at.y === target.y && at.z === target.z) {
      watch.opened = { front: packet.isFrontText };
    }
  };
  client.on('open_sign_entity', onOpen);
  return watch;
}

/** The text on one side of the sign, lines joined by newlines, or null when the block is gone. */
function signTextOn(bot: Bot, target: Vec3, front: boolean): string | null {
  const block = bot.blockAt(target) as unknown as { getSignText?: () => string[] } | null;
  const sides = block?.getSignText?.();
  if (!sides) return null;
  return (sides[front ? 0 : 1] ?? '').replace(/\n+$/u, '');
}

/** Sends the text with the client's update, catching the `error` it emits for bad input. */
function sendText(
  bot: Bot,
  block: NonNullable<ReturnType<Bot['blockAt']>>,
  text: string,
  back: boolean,
): string | null {
  let refused: string | null = null;
  const onError = (error: Error): void => {
    refused = error.message;
  };
  bot.on('error', onError);
  try {
    bot.updateSign(block, text, back);
  } finally {
    bot.off('error', onError);
  }
  return refused;
}

/**
 * Looks at the sign, clicks it, writes the text on the side the server opened, and reads it back.
 * The sign text before the edit is read when the editor opens; a read-back equal to it is no change
 * (decision 0192), so re-sending the same text reports `no_effect`.
 */
async function clickAndRead(
  ctx: ActionContext,
  cell: NonNullable<ReturnType<Bot['blockAt']>>,
  target: Vec3,
  lines: string[],
): Promise<ActionOutcome> {
  const { bot, signal } = ctx;
  if (bot.getControlState('sneak')) bot.setControlState('sneak', false);
  // The open wait is armed before the look and the click, so the packet cannot be missed.
  const watch = watchSignOpen(bot, target);
  try {
    await bot.lookAt(target.offset(0.5, 0.5, 0.5), true);
    await bot.waitForTicks(LOOK_TICKS);
    if (signal.aborted) return cancelled();

    await bot.activateBlock(cell, new Vec3(0, 1, 0));
    const opened = await pollUntil(bot, signal, () => watch.opened !== null, {
      wallMs: OPEN_WAIT_MS * ctx.timeScale,
    });
    if (signal.aborted) return cancelled();
    if (!opened || watch.opened === null) return failed('no_effect', EDIT_SIGN_MESSAGE.notOpened);
    const front = watch.opened.front;
    const before = signTextOn(bot, target, front);

    const refused = sendText(bot, cell, lines.join('\n'), !front);
    if (refused !== null) return failed('internal', refused);
    if (signal.aborted) return cancelled();

    const read: { text: string | null } = { text: null };
    const changed = await pollUntil(
      bot,
      signal,
      () => {
        read.text = signTextOn(bot, target, front);
        return read.text !== null && read.text !== before;
      },
      { polls: READBACK_TICKS },
    );
    if (signal.aborted) return cancelled();
    if (!changed || read.text === null) return failed('no_effect', EDIT_SIGN_MESSAGE.unchanged);
    return completed({
      at: { x: target.x, y: target.y, z: target.z },
      text: read.text.split('\n'),
    });
  } catch (error) {
    return failed('internal', errorText(error));
  } finally {
    watch.dispose();
  }
}

/** Walks, clears the hand, clicks the sign and checks the text. Every `await` checks the signal. */
async function editSign(
  ctx: ActionContext,
  action: Extract<Action, { do: 'edit_sign' }>,
): Promise<ActionOutcome> {
  const { bot, signal } = ctx;
  const lines = wrapSignText(action.text);
  if (lines.length === 0) return failed('invalid_args', EDIT_SIGN_MESSAGE.empty);
  const target = new Vec3(action.at.x, action.at.y, action.at.z);
  const cell = bot.blockAt(target);
  if (!cell) return failed('not_possible', MESSAGE.notLoaded);
  if (!SIGN_BLOCK.test(cell.name)) return failed('not_possible', EDIT_SIGN_MESSAGE.notSign);
  if (isWaxed((cell as unknown as { blockEntity?: unknown }).blockEntity)) {
    return failed('not_possible', EDIT_SIGN_MESSAGE.waxed);
  }

  // Someone else's recorded block is refused; the bot's own placements and unknown or natural
  // blocks are allowed (decision 0164). The system owner is not the bot, so it is refused too.
  // The owner record is fetched first, so a cold cache does not answer before the chunk is read.
  await prefetchOwners([target], signal);
  if (signal.aborted) return cancelled();
  if (!isOwnPlacement(bot, action.at)) {
    const record = ownerRecordAt(target);
    if (record?.known && record.owner !== null && record.owner !== bot.username) {
      return failed('not_possible', EDIT_SIGN_MESSAGE.someoneElses);
    }
  }

  const walked = await reachTarget(ctx, target);
  if (walked) return walked;
  // Checked before the hand is touched: an aborted walk never empties the hand.
  if (signal.aborted) return cancelled();

  const hand = await clearHand(bot);
  if (!hand.ok) return failed('blocked', hand.refusal ?? EDIT_SIGN_MESSAGE.handBusy);
  if (signal.aborted) {
    await restoreHand(bot, hand.emptied);
    return cancelled();
  }

  const outcome = await clickAndRead(ctx, cell, target, lines);
  await restoreHand(bot, hand.emptied);
  return outcome;
}
