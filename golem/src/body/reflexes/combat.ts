import type { Reflex } from '../reflex.ts';
import { createFightOrFleeReflex } from './fight-or-flee.ts';
import { createRetreatReflex } from './retreat.ts';
import { LEGACY_THREAT, type ThreatPolicy } from './threat-policy.ts';

/** The combat reflexes (spec 5.2 rows 2 and 5) for one Body's threat policy (AN-08b). */
export function createCombatReflexes(policy: ThreatPolicy = LEGACY_THREAT): readonly Reflex[] {
  return [createRetreatReflex(policy), createFightOrFleeReflex(policy)];
}

/** The combat reflexes with the legacy policy, for the runtime's `reflexes` option. */
export const combatReflexes: readonly Reflex[] = createCombatReflexes();
