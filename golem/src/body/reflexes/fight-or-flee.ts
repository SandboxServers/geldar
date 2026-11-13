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
/** A hissing creeper this close (blocks) and in sight makes the Body run (PX-7). */
const HISS_RADIUS = 5;
/** Ticks between two firings of this reflex: a flee within 2 s is suppressed (PX-7 cooldown). */
const FLEE_COOLDOWN_TICKS = 40;
/** An arrow in flight this close (blocks) that flies at the Body makes it sidestep (PX-7). */
const ARROW_RADIUS = 6;
/** How far (blocks) a sidestep moves the Body across the arrow's line. */
const SIDESTEP_BLOCKS = 3;
/** How close to the sidestep point counts as arrived. */
const SIDESTEP_RANGE = 1;
/** Wall ms a sidestep may last (a 3-block step); past it the reflex gives up, as a flight does. */
const SIDESTEP_LIMIT_MS = 5_000;
/** Arrow sidesteps allowed inside one window before the reflex pauses (a pit keeps the Body in line of fire). */
const ARROW_SIDESTEP_LIMIT = 4;
/** The window (world ticks, 15 s) that the sidestep limit counts in. */
const ARROW_WINDOW_TICKS = 300;
/** The first pause (world ticks, 15 s); each pause in a row doubles, up to the cap. */
const ARROW_PAUSE_BASE_TICKS = 300;
/** The longest pause (world ticks, 120 s). */
const ARROW_PAUSE_CAP_TICKS = 2400;
/** A new pause this long (world ticks, 60 s) after the last one starts over at the base. */
const ARROW_QUIET_TICKS = 1200;
/** Nominal world ticks per second, for the seconds shown in a log line. */
const TICKS_PER_SECOND = 20;
/** How often (wall ms) a fight checks that the Body's health is still above the floor. */
const HEALTH_WATCH_MS = 100;
/** Flight directions tried in turn, in radians off the line straight away from the attacker. */
const FLEE_TURNS = [0, Math.PI / 3, -Math.PI / 3];

/** The trigger for a hissing creeper within HISS_RADIUS that the view lists (sight is applied by the view). */
function hissTrigger(view: BodyView): Trigger | null {
  const creeper = view
    .nearbyHostiles(HISS_RADIUS)
    .find((h) => h.name === 'creeper' && h.hissing === true);
  if (!creeper) return null;
  return {
    health: view.health,
    hostile: creeper.name,
    distance: Math.round(creeper.distance * 10) / 10,
    armed: false,
    cause: 'hiss',
  };
}

/** Sidestep bookkeeping for one Body: the world ticks of recent sidesteps, and the pause state. */
interface ArrowState {
  sidesteps: number[];
  pausedUntil: number;
  pauses: number;
  lastActive: number;
}

/** One state per Body view (the runtime keeps one view per Body, so one array serves every Body). */
const arrowStates = new WeakMap<BodyView, ArrowState>();

function arrowStateOf(view: BodyView): ArrowState {
  let state = arrowStates.get(view);
  if (!state) {
    state = {
      sidesteps: [],
      pausedUntil: Number.NEGATIVE_INFINITY,
      pauses: 0,
      lastActive: Number.NEGATIVE_INFINITY,
    };
    arrowStates.set(view, state);
  }
  return state;
}

/**
 * The trigger for the nearest closing arrow within ARROW_RADIUS that the view lists (PX-7 sidestep).
 * While paused it lists nothing; once ARROW_SIDESTEP_LIMIT sidesteps fall inside the window it fires
 * with `paused` set, so the run logs the give-up once instead of sidestepping again.
 */
function arrowTrigger(view: BodyView): Trigger | null {
  const arrow = view.arrowsNear?.(ARROW_RADIUS).find((a) => a.closing);
  if (!arrow) return null;
  const now = view.tick ?? 0;
  const state = arrowStateOf(view);
  if (now < state.pausedUntil) return null;
  state.sidesteps = state.sidesteps.filter((tick) => now - tick < ARROW_WINDOW_TICKS);
  return {
    health: view.health,
    hostile: 'arrow',
    distance: Math.round(arrow.distance * 10) / 10,
    armed: false,
    cause: 'arrow',
    bearing: arrow.bearing,
    paused: state.sidesteps.length >= ARROW_SIDESTEP_LIMIT,
  };
}

/** Records a sidestep. A volley after a quiet minute (no sidestep and no pause) starts the pauses over. */
function noteSidestep(view: BodyView): void {
  const now = view.tick ?? 0;
  const state = arrowStateOf(view);
  if (now - Math.max(state.lastActive, state.pausedUntil) >= ARROW_QUIET_TICKS) state.pauses = 0;
  state.lastActive = now;
  state.sidesteps.push(now);
}

/** Starts a pause: no sidestep until it ends, the duration doubles per pause in a row. */
function pauseArrows(view: BodyView): ReflexOutcome {
  const now = view.tick ?? 0;
  const state = arrowStateOf(view);
  state.pauses += 1;
  const period = Math.min(ARROW_PAUSE_BASE_TICKS * 2 ** (state.pauses - 1), ARROW_PAUSE_CAP_TICKS);
  state.pausedUntil = now + period;
  state.sidesteps = [];
  const seconds = Math.round(period / TICKS_PER_SECOND);
  return {
    result: 'abandoned',
    detail: `arrow sidestep paused: still under fire (${seconds}s)`,
  };
}

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
 * Also: a creeper that hisses (fuse lit) within 5 blocks and in sight makes the Body run (cause `hiss`).
 */
export const fightOrFleeReflex: Reflex = {
  name: 'fight_or_flee',
  priority: 60,
  cooldownTicks: FLEE_COOLDOWN_TICKS,
  check(view: BodyView): Trigger | null {
    const hurt = view.ticksSinceHurt;
    if (hurt !== null && hurt !== undefined && hurt <= HURT_WINDOW_TICKS) {
      const hostile = attackerOf(view, ATTACKER_RADIUS);
      if (hostile) {
        return {
          health: view.health,
          hostile: hostile.name,
          distance: Math.round(hostile.distance * 10) / 10,
          // A creeper is never meleed: the Body runs from it.
          armed: isArmed(view) && !isSuicideMob(hostile.name),
        };
      }
    }
    return hissTrigger(view) ?? arrowTrigger(view);
  },
  async run(trigger: Trigger, ctx: ReflexContext): Promise<ReflexOutcome> {
    if (trigger.cause === 'arrow' && trigger.paused === true) return pauseArrows(ctx.view);
    await ctx.cancelAction();
    const name = String(trigger.hostile);
    if (trigger.cause === 'hiss') return flee(ctx, name, 'hiss');
    if (trigger.cause === 'arrow') {
      noteSidestep(ctx.view);
      return sidestep(ctx, String(trigger.bearing));
    }
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

/**
 * Steps across an arrow's line: an arrow on the left sends the Body right, an arrow on the right
 * sends it left, and an arrow in front or behind sends it right. The step is SIDESTEP_BLOCKS along
 * the Body's right vector (mineflayer's yaw: right is (cos yaw, -sin yaw)); a missing yaw reads as 0.
 */
export async function sidestep(ctx: ReflexContext, bearing: string): Promise<ReflexOutcome> {
  const sign = bearing === 'right' ? -1 : 1;
  const yaw = ctx.view.yaw ?? 0;
  const here = ctx.view.position;
  const goal = {
    x: here.x + 0.5 + sign * Math.cos(yaw) * SIDESTEP_BLOCKS,
    y: here.y,
    z: here.z + 0.5 - sign * Math.sin(yaw) * SIDESTEP_BLOCKS,
  };
  const limit = deadline(ctx.signal, SIDESTEP_LIMIT_MS * ctx.timeScale);
  const move = await moveNear(ctx.bot, goal, SIDESTEP_RANGE, {
    digTier: false,
    signal: limit.signal,
    timeScale: ctx.timeScale,
  }).finally(() => limit.clear());
  const side = sign > 0 ? 'right' : 'left';
  if (move.ok) return { result: 'handled', detail: `arrow from ${bearing}: sidestepped ${side}` };
  return { result: 'failed', detail: `arrow from ${bearing}: sidestep ended ${move.reason}` };
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
          digTier: false,
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
