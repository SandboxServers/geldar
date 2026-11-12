import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';

/** Containers and furnaces near the agent (PX-6). Empty until that card fills it. */
export function containers(_bot: Bot): Partial<Snapshot['surroundings']> {
  return {};
}
