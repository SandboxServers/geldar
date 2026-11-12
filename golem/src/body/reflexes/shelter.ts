import type { Reflex, ReflexContext, ReflexOutcome, Trigger } from '../reflex.ts';
import type { BodyView } from '../view.ts';
import { blockedPathReflex } from './blocked-path.ts';
import { panicBurrowReflex } from './panic-burrow.ts';
import { unstickReflex } from './unstick.ts';

/** Head light at or below this is dark: hostile mobs spawn at light 7 or less (PX-7). */
export const DARK_LIGHT = 7;
/** A hostile this close (blocks) in the dark makes the Body take shelter (PX-7). */
export const DARK_HOSTILE_RADIUS = 8;
/** Ticks between two shelters: the burrow is dug at most once per 10 s (PX-7). */
const SHELTER_COOLDOWN_TICKS = 200;

/**
 * Dark shelter (PX-7): in the dark (head light at or below `DARK_LIGHT`) with a hostile within
 * `DARK_HOSTILE_RADIUS` blocks in sight, and the Body not already enclosed, the Body seals itself
 * into a wall pocket. The shelter is the panic burrow's own dig and seal, so the run hands over to
 * `panicBurrowReflex` with a night trigger; its refusal and its failures come back as they are.
 * A missing light or enclosure read never fires it.
 */
export const darkShelterReflex: Reflex = {
  name: 'dark_shelter',
  priority: 35,
  cooldownTicks: SHELTER_COOLDOWN_TICKS,
  check(view: BodyView): Trigger | null {
    const light = view.lightAtHead;
    if (typeof light !== 'number' || light > DARK_LIGHT) return null;
    if (view.enclosed !== false) return null;
    const hostile = view.nearbyHostiles(DARK_HOSTILE_RADIUS)[0];
    if (!hostile) return null;
    return {
      light,
      hostile: hostile.name,
      distance: Math.round(hostile.distance * 10) / 10,
      cause: 'dark',
    };
  },
  run(_trigger: Trigger, ctx: ReflexContext): Promise<ReflexOutcome> {
    return panicBurrowReflex.run({ phase: 'night', bed: false, shelter: false }, ctx);
  },
};

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
];
