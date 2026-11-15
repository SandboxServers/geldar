import type { Place } from '../body/where.ts';
import type { HurtEvent } from './hurt.ts';

/**
 * The one log line a hurt leaves in the Body's log: what hit it, how hard, the bearing when there is
 * one, and where the Body stood. The damage event itself carries no coordinates (decision 0143).
 */
export function hurtLogLine(hurt: HurtEvent, place: Place, worldTick: number): string {
  return JSON.stringify({
    event: 'hurt',
    world_tick: worldTick,
    source: hurt.source,
    amount: hurt.amount,
    bearing: hurt.bearing ?? null,
    ...(hurt.attacker === undefined ? {} : { attacker: hurt.attacker }),
    ...place,
  });
}
