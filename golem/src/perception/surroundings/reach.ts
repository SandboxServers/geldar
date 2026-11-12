import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';

/** Reach: what the agent can get to from where it stands (PX-8a). Empty until that card fills it. */
export function reach(_bot: Bot): Partial<Snapshot['surroundings']> {
  return {};
}
