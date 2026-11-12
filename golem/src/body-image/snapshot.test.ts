import { describe, expect, it } from 'vitest';
import { copyBlockBox, SNAPSHOT_RADIUS, snapshotWorld } from './snapshot.ts';

// Loaded for x up to 10; everything above y 60 is air; below is stone.
const read = (x: number, y: number) => {
  if (x > 10) return null;
  return y < 60 ? 'stone' : 'air';
};

describe('copyBlockBox', () => {
  it('copies a bounded box around the centre: 67 cells a side, not more', () => {
    const snap = copyBlockBox(() => 'stone', { x: 0.5, y: 64, z: 0.5 });
    expect(snap.size).toEqual({ x: 67, y: 67, z: 67 });
    expect(snap.cells.length).toBe(67 * 67 * 67);
  });

  it('reaches one block past the radius on each side of the centre cell', () => {
    const world = snapshotWorld(copyBlockBox(() => 'stone', { x: 0.5, y: 64, z: 0.5 }));
    expect(world.blockAt(-SNAPSHOT_RADIUS, 64, 0)).toBe('stone');
    expect(world.blockAt(SNAPSHOT_RADIUS, 64, 0)).toBe('stone');
    expect(world.blockAt(-SNAPSHOT_RADIUS - 1, 64, 0)).toBe('stone');
    expect(world.blockAt(-SNAPSHOT_RADIUS - 2, 64, 0)).toBeNull();
  });
});

describe('snapshotWorld: unloaded and outside read as null (sky)', () => {
  const world = snapshotWorld(copyBlockBox(read, { x: 0.5, y: 64, z: 0.5 }));

  it('a cell the Body had not loaded reads as null, not as air or stone', () => {
    expect(world.blockAt(11, 64, 0)).toBeNull();
    expect(world.blockAt(20, 10, 0)).toBeNull();
  });

  it('a loaded cell reads as its block name', () => {
    expect(world.blockAt(0, 59, 0)).toBe('stone');
    expect(world.blockAt(0, 64, 0)).toBe('air');
  });

  it('a cell outside the copied box reads as null', () => {
    expect(world.blockAt(1000, 64, 0)).toBeNull();
    expect(world.blockAt(0, -1000, 0)).toBeNull();
  });
});
