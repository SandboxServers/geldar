import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';

/** Threat and sight: hostile flags and closing state for entities (PX-2b, PX-3b). Empty until then. */
export function threatSight(_bot: Bot): Partial<Snapshot['surroundings']> {
  return {};
}
