import { hurtSentence } from '@geldar/contract';
import { defineMindHandler } from './types.ts';

/** Bukkit damage causes to what the player is told hit them. The plugin does not send the attacker,
 * so no entity is named and nothing is invented: an explosion is "something", a hit is "something". */
const HURT_CAUSES: Readonly<Record<string, string>> = {
  ENTITY_ATTACK: 'Something hit you.',
  ENTITY_SWEEP_ATTACK: 'Something hit you.',
  PROJECTILE: 'Something shot you.',
  FALL: 'You fell.',
  DROWNING: 'You are drowning.',
  FIRE: 'You are burning.',
  FIRE_TICK: 'You are burning.',
  LAVA: 'You are burning.',
  STARVATION: 'You are starving.',
  ENTITY_EXPLOSION: 'Something exploded next to you.',
  BLOCK_EXPLOSION: 'Something exploded next to you.',
};
const UNKNOWN_HURT = 'You were hurt.';

/** The fixed sentence for a plugin damage cause; the raw value is never copied through. */
export function hurtText(cause: unknown): string {
  return (typeof cause === 'string' ? HURT_CAUSES[cause] : undefined) ?? UNKNOWN_HURT;
}

function amountOf(payload: Record<string, unknown>): number {
  const amount = payload.amount;
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
}

/**
 * The player's line for a damage. A payload with a hurt `source` (PX-1) reads as the hurt sentence, with
 * the bearing and the loss; any other payload keeps the cause wording.
 */
function damageText(payload: Record<string, unknown>, amount: number): string {
  if (typeof payload.source === 'string') {
    return hurtSentence({ source: payload.source, bearing: payload.bearing, amount });
  }
  return hurtText(payload.cause);
}

export const damageHandler = defineMindHandler('damage', (event, base) => {
  const amount = amountOf(event.payload);
  return [{ ...base, kind: 'damage', amount, cause: damageText(event.payload, amount) }];
});
