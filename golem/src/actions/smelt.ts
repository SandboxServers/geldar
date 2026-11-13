import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Block, Container } from './bot-types.ts';
import { transferItems } from './container-transfer.ts';
import { FEWER_MESSAGE, freeSpotBeside, pickUpSpareBlock } from './craft-spare.ts';
import { heldCount } from './inventory-count.ts';
import { outcomeOfMove } from './move-outcome.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { moveNear } from './pathing.ts';
import { placeAction } from './place.ts';
import type { ActionContext } from './registry.ts';
import { smeltRecipesFor } from './smelt-book.ts';
import {
  type FuelChoice,
  fuelLimit,
  type HeldItem,
  MAX_SMELT,
  pickFuel,
  smeltTicks,
} from './smelt-fuel.ts';

/**
 * Smelting at a furnace, smoker or blast furnace, on the explicit-click transfers of decision 0037.
 * The contract has no `smelt` verb: the craft path calls `smeltAtFurnace` when no grid recipe makes
 * the item (the way the goldar reference falls back to a furnace). The recipe comes from the
 * server's recipe book only (decision 0048). With no furnace in reach, a carried one is placed
 * beside the bot, used, and mined back.
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
/** Said when a carried furnace has no free cell beside the bot to be placed on. */
const NO_SPACE = 'no free space beside you for a furnace';

/** What the caller asks for: an item name and how many. */
export interface SmeltRequest {
  item: string;
  count: number;
}

/** A smelt the checks have cleared: what to load, how many, and the fuel for them. */
interface SmeltJob {
  request: SmeltRequest;
  outId: number;
  inputId: number;
  count: number;
  capped: boolean;
  /** True when fewer were planned than asked, because the input or the fuel ran out. */
  short: boolean;
  note: string;
  fuel: FuelChoice;
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

/** The furnace item a recipe needs, or the plain furnace when it names none. */
function furnaceKind(station: string | null): string {
  return station && FURNACES.has(station) ? station : 'furnace';
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
      const raw = errorText(error);
      console.warn(`furnace did not open: ${raw}`);
      return failed('blocked', 'the furnace did not open', {}, raw);
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
 * Places a carried furnace of `kind` beside the bot, runs `run` on it, and mines it back on every
 * path. Says so when none is carried or there is no room, and places nothing then.
 */
async function withCarriedFurnace(
  ctx: ActionContext,
  kind: string,
  run: (block: Block) => Promise<ActionOutcome>,
): Promise<ActionOutcome> {
  const { bot } = ctx;
  const id = bot.registry.itemsByName[kind]?.id;
  if (id === undefined || heldCount(bot, id) === 0) {
    return failed('not_found', 'no furnace within reach');
  }
  const spot = freeSpotBeside(bot);
  if (!spot) return failed('blocked', NO_SPACE);
  const put = await placeAction.run(ctx, { do: 'place', block: kind, at: spot });
  if (put.status !== 'completed') return put;
  try {
    const block = findFurnace(bot, kind);
    if (!block) return failed('not_found', 'no furnace within reach');
    return await run(block);
  } finally {
    await pickUpSpareBlock(ctx, kind);
  }
}

/**
 * Loads, waits and collects at one furnace. The window is the truth: the output is counted from the
 * window after the server-confirmed take, never assumed.
 */
async function smeltIn(ctx: ActionContext, block: Block, job: SmeltJob): Promise<ActionOutcome> {
  const { bot, signal } = ctx;
  const { request, count, fuel } = job;
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
    const loadIn = await transferItems(ctx, container, 'deposit', job.inputId, count, [
      INPUT_SLOT,
      INPUT_SLOT + 1,
    ]);
    if (loadIn.aborted) return cancelled();
    const fuelId = bot.registry.itemsByName[fuel.name]?.id ?? -1;
    const loadFuel = loadIn.error
      ? loadIn
      : await transferItems(ctx, container, 'deposit', fuelId, fuel.count, [
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
    const before = container.count(job.outId, null);
    const have = slotStack(container, OUTPUT_SLOT);
    if (have) {
      const take = await transferItems(clean, container, 'withdraw', have.type, have.count, [
        OUTPUT_SLOT,
        OUTPUT_SLOT + 1,
      ]);
      if (take.error) console.warn(`smelt: output take stopped: ${take.error}`);
    }
    smelted = Math.max(0, container.count(job.outId, null) - before);
    if (wasAborted) return cancelled({ smelted });
    if (smelted >= count && ready >= count) {
      return completed({
        smelted,
        item: request.item,
        capped: job.capped,
        message: job.short ? FEWER_MESSAGE : `smelted ${smelted}${job.note}`,
      });
    }
    return failed(
      'timeout',
      `furnace made ${smelted} of ${count} ${request.item} in time${job.note}`,
      { smelted, requested: count },
    );
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

/**
 * Smelts up to 16 of `request.count` items at a furnace. The input and the fuel decide how many
 * can be made: when either runs out, the rest are not made and the outcome says so.
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
  const wanted = Math.min(request.count, MAX_SMELT, heldCount(bot, recipe.input));
  const count = Math.min(wanted, fuelLimit(heldItems(bot), input));
  const capped = request.count > MAX_SMELT;
  const note = capped ? ` (capped at ${MAX_SMELT}, ${request.count} were requested)` : '';
  const short = count < Math.min(request.count, MAX_SMELT);

  const { choice } = pickFuel(heldItems(bot), input, count);
  if (!choice || count === 0) {
    return failed('missing_materials', 'there is not enough fuel');
  }
  if (signal.aborted) return cancelled();
  const job: SmeltJob = {
    request,
    outId: out.id,
    inputId: recipe.input,
    count,
    capped,
    short,
    note,
    fuel: choice,
  };
  const near = findFurnace(bot, recipe.station);
  if (near) return smeltIn(ctx, near, job);
  return withCarriedFurnace(ctx, furnaceKind(recipe.station), (block) => smeltIn(ctx, block, job));
}
