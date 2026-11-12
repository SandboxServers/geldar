import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';

/** Sky and ground for `self` (PX-2b). Empty until that card fills it. */
export function skyGround(_bot: Bot): Partial<Snapshot['self']> {
  return {};
}
