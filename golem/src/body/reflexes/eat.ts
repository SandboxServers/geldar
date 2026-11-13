import { edibleAtHunger } from '../../actions/eat.ts';
import { runAction } from '../../actions/registry.ts';
import type { Reflex, ReflexOutcome } from '../reflex.ts';

/** Hunger at or below this (of 20) fires the reflex (spec 5.2). */
export const EAT_HUNGER_AT = 14;

/** Below this hunger a hurt Body eats too: natural regeneration needs 18 of 20. */
export const EAT_REGEN_HUNGER = 18;

/** World ticks between firings: a failed meal is not retried at once. */
const EAT_COOLDOWN_TICKS = 100;
/** After consecutive failed meals the wait doubles each time, up to this many world ticks. */
export const EAT_BACKOFF_CAP_TICKS = 1600;

/**
 * Eats when hunger is at or below 14 of 20 and the Body carries food. It runs the existing `eat`
 * action (which picks the best food) and never starts a second meal while one is under way.
 */
export function createEatReflex(): Reflex {
  let eating = false;
  let failures = 0;
  let failedAt: number | null = null;
  let lastTick: number | null = null;
  return {
    name: 'eat',
    priority: 30,
    cooldownTicks: EAT_COOLDOWN_TICKS,
    check(view) {
      const hurtAndHungry = view.health < 20 && view.hunger < EAT_REGEN_HUNGER;
      if (view.hunger > EAT_HUNGER_AT && !hurtAndHungry) return null;
      lastTick = view.tick;
      if (failures > 0 && failedAt !== null && view.tick !== null) {
        const wait = Math.min(EAT_COOLDOWN_TICKS * 2 ** failures, EAT_BACKOFF_CAP_TICKS);
        if (view.tick - failedAt < wait) return null;
      }
      const foods = edibleAtHunger(view.edibleFoods(), view.hunger);
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
        if (run.state === 'completed') {
          failures = 0;
          failedAt = null;
          return { result: 'handled', detail: 'ate' };
        }
        failures += 1;
        failedAt = lastTick;
        return { result: 'failed', detail: run.result.reason ?? run.result.status };
      } finally {
        eating = false;
      }
    },
  };
}
