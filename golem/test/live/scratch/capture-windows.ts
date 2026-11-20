// CAP-2 (fix 12): the window helpers of the scratch-shard capture: placing a container, opening it, clicking its slots.
// Split out of provenance-capture.ts (the runner) to keep both files under the soft cap. Test tooling, not unit-tested
// (no server in CAP-2); the pure parts are in capture-cases.ts.
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { LiveContext } from '../fixture.ts';
import { CASE_BLOCKS } from './capture-cases.ts';

export type Block = NonNullable<ReturnType<Bot['blockAt']>>;
export type OpenWindow = NonNullable<Bot['currentWindow']>;
type Slot = OpenWindow['slots'][number];
/** Plugin methods mineflayer adds at runtime (lib/plugins/anvil.js, enchantment_table.js); typed here by hand. */
export interface AnvilWindow extends OpenWindow {
  rename(item: unknown, name: string): Promise<void>;
}
export interface EnchantWindow extends OpenWindow {
  enchant(choice: number): Promise<unknown>;
}
export interface PluginBot {
  openAnvil(block: Block): Promise<AnvilWindow>;
  openEnchantmentTable(block: Block): Promise<EnchantWindow>;
}

export { CASE_BLOCKS };

export function note(line: string): void {
  process.stdout.write(`   ${line}\n`);
}

/** Resolves with `p`, or fails with a clear message after `ms`: a window or reply that never comes fails the case. */
export function within<T>(what: string, p: Promise<T>, ms = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error(`${what}: no answer within ${ms} ms`)), ms);
  });
  // The timer is cleared when `p` settles, so a finished case does not keep the process alive for the deadline.
  return Promise.race([p, giveUp]).finally(() => clearTimeout(timer));
}

/** Takes the item named `name` out of the bot's inventory; throws when the bot has none. */
export function heldItem(bot: Bot, name: string) {
  const item = bot.inventory.items().find((i) => i.name === name);
  if (item === undefined) throw new Error(`bot holds no ${name}`);
  return item;
}

/** Places `block` (a bare id) at x on the arena row and returns the block the bot can open. */
export async function placeTarget(ctx: LiveContext, block: string, x: number): Promise<Block> {
  const { bot, ctl, arena } = ctx;
  await ctl.setblock(x, 200, arena.center.z, block);
  await bot.waitForTicks(10);
  const target = bot.blockAt(new Vec3(x, 200, arena.center.z));
  if (target === null) throw new Error(`no ${block} at ${x},200`);
  return target;
}

/** A chest-like container at the arena's row, with stacks set by data merge; then the bot opens and clicks it. */
export async function takeFromBlock(
  ctx: LiveContext,
  block: string,
  x: number,
  items: string,
  click: [slot: number, button: number, mode: number],
): Promise<void> {
  const { bot, ctl, arena } = ctx;
  await ctl.setblock(x, 200, arena.center.z, block);
  await ctl.command(`data merge block ${x} 200 ${arena.center.z} {${items}}`);
  await bot.waitForTicks(10);
  const target = bot.blockAt(new Vec3(x, 200, arena.center.z));
  if (target === null) throw new Error(`no ${block} at ${x},200`);
  await within(`open ${block}`, bot.openBlock(target));
  await bot.clickWindow(click[0], click[1], click[2]);
  if (bot.currentWindow !== null) bot.closeWindow(bot.currentWindow);
}

/** The window must exist and be the expected kind; a window that did not open fails the case with the reason. */
export function expectWindow(win: OpenWindow, what: string, kind: RegExp): OpenWindow {
  const type = String(win.type);
  if (!kind.test(type)) throw new Error(`${what}: the open window is ${type}, not ${kind.source}`);
  note(`${what}: window ${type} is open with ${win.slots.length} slots`);
  return win;
}

/** The first slot at or after `from` that holds `name`; throws when the window has none. */
export function slotHolding(win: OpenWindow, name: string, from: number): number {
  const index = win.slots.findIndex((item, i) => i >= from && item?.name === name);
  if (index < 0) throw new Error(`no ${name} in the window from slot ${from}`);
  return index;
}

/** The craft that makes planks: one oak log in grid slot 1 (planks from logs is shapeless, one ingredient). */
export async function logIntoGrid(
  bot: Bot,
  win: OpenWindow,
  from: number,
  what: string,
): Promise<void> {
  const slot = slotHolding(win, 'oak_log', from);
  await bot.clickWindow(slot, 0, 0);
  await bot.clickWindow(1, 0, 0);
  await bot.waitForTicks(10);
  note(`${what}: moved the oak_log from slot ${slot} into grid slot 1`);
}

/** Takes the output in `slot`. Throws first if no output appeared: a zero from an empty output proves nothing. */
export async function takeOutput(
  bot: Bot,
  win: OpenWindow,
  slot: number,
  what: string,
): Promise<void> {
  let item: Slot = null;
  for (let i = 0; i < 40 && item === null; i++) {
    item = win.slots[slot] ?? null;
    if (item === null) await bot.waitForTicks(1);
  }
  if (item === null) {
    throw new Error(
      `${what}: output slot ${slot} is empty, so the case produced no output (INVALID, not a zero)`,
    );
  }
  note(`${what}: output slot ${slot} holds ${item.count} ${item.name}`);
  await bot.clickWindow(slot, 0, 0);
  await bot.waitForTicks(10);
  const left = win.slots[slot] ?? null;
  if (left !== null)
    throw new Error(`${what}: output slot ${slot} still holds ${left.name} after the click`);
  note(
    `${what}: clicked output slot ${slot}; ${item.name} x${item.count} picked up, slot now empty`,
  );
}

/**
 * After an anvil rename: mineflayer's rename already moved the output out of slot 2 (anvil.js `putAway`), so the
 * proof is the renamed stick in the inventory. Its custom name is read raw; the field's shape is UNPROVEN on the shard.
 */
export async function verifyRenamedStick(bot: Bot, name: string): Promise<void> {
  await bot.waitForTicks(20);
  const renamed = bot.inventory.items().find((i) => {
    const custom = (i as { customName?: unknown }).customName;
    return i.name === 'stick' && String(custom ?? '').includes(name);
  });
  if (renamed === undefined) {
    throw new Error(`anvil: no stick named "${name}" in the inventory after the rename (INVALID)`);
  }
  note(`anvil: the inventory holds the renamed stick (${renamed.count} x stick, name ${name})`);
}
