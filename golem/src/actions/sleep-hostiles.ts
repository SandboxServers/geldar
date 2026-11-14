import type { Vec3 } from 'vec3';

/** The minecraft-data category Mineflayer's bed check counts as a monster (iron and snow golems are passive). */
const HOSTILE_CATEGORY = 'Hostile mobs';
/**
 * The bed check's box around the bed head, in blocks: x from -8 to +7, y from -6 to +4, z from -8 to +7
 * (Mineflayer's bed.js, `monsterRange` and the corners it offsets from the head).
 */
const BOX = { west: 8, east: 7, down: 6, up: 4, north: 8, south: 7 };
/** The most hostiles the refusal names, nearest first. */
export const MAX_NAMED_HOSTILES = 3;
/** The kinds the text may name: entity names are lower-case words with underscores. */
const KIND = /^[a-z_]+$/;

/** One entity the scan reads: its minecraft-data name and where it stands. Mineflayer's entities fit. */
export interface SceneEntity {
  name?: string | null;
  position: Vec3;
}

/** The part of the registry the scan reads: minecraft-data's entity categories by name. */
export interface EntityRegistry {
  entitiesByName: Record<string, { category?: string } | undefined>;
}

/** A counted hostile: its kind (the entity name) and its distance from the bed head, rounded to a whole block. */
export interface Hostile {
  kind: string;
  blocks: number;
}

/**
 * The hostiles vanilla's bed check counts in the box around the bed `head`, nearest first. The box is tested on
 * the floored position, as Mineflayer does. An entity whose name the registry does not give a hostile category
 * is not counted.
 */
export function hostilesAroundBed(
  entities: Iterable<SceneEntity>,
  head: Vec3,
  registry: EntityRegistry,
): Hostile[] {
  const found: { hostile: Hostile; exact: number }[] = [];
  for (const entity of entities) {
    const name = entity.name ?? '';
    if (registry.entitiesByName[name]?.category !== HOSTILE_CATEGORY) continue;
    const at = entity.position.floored();
    const dx = at.x - head.x;
    const dy = at.y - head.y;
    const dz = at.z - head.z;
    if (
      dx < -BOX.west ||
      dx > BOX.east ||
      dy < -BOX.down ||
      dy > BOX.up ||
      dz < -BOX.north ||
      dz > BOX.south
    ) {
      continue;
    }
    const exact = entity.position.distanceTo(head);
    found.push({
      hostile: { kind: KIND.test(name) ? name : 'hostile', blocks: Math.round(exact) },
      exact,
    });
  }
  return found.sort((a, b) => a.exact - b.exact).map((entry) => entry.hostile);
}

/**
 * The refusal text for Mineflayer's monsters-nearby error: the nearest hostiles, at most three, with their
 * distance in blocks; or `none in view` when the box holds no counted hostile. Facts only.
 */
export function monstersFact(hostiles: readonly Hostile[]): string {
  const lead = 'there are monsters nearby';
  if (hostiles.length === 0) return `${lead}: none in view`;
  const named = hostiles
    .slice(0, MAX_NAMED_HOSTILES)
    .map(({ kind, blocks }) => `${kind} ${blocks} ${blocks === 1 ? 'block' : 'blocks'} away`);
  return `${lead}: ${named.join(', ')}`;
}
