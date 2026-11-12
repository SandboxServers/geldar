import type { Action } from '@geldar/contract';
import { runAction } from '../../actions/registry.ts';
import type { Reflex, Trigger } from '../reflex.ts';
import type { BodyView } from '../view.ts';

/** `goto`s in a row that ended with no movement before the reflex fires. */
export const STUCK_GOTOS = 2;
/** Reflex runs in one stuck streak that freed nobody; after that only a verb call or a good `goto` helps. */
export const MAX_ATTEMPTS = 3;

interface Streak {
  stalls: number;
  attempts: number;
  /** Where the streak began. */
  at?: { x: number; y: number; z: number } | undefined;
}

/** The stuck streaks by view (one view per Body). */
const streaks = new WeakMap<BodyView, Streak>();

function streakOf(view: BodyView): Streak {
  let streak = streaks.get(view);
  if (!streak) {
    streak = { stalls: 0, attempts: 0 };
    streaks.set(view, streak);
  }
  return streak;
}

/** Stalls count as one streak while the bot stays within this many blocks of where the streak began. */
export const SAME_SPOT = 1;
/** The bot moving further than this from where the streak began ends the streak (attempts too). */
export const MOVED_AWAY = 3;

/**
 * Tells the reflex how a `goto` ended. The stall rule: a stall is a walk that went nowhere because
 * of the bot's own cell, that is a failure with reason `blocked` (whatever its message: "no path",
 * "way was blocked", "no movement for N world ticks") or a `goto` that finished without moving
 * (`stalled`). Failures about the goal itself (`not_found`, `timeout`, `interrupted`) are not stalls.
 * Stalls add up only while the bot stays within `SAME_SPOT` of where the streak began; a stall
 * further away starts a new count, and one beyond `MOVED_AWAY` also clears the attempts. An arrival
 * clears the streak. `at` is the bot's position when the walk ended; without it the spot is unchanged.
 */
export function noteGoto(
  view: BodyView,
  state: 'completed' | 'failed' | 'cancelled',
  reason: string | undefined,
  _message: string | undefined,
  stalled = false,
  at?: { x: number; y: number; z: number },
): void {
  const streak = streakOf(view);
  const stall = (state === 'completed' && stalled) || (state === 'failed' && reason === 'blocked');
  if (stall) {
    if (at && streak.at) {
      const away = Math.hypot(at.x - streak.at.x, at.y - streak.at.y, at.z - streak.at.z);
      if (away > MOVED_AWAY) streak.attempts = 0;
      if (away > SAME_SPOT) {
        streak.stalls = 0;
        streak.at = at;
      }
    } else if (at) {
      streak.at = at;
    }
    streak.stalls++;
  } else if (state === 'completed') {
    streak.stalls = 0;
    streak.attempts = 0;
    streak.at = undefined;
  }
}

/** Forgets the streak (the Body respawned, or the verb was called and freed the bot). */
export function resetStuck(view: BodyView): void {
  streaks.delete(view);
}

/** The stall count of a view (a test probe). */
export function stallCount(view: BodyView): number {
  return streaks.get(view)?.stalls ?? 0;
}

/**
 * Unstick (C1-12): after `STUCK_GOTOS` `goto`s in a row ended with no movement, runs the `unstick`
 * action (bare hands, no blocks). At most `MAX_ATTEMPTS` runs per streak; the cooldown spaces them.
 */
export const unstickReflex: Reflex = {
  name: 'unstick',
  priority: 25,
  cooldownTicks: 400,
  check(view): Trigger | null {
    const streak = streaks.get(view);
    if (!streak || streak.stalls < STUCK_GOTOS || streak.attempts >= MAX_ATTEMPTS) return null;
    return { stalls: streak.stalls, attempt: streak.attempts + 1 };
  },
  async run(_trigger, ctx) {
    const streak = streakOf(ctx.view);
    streak.attempts++;
    await ctx.cancelAction();
    const action: Action = { do: 'unstick' };
    const run = await runAction(ctx.registry, ctx.bot, action, {
      signal: ctx.signal,
      timeScale: ctx.timeScale,
    });
    if (run.state === 'completed') {
      streak.stalls = 0;
      return { result: 'handled', detail: 'unstick freed the body' };
    }
    if (run.state === 'cancelled') return { result: 'abandoned', detail: 'cancelled' };
    return { result: 'failed', detail: 'unstick found no way out' };
  },
};
