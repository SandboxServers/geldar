import type { Reflex, ReflexContext, ReflexOutcome, Trigger } from '../reflex.ts';
import type { BodyView } from '../view.ts';
import { blockedPathReflex } from './blocked-path.ts';
import { idleStuckReflex, mayUnstick, noteShelterRefusal, runUnstick } from './idle-stuck.ts';
import { burrowPaused, panicBurrowReflex } from './panic-burrow.ts';
import { dangers } from './threats.ts';
import { unstickReflex } from './unstick.ts';

/** Head light at or below this is dark: hostile mobs spawn at light 7 or less (PX-7). */
export const DARK_LIGHT = 7;
/** A hostile this close (blocks) in the dark makes the Body take shelter (PX-7). */
export const DARK_HOSTILE_RADIUS = 8;
/** Ticks between two shelters: the burrow is dug at most once per 10 s (PX-7). */
const SHELTER_COOLDOWN_TICKS = 200;
/** The first backoff after an abandoned shelter (world ticks, 20 s); each failure in a row doubles it. */
const BACKOFF_BASE_TICKS = 400;
/** The longest backoff (world ticks, 5 min). */
const BACKOFF_CAP_TICKS = 6000;
/** Nominal world ticks per second, for the seconds shown in a log line. */
const TICKS_PER_SECOND = 20;
/** Why the last shelter was abandoned, and when the Body may try again. */
interface ShelterBackoff {
  failures: number;
  until: number;
}

/** One backoff per Body view (the runtime keeps one view per Body). */
const backoffs = new WeakMap<BodyView, ShelterBackoff>();

/**
 * Dark shelter (PX-7): in the dark (head light at or below `DARK_LIGHT`) with a danger within
 * `DARK_HOSTILE_RADIUS` blocks in sight, and the Body not already enclosed, the Body seals itself
 * into a wall pocket. A danger is a hostile by the same rule as the other reflexes (`dangers`), so a
 * spider in daylight does not count. The shelter is the panic burrow's own dig and seal, so the run
 * hands over to `panicBurrowReflex` with a night trigger; its refusal and its failures come back as
 * they are. After an `abandoned` run the reflex backs off (20 s, doubling, capped at 5 min) until
 * the light rises above the dark limit, a later run is handled, or the Body respawns. A changed mob
 * set or a move does not end it. A missing light or enclosure read never fires it.
 */
export const darkShelterReflex: Reflex = {
  name: 'dark_shelter',
  priority: 35,
  cooldownTicks: SHELTER_COOLDOWN_TICKS,
  check(view: BodyView): Trigger | null {
    const light = view.lightAtHead;
    if (typeof light !== 'number') return null;
    if (light > DARK_LIGHT) {
      backoffs.delete(view);
      return null;
    }
    if (view.enclosed !== false) return null;
    const hostile = dangers(view, DARK_HOSTILE_RADIUS)[0];
    if (!hostile) return null;
    // The panic burrow's refusal pause covers this reflex too; a changed mob set or a small move does not end a backoff.
    if (burrowPaused(view)) return null;
    const backoff = backoffs.get(view);
    if (backoff && (view.tick ?? 0) < backoff.until) return null;
    return {
      light,
      hostile: hostile.name,
      distance: Math.round(hostile.distance * 10) / 10,
      cause: 'dark',
    };
  },
  async run(_trigger: Trigger, ctx: ReflexContext): Promise<ReflexOutcome> {
    const outcome = await panicBurrowReflex.run(
      { phase: 'night', bed: false, shelter: false },
      ctx,
    );
    if (outcome.result === 'handled') backoffs.delete(ctx.view);
    const refused = outcome.detail?.startsWith('no suitable block') === true;
    if (outcome.result !== 'abandoned') {
      noteShelterRefusal(ctx.view, false);
      return outcome;
    }
    const shelter = backOff(ctx.view, outcome);
    // B2 (decision 0196): the third refusal in a row at one spot runs unstick once, through the same backoff.
    const third = noteShelterRefusal(ctx.view, refused);
    // The B1 guards (no Mind action, not asleep, not riding, no burrow) and the stuck test: a Body
    // that can step off a ledge is not stuck, so B2 does not dig it out.
    if (!third || !mayUnstick(ctx.view) || ctx.view.canStepOff !== false) return shelter;
    const freed = await runUnstick(ctx, 'dark_shelter (3 refusals)');
    return { ...shelter, detail: `${shelter.detail ?? ''}; ${freed.detail ?? ''}` };
  },
};

/** Forgets the backoff of a view (the Body died and respawned, so the old body's refusals do not hold). */
export function forgetShelterBackoff(view: BodyView): void {
  backoffs.delete(view);
}

/** Records an abandoned shelter: the next try waits for a doubled period, and the log line says so. */
function backOff(view: BodyView, outcome: ReflexOutcome): ReflexOutcome {
  const failures = (backoffs.get(view)?.failures ?? 0) + 1;
  const period = Math.min(BACKOFF_BASE_TICKS * 2 ** (failures - 1), BACKOFF_CAP_TICKS);
  backoffs.set(view, { failures, until: (view.tick ?? 0) + period });
  const seconds = Math.round(period / TICKS_PER_SECOND);
  return { ...outcome, detail: `${outcome.detail ?? 'abandoned'}; backing off ${seconds}s` };
}

/**
 * The reflexes of the shelter and path group, ready to hand to the `ReflexRunner`: the panic burrow
 * (night, no bed, no shelter), the dark shelter (PX-7), and the blocked-path reflex. They keep their
 * state per view, so one array serves every Body in the process.
 */
export const shelterReflexes: Reflex[] = [
  panicBurrowReflex,
  darkShelterReflex,
  blockedPathReflex,
  unstickReflex,
  idleStuckReflex,
];
