import { describe, expect, it } from 'vitest';
import { type Cell, type StandBlock, standFor } from './stand.ts';

const AIR: StandBlock = { name: 'air', boundingBox: 'empty' };
const STONE: StandBlock = { name: 'stone', boundingBox: 'block' };
const WATER: StandBlock = { name: 'water', boundingBox: 'empty' };
const SAND: StandBlock = { name: 'sand', boundingBox: 'block' };

/** Eye height 1.62 over the feet cell; reach 4.5 from the eye to the target centre. */
function inReach(stand: Cell, target: Cell): boolean {
  const dx = target.x - stand.x;
  const dy = target.y + 0.5 - (stand.y + 1.62);
  const dz = target.z - stand.z;
  return dx * dx + dy * dy + dz * dz <= 4.5 * 4.5;
}

/** Stone floor at y 0 over x and z in -10..10, air above; unloaded outside that box. */
function openField(x: number, y: number, z: number): StandBlock | null {
  if (x < -10 || x > 10 || z < -10 || z > 10 || y < 0 || y > 4) return null;
  return y === 0 ? STONE : AIR;
}

/** The open field plus a stone wall across x = 2 at y 1..3. */
function wallAtX2(x: number, y: number, z: number): StandBlock | null {
  if (x === 2 && y >= 1 && y <= 3 && z >= -10 && z <= 10) return STONE;
  return openField(x, y, z);
}

/** The open field plus stone walls at z = -1 and z = 1, so only z = 0 is a corridor. */
function corridor(x: number, y: number, z: number): StandBlock | null {
  if ((z === -1 || z === 1) && y >= 1 && y <= 3 && x >= -10 && x <= 10) return STONE;
  return openField(x, y, z);
}

describe('standFor', () => {
  it('open field: picks the nearest cell within reach, not a batch cell', () => {
    const target = { x: 0, y: 1, z: 0 };
    const stand = standFor([target], openField, { x: -6, y: 1, z: 0 });
    expect(stand).toEqual({ x: -4, y: 1, z: 0 });
    expect(inReach(stand as Cell, target)).toBe(true);
  });

  it('a wall that blocks sight from the west side: the stand is on the east side', () => {
    const target = { x: 4, y: 1, z: 0 };
    const stand = standFor([target], wallAtX2, { x: -3, y: 1, z: 0 });
    expect(stand).not.toBe('none');
    expect((stand as Cell).x).toBeGreaterThanOrEqual(3);
    expect(inReach(stand as Cell, target)).toBe(true);
  });

  it('a 1-wide corridor: the stand stays in the corridor', () => {
    const target = { x: 3, y: 1, z: 0 };
    const stand = standFor([target], corridor, { x: -6, y: 1, z: 0 });
    // Reach 4.5 from the target at x = 3 leaves x = -1 as the furthest west cell in reach.
    expect(stand).toEqual({ x: -1, y: 1, z: 0 });
  });

  it('avoids liquid floors and a cell under falling sand', () => {
    const target = { x: 2, y: 1, z: 0 };
    const pond = (x: number, y: number, z: number): StandBlock | null => {
      if (x <= 0 && y === 0) return WATER;
      if (x === 1 && y === 3 && z === 0) return SAND;
      return openField(x, y, z);
    };
    const stand = standFor([target], pond, { x: -6, y: 1, z: 0 });
    expect(stand).not.toBe('none');
    expect((stand as Cell).x).toBeGreaterThanOrEqual(1);
    expect(stand).not.toEqual({ x: 1, y: 1, z: 0 });
  });

  it('a batch with no valid stand returns none; so does an empty batch', () => {
    const solid = (x: number, y: number, z: number): StandBlock | null =>
      x < -10 || x > 10 || z < -10 || z > 10 || y < 0 || y > 4 ? null : STONE;
    expect(standFor([{ x: 0, y: 1, z: 0 }], solid)).toBe('none');
    expect(standFor([], openField)).toBe('none');
    expect(standFor([{ x: 0, y: 1, z: 0 }], () => null)).toBe('none');
  });
});
