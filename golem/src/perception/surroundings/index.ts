import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { composeProbes, type Probe } from '../compose-probes.ts';
import { containers } from './containers.ts';
import { foodKnown } from './food-known.ts';
import { hazards } from './hazards.ts';
import { reach } from './reach.ts';
import { threatSight } from './threat-sight.ts';

/** The surroundings probes, in the order they are composed. One file per feature; add it here. */
export const SURROUNDINGS_PROBES: readonly Probe<Snapshot['surroundings']>[] = [
  { file: 'hazards', probe: hazards },
  { file: 'containers', probe: containers },
  { file: 'threat-sight', probe: threatSight },
  { file: 'reach', probe: reach },
  { file: 'food-known', probe: foodKnown },
];

/** The surroundings fields the probes return, merged. `perception/index.ts` spreads this in. */
export function surroundingsProbes(bot: Bot): Partial<Snapshot['surroundings']> {
  return composeProbes(SURROUNDINGS_PROBES, bot);
}
