import { describe, expect, it } from 'vitest';
import { type BlockAt, nearestSafeStand } from './retreat-spot.ts';

/**
 * A small world: `solid` cells are stone, `leaves` cells are oak leaves, `water` cells are water,
 * every other cell is air. `unloaded` cells return null, as an unloaded chunk does.
 */
function world(
  spec: { solid?: string[]; leaves?: string[]; water?: string[]; unloaded?: string[] } = {},
): BlockAt {
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  const solid = new Set(spec.solid ?? []);
  const leaves = new Set(spec.leaves ?? []);
  const water = new Set(spec.water ?? []);
  const unloaded = new Set(spec.unloaded ?? []);
  return (x, y, z) => {
    const k = key(x, y, z);
    if (unloaded.has(k)) return null;
    if (leaves.has(k)) return { name: 'oak_leaves', boundingBox: 'block' };
    if (water.has(k)) return { name: 'water', boundingBox: 'liquid' };
    if (solid.has(k)) return { name: 'stone', boundingBox: 'block' };
    return { name: 'air', boundingBox: 'empty' };
  };
}

/** A flat floor of stone at y 63 across the test area, so every cell above it has ground below. */
function floor(extra: { leaves?: string[]; water?: string[]; unloaded?: string[] } = {}): BlockAt {
  const solid: string[] = [];
  for (let x = -10; x <= 10; x++) {
    for (let z = -10; z <= 10; z++) solid.push(`${x},63,${z}`);
  }
  return world({ solid, ...extra });
}

describe('nearestSafeStand (retreat never walks into the canopy)', () => {
  it('keeps the spot when it is safe ground with air around it', () => {
    expect(nearestSafeStand(floor(), { x: 0, y: 64, z: 0 })).toEqual({ x: 0, y: 64, z: 0 });
  });

  it('refuses a spawn standing on leaves and walks to the nearest bare ground', () => {
    // The spawn cell sits on a leaf block at y 63, the canopy the spawn trap is made of.
    const at = floor({ leaves: ['0,63,0', '1,63,0'] });
    const stand = nearestSafeStand(at, { x: 0, y: 64, z: 0 });
    if (stand === null) throw new Error('no safe stand found on the canopy');
    expect(at(stand.x, stand.y - 1, stand.z)?.name).toBe('stone');
    expect(stand).not.toEqual({ x: 0, y: 64, z: 0 });
  });

  it('refuses a spawn with leaves overhead, though its ground is stone', () => {
    const at = floor({ leaves: ['0,66,0'] });
    expect(nearestSafeStand(at, { x: 0, y: 64, z: 0 })).not.toEqual({ x: 0, y: 64, z: 0 });
  });

  it('refuses a spawn that is inside leaves', () => {
    const at = floor({ leaves: ['0,64,0'] });
    expect(nearestSafeStand(at, { x: 0, y: 64, z: 0 })).not.toEqual({ x: 0, y: 64, z: 0 });
  });

  it('refuses a spawn over water and takes the ground beside it', () => {
    const at = floor({ water: ['0,63,0'] });
    const stand = nearestSafeStand(at, { x: 0, y: 64, z: 0 });
    expect(stand).not.toBeNull();
    expect(stand).not.toEqual({ x: 0, y: 64, z: 0 });
  });

  it('treats an unloaded cell as unsafe', () => {
    const at = floor({ unloaded: ['0,64,0', '0,65,0', '0,66,0'] });
    expect(nearestSafeStand(at, { x: 0, y: 64, z: 0 })).not.toEqual({ x: 0, y: 64, z: 0 });
  });

  it('finds ground one block below the spot when that is the nearest safe stand', () => {
    // Air at the spot's own ground: the stand is one lower, on the stone under it.
    const at = world({ solid: ['0,62,0'] });
    expect(nearestSafeStand(at, { x: 0, y: 64, z: 0 })).toEqual({ x: 0, y: 63, z: 0 });
  });

  it('returns null when no safe stand is within reach, so the Body stays and fights', () => {
    const everywhereLeaves: BlockAt = () => ({ name: 'oak_leaves', boundingBox: 'block' });
    expect(nearestSafeStand(everywhereLeaves, { x: 0, y: 64, z: 0 })).toBeNull();
  });

  it('breaks ties by lower y, then x, then z so the choice is stable', () => {
    // Two stands at the same distance: (1,64,0) and (-1,64,0) are both on the floor at y 64.
    const at = floor({ leaves: ['0,64,0', '0,63,0'] });
    const first = nearestSafeStand(at, { x: 0, y: 64, z: 0 });
    expect(nearestSafeStand(at, { x: 0, y: 64, z: 0 })).toEqual(first);
    expect(first).toEqual({ x: -1, y: 64, z: 0 });
  });
});
