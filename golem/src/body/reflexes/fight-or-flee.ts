import { attackAction, WEAPONS } from '../../actions/attack.ts';
import { moveNear } from '../../actions/pathing.ts';
import { ActionRegistry, runAction } from '../../actions/registry.ts';
import type { Reflex, ReflexContext, ReflexOutcome, Trigger } from '../reflex.ts';
import type { BodyView, HostileView } from '../view.ts';
import { deadline } from './deadline.ts';
import { attackerOf, isSuicideMob } from './threats.ts';

/** A hostile this close (blocks) that hurt the Body just now is the attacker. */
const ATTACKER_RADIUS = 4;
/** The hurt must be this fresh, in physics ticks (one second). */
const HURT_WINDOW_TICKS = 20;
/** At or below this health the Body does not fight: it flees (the retreat reflex shares the number). */
const LOW_HEALTH = 6;
/** Wall ms a fight may last. */
const FIGHT_LIMIT_MS = 30_000;
/** Wall ms a flight may last. */
const FLIGHT_LIMIT_MS = 15_000;
/** How far (blocks) one flight leg runs from the attacker. */
const FLEE_DISTANCE = 14;
/** How close to the flight point counts as arrived. */
const FLEE_RANGE = 3;
/** How often (wall ms) a fight checks that the Body's health is still above the floor. */
const HEALTH_WATCH_MS = 100;
/** Flight directions tried in turn, in radians off the line straight away from the attacker. */
const FLEE_TURNS = [0, Math.PI / 3, -Math.PI / 3];

/** True when the Body carries a sword or an axe. */
function isArmed(view: BodyView): boolean {
  return WEAPONS.some((name) => view.inventoryCount(name) > 0);
}

/**
 * Fight or flee: a hostile hurts the Body (health dropped within the last second, and a hostile
 * that is not neutral stands within 4 blocks, in melee reach and facing the Body). Armed (a sword
 * or axe carried) with health above 6, it cancels what it was doing and
 * fights that hostile with the `attack` action until it is gone or health falls to 6; otherwise it
 * runs from it. A flight, and a fight that ends on low health, raise a `reflex_danger` wake.
 */
export const fightOrFleeReflex: Reflex = {
  name: 'fight_or_flee',
  priority: 60,
  cooldownTicks: 60,
  check(view: BodyView): Trigger | null {
    const hurt = view.ticksSinceHurt;
    if (hurt === null || hurt === undefined || hurt > HURT_WINDOW_TICKS) return null;
    const hostile = attackerOf(view, ATTACKER_RADIUS);
    if (!hostile) return null;
    return {
      health: view.health,
      hostile: hostile.name,
      distance: Math.round(hostile.distance * 10) / 10,
      // A creeper is never meleed: the Body runs from it.
      armed: isArmed(view) && !isSuicideMob(hostile.name),
    };
  },
  async run(trigger: Trigger, ctx: ReflexContext): Promise<ReflexOutcome> {
    await ctx.cancelAction();
    const name = String(trigger.hostile);
    if (trigger.armed === true && ctx.view.health > LOW_HEALTH) {
      const fight = await fightHostile(ctx, name);
      if (fight.outcome.result === 'handled' || !fight.lowHealth) return fight.outcome;
      // Health fell to the floor mid-fight: run, and tell the Mind.
      return flee(ctx, name, 'health low mid-fight');
    }
    return flee(ctx, name, trigger.armed === true ? 'health low' : 'unarmed');
  },
};

/** Runs the `attack` action on the named hostile, aborting it when health reaches the floor. */
async function fightHostile(
  ctx: ReflexContext,
  name: string,
): Promise<{ outcome: ReflexOutcome; lowHealth: boolean }> {
  const limit = deadline(ctx.signal, FIGHT_LIMIT_MS * ctx.timeScale);
  const own = new AbortController();
  let lowHealth = false;
  const forward = (): void => own.abort();
  limit.signal.addEventListener('abort', forward, { once: true });
  const watch = setInterval(() => {
    if (ctx.view.health <= LOW_HEALTH) {
      lowHealth = true;
      own.abort();
    }
  }, HEALTH_WATCH_MS);
  try {
    const run = await runAction(
      attackRegistry(ctx),
      ctx.bot,
      { do: 'attack', target: name },
      { signal: own.signal, timeScale: ctx.timeScale },
    );
    if (run.state === 'completed')
      return { outcome: { result: 'handled', detail: `killed ${name}` }, lowHealth };
    const detail = `fight ended ${run.state}: ${run.result.message ?? run.result.reason ?? 'aborted'}`;
    return { outcome: { result: 'failed', detail }, lowHealth };
  } finally {
    clearInterval(watch);
    limit.signal.removeEventListener('abort', forward);
    limit.clear();
  }
}

/** The runtime's registry when it holds `attack`, else one that does, so the reflex never depends on wiring. */
function attackRegistry(ctx: ReflexContext): ActionRegistry {
  if (ctx.registry.get('attack')) return ctx.registry;
  const own = new ActionRegistry();
  own.register(attackAction);
  return own;
}

/** Runs from the named hostile, trying a few directions, then raises the danger wake. */
async function flee(ctx: ReflexContext, name: string, why: string): Promise<ReflexOutcome> {
  const hostile: HostileView | undefined = ctx.view.nearbyHostiles().find((h) => h.name === name);
  const here = ctx.view.position;
  let outcome: ReflexOutcome = { result: 'failed', detail: `${why}: no way to run` };
  if (hostile) {
    const away = Math.atan2(here.z - hostile.position.z, here.x - hostile.position.x);
    const limit = deadline(ctx.signal, FLIGHT_LIMIT_MS * ctx.timeScale);
    try {
      for (const turn of FLEE_TURNS) {
        if (limit.signal.aborted) break;
        const goal = {
          x: here.x + 0.5 + Math.cos(away + turn) * FLEE_DISTANCE,
          y: here.y,
          z: here.z + 0.5 + Math.sin(away + turn) * FLEE_DISTANCE,
        };
        const move = await moveNear(ctx.bot, goal, FLEE_RANGE, {
          signal: limit.signal,
          timeScale: ctx.timeScale,
        });
        if (move.ok) {
          outcome = { result: 'handled', detail: `${why}: fled from ${name}` };
          break;
        }
        outcome = { result: 'failed', detail: `${why}: flight ended ${move.reason}` };
      }
    } finally {
      limit.clear();
    }
  } else {
    outcome = { result: 'handled', detail: `${why}: ${name} already gone` };
  }
  ctx.sink.wake({
    reason: 'reflex_danger',
    tick: ctx.tick,
    intentId: null,
    detail: `${name} attacked: ${outcome.detail ?? outcome.result}`,
  });
  return outcome;
}
