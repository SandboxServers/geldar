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

const DIMENSIONS = ['overworld', 'nether', 'end', 'other'] as const;
const ITEM_NAME = /^[a-z0-9_./-]{1,64}$/;
/** The plugin sends at most this many stacks (the contract's maxItems). */
const MAX_STACKS = 41;

/** One dropped stack, as the death event carries it. */
type Stack = { item: string; count: number; x?: number; y?: number; z?: number };

/** A contract dimension name, or undefined. */
function dimension(v: unknown): (typeof DIMENSIONS)[number] | undefined {
  return DIMENSIONS.find((d) => d === v);
}

/** One dropped stack: a valid item name and count, with its place when the server read it. */
function stack(v: unknown): Stack | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const r = v as Record<string, unknown>;
  const n = count(r.count);
  if (typeof r.item !== 'string' || !ITEM_NAME.test(r.item) || n === undefined || n < 1) {
    return undefined;
  }
  const x = blockCoord(r.x);
  const y = blockCoord(r.y);
  const z = blockCoord(r.z);
  return {
    item: r.item,
    count: n,
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
    ...(z !== undefined ? { z } : {}),
  };
}

/** The dropped stacks that are valid, at most the contract's maximum, or undefined when none is. */
function stacks(v: unknown): Stack[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const valid = v
    .slice(0, MAX_STACKS)
    .map(stack)
    .filter((s): s is Stack => s !== undefined);
  return valid.length > 0 ? valid : undefined;
}

export const deathHandler = defineMindHandler('death', (event, base) => {
  const p = event.payload as Record<string, unknown>;
  const x = blockCoord(p.x);
  const z = blockCoord(p.z);
  const drops = count(p.drops);
  const dropItems = stacks(p.drop_items);
  const dim = dimension(p.dimension);
  const rx = blockCoord(p.respawn_x);
  const ry = blockCoord(p.respawn_y);
  const rz = blockCoord(p.respawn_z);
  return [
    {
      ...base,
      kind: 'death',
      cause: deathCause(p.cause),
      ...(x !== undefined && z !== undefined ? { where: { x, z } } : {}),
      ...(dim !== undefined ? { dimension: dim } : {}),
      ...(drops !== undefined ? { drops } : {}),
      ...(dropItems !== undefined ? { drop_items: dropItems } : {}),
      ...(rx !== undefined && ry !== undefined && rz !== undefined
        ? { respawn_point: { x: rx, y: ry, z: rz } }
        : {}),
    },
  ];
});
