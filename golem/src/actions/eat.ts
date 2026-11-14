import { chooseFood } from './eat-choice.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { pollUntil } from './poll.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

export { edibleAtHunger } from './eat-choice.ts';

/** At this hunger the bot is full, and `eat` is refused. */
const FULL_FOOD = 20;
/** Wall ms, before scaling, to wait for the health packet after `consume()` resolves. */
const FOOD_WAIT_MS = 3_000;

/** Eats the food that fits the missing hunger (decision 0216), and waits until its food level rises. */
export const eatAction: ActionHandler<'eat'> = {
  kind: 'eat',
  timeoutMs: 20_000,
  run: (ctx) => eat(ctx),
};

async function eat(ctx: ActionContext): Promise<ActionOutcome> {
  const { bot } = ctx;
  const held = bot.heldItem ? [bot.heldItem] : [];
  const carried = [...held, ...bot.inventory.items()];
  const names = carried.map((item) => item.name);
  // A full bar is refused first, so a refusal about what is carried never reads as the reason (0216).
  if (bot.food >= FULL_FOOD) return failed('not_possible', 'not hungry');
  const choice = chooseFood(names, bot.registry.foodsByName, bot.food);
  if (choice.kind === 'refuse') return failed('not_possible', choice.message);
  if (choice.kind === 'none') return failed('missing_materials', 'no food');
  const name = choice.name;
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
