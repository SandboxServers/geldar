import { defineMindHandler } from './types.ts';

/** Bukkit damage causes, as the plugin exports them, to fixed phrases. Anything else is the last entry. */
const DEATH_CAUSES: Readonly<Record<string, string>> = {
  ENTITY_ATTACK: 'Something struck you down',
  ENTITY_SWEEP_ATTACK: 'Something struck you down',
  PROJECTILE: 'Something shot you',
  FALL: 'You fell too far',
  DROWNING: 'You drowned',
  STARVATION: 'You starved',
  FIRE: 'You burned',
  FIRE_TICK: 'You burned',
  LAVA: 'You fell into lava',
  SUFFOCATION: 'You suffocated',
  VOID: 'You fell out of the world',
  ENTITY_EXPLOSION: 'Something exploded beside you',
  BLOCK_EXPLOSION: 'Something exploded beside you',
  POISON: 'You were poisoned',
  MAGIC: 'You were poisoned',
  WITHER: 'You withered away',
  FREEZE: 'You froze',
};
const UNKNOWN_DEATH = 'Something killed you';

/** The fixed phrase for a plugin death cause; the raw value is never copied through. */
export function deathCause(cause: unknown): string {
  return (typeof cause === 'string' ? DEATH_CAUSES[cause] : undefined) ?? UNKNOWN_DEATH;
}

export const deathHandler = defineMindHandler('death', (event, base) => [
  { ...base, kind: 'death', cause: deathCause(event.payload.cause) },
]);
