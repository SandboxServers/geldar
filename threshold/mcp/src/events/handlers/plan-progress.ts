import type { MindEvent } from '@geldar/player-core/src/ports/body.ts';
import type { MindHandler } from './types.ts';

/**
 * The `plan_progress` handler (BLD-S3b stub). The MindEvent union does not carry plan_progress yet
 * (player-core owns it), so the type is cast here; no event of that type reaches this handler until the
 * union gains it. The stub maps it to no player event; BLD-S4 replaces the body.
 */
export const planProgressHandler: MindHandler = {
  type: 'plan_progress' as MindEvent['type'],
  map: () => [],
};
