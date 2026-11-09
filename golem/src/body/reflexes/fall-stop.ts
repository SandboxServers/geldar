import type { Bot } from 'mineflayer';
import type { Reflex, ReflexOutcome } from '../reflex.ts';

/** A drop deeper than this many blocks fires the reflex (spec 5.2: "falling > 4 blocks imminent"). */
export const FALL_STOP_DROP = 4;
/** Ticks the reflex lets the Body's motion settle before it checks that it stopped. */
const SETTLE_TICKS = 3;
/** Horizontal speed (blocks per tick) below which the Body counts as stopped. */
const STOPPED_SPEED = 0.03;
/** Ticks before it may fire again: a planned parkour or a descent beside a cliff is not retried at once. */
const COOLDOWN_TICKS = 20;

const MOVE_CONTROLS = ['forward', 'back', 'left', 'right', 'sprint', 'jump'] as const;

/** Stops the pathfinder when it is loaded; a Body that never pathed has none. */
function stopPathfinder(bot: Bot): void {
  const loaded: unknown = (bot as { pathfinder?: unknown }).pathfinder;
  if (!loaded) return;
  bot.pathfinder.stop();
  bot.pathfinder.setGoal(null);
}

/**
 * Stops the Body at the edge of a drop deeper than 4 blocks. What a client can do on 26.1: it
 * decides its own movement, so before the Body steps off it can cancel the running action, halt
 * the pathfinder and release every movement key. Once it is in the air nothing a bot can do
 * lands it (a placed block needs a solid face to rest on), so the reflex only acts on the ground,
 * looking one block ahead of the motion. A drop that ends in water is not counted. It stays quiet
 * while the pathfinder holds a goal, and for 20 ticks after a firing.
 */
export function createFallStopReflex(): Reflex {
  return {
    name: 'fall_stop',
    priority: 100,
    cooldownTicks: COOLDOWN_TICKS,
    check(view) {
      // `fallingDistance` is above 0 for a moment after a jump; only a real fall is out of reach.
      if (view.fallingDistance > 1) return null;
      // A route the pathfinder planned already counts the drop; only stray motion is stopped.
      if (view.pathfinding === true) return null;
      const drop = view.dropAhead();
      return drop > FALL_STOP_DROP ? { drop } : null;
    },
    async run(trigger, ctx): Promise<ReflexOutcome> {
      const { bot } = ctx;
      await ctx.cancelAction();
      stopPathfinder(bot);
      for (const control of MOVE_CONTROLS) bot.setControlState(control, false);
      await bot.waitForTicks(SETTLE_TICKS);
      const { x, z } = bot.entity.velocity;
      if (Math.hypot(x, z) > STOPPED_SPEED) {
        return {
          result: 'failed',
          detail: `still moving toward a ${String(trigger.drop)} block drop`,
        };
      }
      return {
        result: 'handled',
        detail: `stopped at the edge of a ${String(trigger.drop)} block drop`,
      };
    },
  };
}
