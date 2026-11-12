import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { composeProbes, type Probe } from '../compose-probes.ts';
import { gearFlags } from './gear-flags.ts';
import { lightRegen } from './light-regen.ts';
import { skyGround } from './sky-ground.ts';

/** The self probes, in the order they are composed. One file per feature; add it here. */
export const SELF_PROBES: readonly Probe<Snapshot['self']>[] = [
  { file: 'sky-ground', probe: skyGround },
  { file: 'light-regen', probe: lightRegen },
  { file: 'gear-flags', probe: gearFlags },
];

/** The self fields the probes return, merged. `snapshot.ts` spreads this into `self`. */
export function selfProbes(bot: Bot): Partial<Snapshot['self']> {
  return composeProbes(SELF_PROBES, bot);
}
