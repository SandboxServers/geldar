import { BANNED_FOODS } from '../../actions/eat.ts';
import { runAction } from '../../actions/registry.ts';
import type { Reflex, ReflexOutcome } from '../reflex.ts';

/** Hunger at or below this (of 20) fires the reflex (spec 5.2). */
export const EAT_HUNGER_AT = 14;

/** World ticks between firings: a failed meal is not retried at once. */
const EAT_COOLDOWN_TICKS = 100;

/** The foods the `eat` action would pick from: carried, and not on its banned list. */
function pickableFoods(names: readonly string[]): string[] {
  return names.filter((name) => !BANNED_FOODS.includes(name));
}

/**
 * Eats when hunger is at or below 14 of 20 and the Body carries food. It runs the existing `eat`
 * action (which picks the best food) and never starts a second meal while one is under way.
 */
export function createEatReflex(): Reflex {
  let eating = false;
  return {
    name: 'eat',
    priority: 30,
    cooldownTicks: EAT_COOLDOWN_TICKS,
    check(view) {
      if (view.hunger > EAT_HUNGER_AT) return null;
      const foods = pickableFoods(view.edibleFoods());
      if (foods.length === 0) return null;
      return { hunger: view.hunger, foods: foods.length };
    },
    async run(_trigger, ctx): Promise<ReflexOutcome> {
      // The flag covers a meal of this reflex; `usingHeldItem` covers one the intent started.
      if (eating || ctx.bot.usingHeldItem) return { result: 'abandoned', detail: 'already eating' };
      eating = true;
      try {
        // Eating swaps the held item, which would clash with a running mine or place.
        await ctx.cancelAction();
        const run = await runAction(
          ctx.registry,
          ctx.bot,
          { do: 'eat' },
          { signal: ctx.signal, timeScale: ctx.timeScale },
        );
        if (run.state === 'completed') return { result: 'handled', detail: 'ate' };
        return { result: 'failed', detail: run.result.reason ?? run.result.status };
      } finally {
        eating = false;
      }
    },
  };
}
