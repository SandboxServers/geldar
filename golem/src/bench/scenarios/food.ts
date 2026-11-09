import { Vec3 } from 'vec3';
import { waitUntil } from '../runner.ts';
import type { Scenario } from '../types.ts';

/** The melon block, as an offset from the arena center. */
const MELON_DX = 5;
/** Hunger level at or under which the bot counts as hungry. */
const HUNGRY_AT = 12;
/** Give up lowering hunger after this many world ticks. */
const HUNGER_TICKS = 600;

/** Verdict: eating raised the food level. */
export function foodRose(before: number, after: number): boolean {
  return after > before;
}

/**
 * Food: get hungry, mine a melon, eat what it dropped. The melon is the only food in the arena,
 * so the eat step can only be satisfied by the mine step.
 */
export const food: Scenario = {
  name: 'food',
  description: 'get hungry, mine a melon, eat it',
  // Above `mine`'s own 180,000 ms limit, so a slow mine fails as an action, not as the scenario.
  timeoutMs: 240_000,
  async prepare(env) {
    const { center } = env.arena;
    await env.ctl.clear(env.bot.username);
    await env.ctl.setblock(center.x + MELON_DX, center.y, center.z, 'melon');
  },
  ready(env) {
    const { center } = env.arena;
    const melon = env.bot.blockAt(new Vec3(center.x + MELON_DX, center.y, center.z));
    return melon?.name === 'melon' && env.bot.inventory.items().length === 0;
  },
  async run(env) {
    const { bot, ctl } = env;
    await ctl.effect(bot.username, 'hunger', 30, 255);
    const hungry = await waitUntil(env, () => bot.food <= HUNGRY_AT, HUNGER_TICKS);
    await ctl.effectClear(bot.username);
    if (!hungry) return { passed: false, note: `never got hungry: food ${bot.food}` };

    const before = bot.food;
    const mined = await env.run({ do: 'mine', block: 'melon', count: 1 });
    if (mined.result.status !== 'completed') {
      const { reason, message } = mined.result;
      return {
        passed: false,
        note: `mine melon ${mined.result.status} (${reason}: ${message}), food_before ${before}`,
      };
    }
    const ate = await env.run({ do: 'eat' });
    if (ate.result.status !== 'completed') {
      const { reason, message } = ate.result;
      return {
        passed: false,
        note: `eat ${ate.result.status} (${reason}: ${message}), food_before ${before}`,
      };
    }
    const after = bot.food;
    return {
      passed: foodRose(before, after),
      note: `food_before ${before}, food_after ${after}`,
    };
  },
};
