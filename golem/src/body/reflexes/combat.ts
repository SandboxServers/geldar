import type { Reflex } from '../reflex.ts';
import { fightOrFleeReflex } from './fight-or-flee.ts';
import { retreatReflex } from './retreat.ts';

/** The combat reflexes (spec 5.2 rows 2 and 5), for the runtime's `reflexes` option. */
export const combatReflexes: readonly Reflex[] = [retreatReflex, fightOrFleeReflex];
