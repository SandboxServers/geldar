import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { pollUntil } from './poll.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/**
 * Foods the Body never picks: raw or harmful ones, and ones whose effects it does not handle. Wave 4
 * refines this list.
 */
const BANNED_FOODS = [
  'rotten_flesh',
  'spider_eye',
  'poisonous_potato',
  'pufferfish',
  'suspicious_stew',
  'chorus_fruit',
];
/** At this hunger the bot is full, and `eat` is refused. */
const FULL_FOOD = 20;
/** Wall ms, before scaling, to wait for the health packet after `consume()` resolves. */
const FOOD_WAIT_MS = 3_000;

/** The food numbers the choice reads, from `bot.registry.foodsByName`. */
export interface FoodInfo {
  foodPoints: number;
  saturation: number;
}

/**
 * The best food among item names: the most food points, then the most saturation, then the name.
 * Banned names and names with no food entry are skipped. Null when nothing is left.
 */
export function bestFood(
  items: readonly string[],
  foodsByName: Readonly<Record<string, FoodInfo | undefined>>,
  banned: readonly string[],
): string | null {
  let best: { name: string; food: FoodInfo } | null = null;
  for (const name of items) {
    const food = foodsByName[name];
    if (!food || banned.includes(name)) continue;
    if (!best || beats(food, name, best.food, best.name)) best = { name, food };
  }
  return best?.name ?? null;
}

/** True when a candidate food ranks above the best so far. */
function beats(food: FoodInfo, name: string, best: FoodInfo, bestName: string): boolean {
  if (food.foodPoints !== best.foodPoints) return food.foodPoints > best.foodPoints;
  if (food.saturation !== best.saturation) return food.saturation > best.saturation;
  return name < bestName;
}

/** Eats the best food the bot holds or carries, and waits until its food level rises. */
export const eatAction: ActionHandler<'eat'> = {
  kind: 'eat',
  timeoutMs: 20_000,
  run: (ctx) => eat(ctx),
};

async function eat(ctx: ActionContext): Promise<ActionOutcome> {
  const { bot } = ctx;
  const held = bot.heldItem ? [bot.heldItem] : [];
  const carried = [...held, ...bot.inventory.items()];
  const name = bestFood(
    carried.map((item) => item.name),
    bot.registry.foodsByName,
    BANNED_FOODS,
  );
  if (!name) return failed('missing_materials', 'no food');
  if (bot.food >= FULL_FOOD) return failed('not_possible', 'not hungry');
  const item = carried.find((stack) => stack.name === name);
  if (!item) return failed('missing_materials', 'no food');

  const before = bot.food;
  await bot.equip(item, 'hand');
  if (ctx.signal.aborted) return cancelled();

  // `consume()` has a fixed wall timeout shorter than eating (32 server ticks), so a rejection does not
  // mean the food was not eaten: the health packet decides, and it can arrive after `consume()` resolves.
  let consumeError: string | null = null;
  try {
    await bot.consume();
  } catch (error) {
    consumeError = errorText(error);
  }
  const rose = await waitForFood(ctx, before);
  if (ctx.signal.aborted) return cancelled();

  if (rose) {
    return completed({ item: name, food_before: before, food_after: bot.food });
  }
  if (consumeError === null) {
    return failed('timeout', `food did not rise within ${FOOD_WAIT_MS * ctx.timeScale} ms`);
  }
  return /timeout/i.test(consumeError)
    ? failed('timeout', consumeError)
    : failed('interrupted', consumeError);
}

/** Polls the food level once a tick until it rises, the wait runs out or the action is aborted. */
async function waitForFood(ctx: ActionContext, before: number): Promise<boolean> {
  return pollUntil(ctx.bot, ctx.signal, () => ctx.bot.food > before, {
    wallMs: FOOD_WAIT_MS * ctx.timeScale,
  });
}
