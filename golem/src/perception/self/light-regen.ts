import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';

/** Light and regeneration for `self` (PX-3a). Empty until that card fills it. */
export function lightRegen(_bot: Bot): Partial<Snapshot['self']> {
  return {};
}
