import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';

/**
 * Self flags, armor, air and tool wear (PX-3b, PX-3c). Armor is computed in wave 4 from the
 * equipped items; 0 until then.
 */
export function gearFlags(_bot: Bot): Partial<Snapshot['self']> {
  return { armor: 0 };
}
