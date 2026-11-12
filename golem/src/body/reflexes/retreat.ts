import { Vec3 } from 'vec3';
import { moveNear } from '../../actions/pathing.ts';
import type { Reflex, ReflexContext, ReflexOutcome, Trigger } from '../reflex.ts';
import type { BodyView } from '../view.ts';
import { deadline } from './deadline.ts';
import { type BlockAt, type Cell, nearestSafeStand } from './retreat-spot.ts';
import { dangers } from './threats.ts';

/** Health at or below this, with a hostile close, starts the retreat (spec 5.2 row 2). */
const RETREAT_HEALTH = 6;
/** A hostile this close (blocks) counts as close. */
const HOSTILE_RADIUS = 5;
/** Wall ms the walk to the safe spot may take. */
const RETREAT_LIMIT_MS = 20_000;
/** The walk counts as arrived within this many blocks of the stand. */
const ARRIVE_RANGE = 2;

/**
 * Retreat: health at or below 6 and a hostile within 5 blocks. The Body cancels what it is doing,
 * walks toward its last known safe spot (bed or world spawn, from the view's memory) and stops at
 * the nearest solid ground there (never a leaf canopy). With no known spot, no solid ground near it,
 * or a walk that fails, it still raises the wake: the Mind must hear that the Body is in trouble.
 */
export const retreatReflex: Reflex = {
  name: 'retreat',
  priority: 80,
  cooldownTicks: 200,
  check(view: BodyView): Trigger | null {
    if (view.health > RETREAT_HEALTH) return null;
    const hostile = dangers(view, HOSTILE_RADIUS)[0];
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
      const at: BlockAt = (x, y, z) => ctx.bot.blockAt(new Vec3(x, y, z));
      const stand = nearestSafeStand(at, spot.position);
      outcome =
        stand === null
          ? {
              result: 'abandoned',
              detail: `no solid ground near the ${spot.kind}: staying to fight`,
            }
          : await walkTo(ctx, spot.kind, stand);
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

async function walkTo(
  ctx: ReflexContext,
  kind: 'bed' | 'spawn',
  stand: Cell,
): Promise<ReflexOutcome> {
  const limit = deadline(ctx.signal, RETREAT_LIMIT_MS * ctx.timeScale);
  try {
    const aim = { x: stand.x + 0.5, y: stand.y, z: stand.z + 0.5 };
    const move = await moveNear(ctx.bot, aim, ARRIVE_RANGE, {
      signal: limit.signal,
      timeScale: ctx.timeScale,
    });
    if (move.ok) {
      return { result: 'handled', detail: `reached solid ground at the ${kind}` };
    }
    const why = limit.timedOut() ? 'timeout' : move.reason;
    return { result: 'failed', detail: `walk to the ${kind} ended: ${why}` };
  } finally {
    limit.clear();
  }
}
