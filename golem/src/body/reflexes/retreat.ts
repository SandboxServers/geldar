import { moveNear } from '../../actions/pathing.ts';
import type { Reflex, ReflexContext, ReflexOutcome, Trigger } from '../reflex.ts';
import type { BodyView } from '../view.ts';
import { deadline } from './deadline.ts';

/** Health at or below this, with a hostile close, starts the retreat (spec 5.2 row 2). */
const RETREAT_HEALTH = 6;
/** A hostile this close (blocks) counts as close. */
const HOSTILE_RADIUS = 5;
/** Wall ms the walk to the safe spot may take. */
const RETREAT_LIMIT_MS = 20_000;
/** The walk counts as arrived within this many blocks of the spot. */
const ARRIVE_RANGE = 2;

/**
 * Retreat: health at or below 6 and a hostile within 5 blocks. The Body cancels what it is doing,
 * walks toward its last known safe spot (bed or world spawn, from the view's memory), and then
 * raises a `reflex_danger` wake so the Mind decides what comes next. With no known spot, or a walk
 * that fails, it still raises the wake: the Mind must hear that the Body is in trouble.
 */
export const retreatReflex: Reflex = {
  name: 'retreat',
  priority: 80,
  cooldownTicks: 200,
  check(view: BodyView): Trigger | null {
    if (view.health > RETREAT_HEALTH) return null;
    const hostile = view.nearbyHostiles(HOSTILE_RADIUS)[0];
    if (!hostile) return null;
    return {
      health: view.health,
      hostile: hostile.name,
      distance: Math.round(hostile.distance * 10) / 10,
      safe_spot: view.safeSpot?.kind ?? null,
    };
  },
  async run(trigger: Trigger, ctx: ReflexContext): Promise<ReflexOutcome> {
    await ctx.cancelAction();
    const spot = ctx.view.safeSpot ?? null;
    let outcome: ReflexOutcome;
    if (spot === null) {
      outcome = { result: 'abandoned', detail: 'no safe spot known' };
    } else {
      const limit = deadline(ctx.signal, RETREAT_LIMIT_MS);
      try {
        const aim = { x: spot.position.x + 0.5, y: spot.position.y, z: spot.position.z + 0.5 };
        const move = await moveNear(ctx.bot, aim, ARRIVE_RANGE, {
          signal: limit.signal,
          timeScale: 1,
        });
        if (move.ok) {
          outcome = { result: 'handled', detail: `reached the ${spot.kind}` };
        } else {
          const why = limit.timedOut() ? 'timeout' : move.reason;
          outcome = { result: 'failed', detail: `walk to the ${spot.kind} ended: ${why}` };
        }
      } finally {
        limit.clear();
      }
    }
    ctx.sink.wake({
      reason: 'reflex_danger',
      tick: ctx.tick,
      intentId: null,
      detail: `retreat at ${trigger.health} health from ${trigger.hostile}: ${outcome.detail ?? outcome.result}`,
    });
    return outcome;
  },
};
