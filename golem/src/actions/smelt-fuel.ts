/** Smelting limits and the fuel arithmetic. */

/** The most items one smelt action puts in the furnace. */
export const MAX_SMELT = 16;
/** Ticks a furnace needs per item (a smoker or blast furnace is faster; this is the safe bound). */
export const TICKS_PER_ITEM = 200;
/** Extra ticks waited beyond the cooking time, for the light-up and the last item. */
export const SMELT_SLACK_TICKS = 200;

/**
 * Burn time in ticks of the fuels the agent is likely to hold (vanilla table, the ones needed):
 * coal, charcoal, planks, logs, wood and sticks. A fuel not listed here is not used.
 * Bucket and block fuels are left out on purpose: a lava bucket leaves a bucket behind.
 */
const BURN_TICKS: Record<string, number> = {
  coal: 1600,
  charcoal: 1600,
  stick: 100,
};
/** Burn ticks of any wooden planks, log, wood or stem item (all 300 in vanilla). */
const WOODEN_BURN = 300;
const WOODEN = /(_planks|_log|_wood|_stem|_hyphae)$/;

/** Fuels tried first, in this order. */
const PREFERRED = ['coal', 'charcoal'];

/** Burn ticks of an item, or 0 when it is not a fuel this table knows. */
export function burnTicks(name: string): number {
  const listed = BURN_TICKS[name];
  if (listed !== undefined) return listed;
  return WOODEN.test(name) ? WOODEN_BURN : 0;
}

/** How many fuel items smelt `count` items: ceil(count * 200 / burn time). 0 for a non-fuel. */
export function fuelNeeded(count: number, burn: number): number {
  if (burn <= 0) return 0;
  return Math.ceil((count * TICKS_PER_ITEM) / burn);
}

/** What the bot holds, as the fuel picker sees it. */
export interface HeldItem {
  name: string;
  count: number;
  /** True for a tool or armour: it burns in vanilla only for wooden tools, and is never fuel here. */
  damageable: boolean;
}

/** The fuel chosen and how many of it to load. */
export interface FuelChoice {
  name: string;
  count: number;
}

/**
 * Picks the fuel: coal then charcoal first, then any other burnable item that is not the input and
 * not damageable. The first one the bot holds enough of wins. Returns null when none holds enough;
 * `shortest` then names the best candidate's need for the message.
 */
export function pickFuel(
  held: HeldItem[],
  input: string,
  count: number,
): { choice: FuelChoice | null; need: FuelChoice | null } {
  const burnable = held.filter((h) => h.name !== input && !h.damageable && burnTicks(h.name) > 0);
  const rank = (name: string): number => {
    const i = PREFERRED.indexOf(name);
    return i === -1 ? PREFERRED.length : i;
  };
  const ordered = [...burnable].sort((a, b) => rank(a.name) - rank(b.name));
  let need: FuelChoice | null = null;
  for (const h of ordered) {
    const n = fuelNeeded(count, burnTicks(h.name));
    need ??= { name: h.name, count: n };
    if (h.count >= n) return { choice: { name: h.name, count: n }, need };
  }
  return { choice: null, need };
}

/**
 * How many items the fuel the bot holds can smelt in full: the best burnable candidate's whole
 * items (floor of its burn ticks over the ticks per item). 0 when no fuel is held.
 */
export function fuelLimit(held: HeldItem[], input: string): number {
  let best = 0;
  for (const h of held) {
    if (h.name === input || h.damageable) continue;
    const burn = burnTicks(h.name);
    if (burn > 0) best = Math.max(best, Math.floor((h.count * burn) / TICKS_PER_ITEM));
  }
  return best;
}

/** The ticks to wait for `count` items. */
export function smeltTicks(count: number): number {
  return count * TICKS_PER_ITEM + SMELT_SLACK_TICKS;
}
