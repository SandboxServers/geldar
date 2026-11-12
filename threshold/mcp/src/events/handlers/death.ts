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

/** The contract's coordinate range (`where` and `respawn_point`). */
const COORD_LIMIT = 30000000;

/** The fixed phrase for a plugin death cause; the raw value is never copied through. */
export function deathCause(cause: unknown): string {
  return (typeof cause === 'string' ? DEATH_CAUSES[cause] : undefined) ?? UNKNOWN_DEATH;
}

/** A whole block coordinate inside the contract's range, or undefined. */
function blockCoord(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isSafeInteger(v) && Math.abs(v) <= COORD_LIMIT
    ? v
    : undefined;
}

/** A whole, non-negative count, or undefined (absent, negative or fractional). */
function count(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
}

export const deathHandler = defineMindHandler('death', (event, base) => {
  const p = event.payload as Record<string, unknown>;
  const x = blockCoord(p.x);
  const z = blockCoord(p.z);
  const drops = count(p.drops);
  const rx = blockCoord(p.respawn_x);
  const ry = blockCoord(p.respawn_y);
  const rz = blockCoord(p.respawn_z);
  return [
    {
      ...base,
      kind: 'death',
      cause: deathCause(p.cause),
      ...(x !== undefined && z !== undefined ? { where: { x, z } } : {}),
      ...(drops !== undefined ? { drops } : {}),
      ...(rx !== undefined && ry !== undefined && rz !== undefined
        ? { respawn_point: { x: rx, y: ry, z: rz } }
        : {}),
    },
  ];
});
