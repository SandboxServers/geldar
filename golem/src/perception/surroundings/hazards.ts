import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';

/** Hazards near the agent (PX-5). Empty until that card fills it. */
export function hazards(_bot: Bot): Partial<Snapshot['surroundings']> {
  return {};
}
