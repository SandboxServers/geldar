import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Block, Container } from './bot-types.ts';
import { transferItems } from './container-transfer.ts';
import { heldCount } from './inventory-count.ts';
import { outcomeOfMove } from './move-outcome.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { moveNear } from './pathing.ts';
import type { ActionContext } from './registry.ts';
import { smeltRecipesFor } from './smelt-book.ts';
import { type HeldItem, MAX_SMELT, pickFuel, smeltTicks } from './smelt-fuel.ts';

/**
 * Smelting at a furnace, smoker or blast furnace, on the explicit-click transfers of decision 0037.
 * The contract has no `smelt` verb: the craft path calls `smeltAtFurnace` when no grid recipe makes
 * the item (the way the goldar reference falls back to a furnace). The recipe comes from the
 * server's recipe book only (decision 0048).
 */

/** The furnace window's slots: input, fuel, output. The player's inventory follows. */
const INPUT_SLOT = 0;
const FUEL_SLOT = 1;
const OUTPUT_SLOT = 2;
const FURNACES = new Set(['furnace', 'smoker', 'blast_furnace']);
/** Farther than this from the block center, the bot walks to the furnace first. */
const REACH = 4.5;
/** How far the furnace search looks. */
const SEARCH_RADIUS = 16;
/** Wall-clock wait for the furnace window to open, scaled by `timeScale`. */
const OPEN_WAIT_MS = 5_000;
/** Ticks between two looks at the output slot while waiting. */
const POLL_TICKS = 20;

/** What the caller asks for: an item name and how many. */
export interface SmeltRequest {
  item: string;
  count: number;
}

/** The furnace nearest the bot, preferring the kind the recipe names. */
function findFurnace(bot: Bot, station: string | null): Block | null {
  const names = station && FURNACES.has(station) ? new Set([station]) : FURNACES;
  const ids = Object.values(bot.registry.blocksByName)
    .filter((b) => names.has(b.name))
    .map((b) => b.id);
  if (ids.length === 0) return null;
  return bot.findBlock({ matching: ids, maxDistance: SEARCH_RADIUS });
}

/** The window's stack in a furnace slot, or null. */
function slotStack(container: Container, slot: number): { type: number; count: number } | null {
  const stack = container.slots[slot];
  return stack ? { type: stack.type, count: stack.count } : null;
}

/** What the bot holds, with the damageable flag the fuel picker needs. */
function heldItems(bot: Bot): HeldItem[] {
  return bot.inventory.items().map((i) => ({
    name: i.name,
    count: i.count,
    damageable: (bot.registry.items[i.type]?.maxDurability ?? 0) > 0,
  }));
}

/** Opens the furnace window, or says why not. The open is raced against a timer and the signal. */
async function openFurnace(ctx: ActionContext, block: Block): Promise<Container | ActionOutcome> {
  const { bot, signal, timeScale } = ctx;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let lost = false;
  const attempt = bot.openContainer(block).then(
    (container): Container | ActionOutcome => {
      // A window that opens after the race was lost is closed at once.
      if (lost) void container.close().catch(() => undefined);
      return container;
    },
    (error: unknown): Container | ActionOutcome => {
      console.warn(`furnace did not open: ${errorText(error)}`);
      return failed('blocked', 'the furnace did not open');
    },
  );
  const race = new Promise<ActionOutcome>((resolve) => {
    timer = setTimeout(() => {
      lost = true;
      resolve(failed('blocked', 'furnace did not open'));
    }, OPEN_WAIT_MS * timeScale);
    onAbort = () => {
      lost = true;
      resolve(cancelled());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([attempt, race]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** A context whose signal never fires: the cleanup after an abort must still run its clicks. */
function uninterruptible(ctx: ActionContext): ActionContext {
  return { ...ctx, signal: new AbortController().signal };
}

/** Takes whatever is in a furnace slot back into the inventory. Returns the error text, if any. */
async function takeBack(ctx: ActionContext, container: Container, slot: number): Promise<void> {
  const stack = slotStack(container, slot);
  if (!stack) return;
  const end = await transferItems(ctx, container, 'withdraw', stack.type, stack.count, [
    slot,
    slot + 1,
  ]);
  if (end.error) console.warn(`smelt: could not take back slot ${slot}: ${end.error}`);
}

/** Waits for `count` items in the output slot, or the tick budget. Returns what is there. */
async function waitForOutput(
  ctx: ActionContext,
  container: Container,
  count: number,
): Promise<number> {
  let left = smeltTicks(count);
  while (left > 0 && !ctx.signal.aborted) {
    if ((slotStack(container, OUTPUT_SLOT)?.count ?? 0) >= count) break;
    await ctx.bot.waitForTicks(POLL_TICKS);
    left -= POLL_TICKS;
  }
  return slotStack(container, OUTPUT_SLOT)?.count ?? 0;
}

/**
 * Smelts up to 16 of `request.count` items at a furnace. The window is the truth: the output is
 * counted from the window after the server-confirmed take, never assumed.
 */
export async function smeltAtFurnace(
  ctx: ActionContext,
  request: SmeltRequest,
): Promise<ActionOutcome> {
  const { bot, signal } = ctx;
  const out = bot.registry.itemsByName[request.item];
  if (!out) return failed('invalid_args', `unknown item ${request.item}`);
  const recipes = smeltRecipesFor(bot, out.id);
  if (recipes.length === 0) {
    return failed('not_possible', `no smelting recipe for ${request.item} is unlocked`);
  }
  const recipe = recipes.find((r) => heldCount(bot, r.input) > 0);
  if (!recipe) {
    const name = bot.registry.items[recipes[0]?.input ?? -1]?.name ?? 'the input';
    return failed('missing_materials', `no ${name} to smelt into ${request.item}`);
  }
  const input = bot.registry.items[recipe.input]?.name ?? '';
  const count = Math.min(request.count, MAX_SMELT, heldCount(bot, recipe.input));
  const capped = request.count > MAX_SMELT;
  const note = capped ? ` (capped at ${MAX_SMELT}, ${request.count} were requested)` : '';

  const { choice, need } = pickFuel(heldItems(bot), input, count);
  if (!choice) {
    const what = need ? `${need.count} ${need.name}` : 'fuel';
    return failed('missing_materials', `no fuel: need ${what} to smelt ${count} ${input}`);
  }
  if (signal.aborted) return cancelled();
  const block = findFurnace(bot, recipe.station);
  if (!block) return failed('not_found', 'no furnace within reach');
  const center = new Vec3(block.position.x + 0.5, block.position.y + 0.5, block.position.z + 0.5);
  if (bot.entity.position.distanceTo(center) > REACH) {
    const walk = await moveNear(bot, block.position, 3, { signal, timeScale: ctx.timeScale });
    if (!walk.ok) return outcomeOfMove(walk);
  }

  const opened = await openFurnace(ctx, block);
  if (!('slots' in opened)) return opened;
  const container = opened;
  let smelted = 0;
  let loading = false;
  try {
    if ([INPUT_SLOT, FUEL_SLOT, OUTPUT_SLOT].some((s) => slotStack(container, s) !== null)) {
      return failed('blocked', 'furnace is busy: it already holds items');
    }
    loading = true;
    const loadIn = await transferItems(ctx, container, 'deposit', recipe.input, count, [
      INPUT_SLOT,
      INPUT_SLOT + 1,
    ]);
    if (loadIn.aborted) return cancelled();
    const fuelId = bot.registry.itemsByName[choice.name]?.id ?? -1;
    const loadFuel = loadIn.error
      ? loadIn
      : await transferItems(ctx, container, 'deposit', fuelId, choice.count, [
          FUEL_SLOT,
          FUEL_SLOT + 1,
        ]);
    if (loadFuel.aborted) return cancelled();
    const loadError = loadIn.error ?? loadFuel.error;
    const loaded = slotStack(container, INPUT_SLOT)?.count ?? 0;
    if (loadError || loaded < count) {
      return failed('internal', `could not load the furnace: ${loadError ?? 'short load'}`);
    }
    const ready = await waitForOutput(ctx, container, count);
    const wasAborted = signal.aborted;
    const clean = uninterruptible(ctx);
    // The open window is current; `bot.inventory` is stale until it closes.
    const before = container.count(out.id, null);
    const have = slotStack(container, OUTPUT_SLOT);
    if (have) {
      const take = await transferItems(clean, container, 'withdraw', have.type, have.count, [
        OUTPUT_SLOT,
        OUTPUT_SLOT + 1,
      ]);
      if (take.error) console.warn(`smelt: output take stopped: ${take.error}`);
    }
    smelted = Math.max(0, container.count(out.id, null) - before);
    if (wasAborted) return cancelled({ smelted });
    if (smelted >= count && ready >= count) {
      return completed({
        smelted,
        item: request.item,
        capped,
        message: `smelted ${smelted}${note}`,
      });
    }
    return failed('timeout', `furnace made ${smelted} of ${count} ${request.item} in time${note}`, {
      smelted,
      requested: count,
    });
  } finally {
    // The cleanup runs on every path: success, timeout, busy refusal, abort and error.
    try {
      const clean = uninterruptible(ctx);
      // A busy furnace's items are not ours: only a furnace this action loaded is emptied.
      if (loading) {
        await takeBack(clean, container, OUTPUT_SLOT);
        await takeBack(clean, container, INPUT_SLOT);
        await takeBack(clean, container, FUEL_SLOT);
      }
    } catch (error: unknown) {
      console.warn(`smelt: cleanup failed: ${errorText(error)}`);
    }
    try {
      await container.close();
    } catch (error: unknown) {
      console.warn(`furnace did not close: ${errorText(error)}`);
    }
  }
}
