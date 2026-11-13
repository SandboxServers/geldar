import type { Bot } from 'mineflayer';
import { outcomeOfMove } from './move-outcome.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { moveNear } from './pathing.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/** The entity type Mineflayer hands out in `bot.entities`. */
type Entity = Bot['entities'][string];

/** Weapons the Body wields, best first. The fight-or-flee reflex arms itself from the same list. */
export const WEAPONS = [
  'netherite_sword',
  'diamond_sword',
  'iron_sword',
  'stone_sword',
  'golden_sword',
  'wooden_sword',
  'netherite_axe',
  'diamond_axe',
  'iron_axe',
  'stone_axe',
  'golden_axe',
  'wooden_axe',
];

/** Closer than this (blocks) the bot swings; farther it walks up first. Survival reach is 3. */
const REACH = 2.8;
/** The walk stops this close to the target (blocks). */
const APPROACH_RANGE = 2;
/** World ticks between swings: a sword's attack cooldown is 12.5 ticks. */
const SWING_TICKS = 13;
/** Most swings one action makes before giving up. */
const MAX_SWINGS = 80;
/** Most loop passes (approaches and swings together), so a walk that never closes in ends too. */
const MAX_STEPS = 200;
/** Stall limit for each approach, in world ticks: a target that moves is re-aimed often. */
const APPROACH_STALL_TICKS = 60;

/** The nearest entity of that mob name or player name, other than the bot. Null when none is loaded. */
export function findTarget(bot: Bot, name: string): Entity | null {
  const here = bot.entity.position;
  let best: Entity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity || entity.isValid === false) continue;
    if (entity.name !== name && entity.username !== name) continue;
    const distance = entity.position.distanceTo(here);
    if (distance < bestDistance) {
      best = entity;
      bestDistance = distance;
    }
  }
  return best;
}

/** The best weapon the bot carries, or null. */
export function bestWeapon(bot: Bot): ReturnType<Bot['inventory']['items']>[number] | null {
  const items = bot.inventory.items();
  for (const name of WEAPONS) {
    const found = items.find((stack) => stack.name === name);
    if (found) return found;
  }
  return null;
}

/**
 * Fights the nearest entity with that mob or player name: equips the best weapon it carries (bare
 * hands otherwise), walks up to the target and swings until the target is gone. It uses Mineflayer's
 * own `bot.attack`, one swing per attack cooldown. A target that is not loaded is `not_found`.
 */
export const attackAction: ActionHandler<'attack'> = {
  kind: 'attack',
  timeoutMs: 30_000,
  async run(ctx: ActionContext, action): Promise<ActionOutcome> {
    const { bot, signal } = ctx;
    const name = action.target;
    const first = findTarget(bot, name);
    if (!first) return failed('not_found', `no ${name} in view`);

    const weapon = bestWeapon(bot);
    if (weapon && bot.heldItem?.name !== weapon.name) {
      try {
        await bot.equip(weapon, 'hand');
      } catch (error) {
        return failed('interrupted', `could not equip ${weapon.name}: ${errorText(error)}`);
      }
    }
    const armed = weapon?.name ?? null;

    let swings = 0;
    for (let step = 0; step < MAX_STEPS && swings < MAX_SWINGS; step++) {
      if (signal.aborted) return cancelled({ target: name, swings });
      const entity = bot.entities[first.id];
      if (!entity || entity.isValid === false) {
        return completed({ target: name, swings, killed: true, weapon: armed });
      }
      if (entity.position.distanceTo(bot.entity.position) > REACH) {
        const move = await moveNear(bot, entity.position, APPROACH_RANGE, {
          digTier: false,
          signal,
          timeScale: ctx.timeScale,
          stallTicks: APPROACH_STALL_TICKS,
        });
        if (!move.ok) return outcomeOfMove(move, { target: name, swings });
        continue;
      }
      await bot.lookAt(entity.position.offset(0, (entity.height ?? 1) * 0.9, 0), true);
      bot.attack(entity);
      swings += 1;
      await bot.waitForTicks(SWING_TICKS);
    }
    return failed('timeout', `${name} still alive after ${swings} swings`, {
      target: name,
      swings,
    });
  },
};
