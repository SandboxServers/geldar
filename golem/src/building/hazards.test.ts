import { describe, expect, it } from 'vitest';
import { hazardAt, orderCells } from './hazards.ts';
import type { Cell } from './scaffold.ts';

const key = (c: Cell): string => `${c.x},${c.y},${c.z}`;
/** A world from a map of cell keys to block names; everything else is stone. */
function worldOf(blocks: Record<string, string>) {
  return {
    blockAt: (c: Cell): string => blocks[key(c)] ?? 'stone',
  };
}
const DIRT = [{ name: 'dirt', count: 8 }];

describe('hazardAt', () => {
  it('flags a falling block in the cell or stacked above it', () => {
    const cell: Cell = { x: 0, y: 64, z: 0 };
    expect(hazardAt(cell, worldOf({ '0,65,0': 'sand' }), []).falling).toBe(true);
    expect(hazardAt(cell, worldOf({ '0,64,0': 'gravel' }), []).falling).toBe(true);
    expect(hazardAt(cell, worldOf({ '0,66,0': 'sand' }), []).falling).toBe(false);
    expect(hazardAt(cell, worldOf({ '0,65,0': 'stone' }), []).falling).toBe(false);
  });

  it('detects lava on each of the six faces, and works the cell (never refused)', () => {
    const cell: Cell = { x: 0, y: 64, z: 0 };
    const faces: Cell[] = [
      { x: 1, y: 64, z: 0 },
      { x: -1, y: 64, z: 0 },
      { x: 0, y: 65, z: 0 },
      { x: 0, y: 63, z: 0 },
      { x: 0, y: 64, z: 1 },
      { x: 0, y: 64, z: -1 },
    ];
    for (const f of faces) {
      const advice = hazardAt(cell, worldOf({ [key(f)]: 'lava' }), []);
      expect(advice.fluid, key(f)).toBe('lava');
      expect(advice.retainBlock).toBeNull();
    }
  });

  it('places a retaining block first next to lava when the agent holds one', () => {
    const cell: Cell = { x: 0, y: 64, z: 0 };
    const advice = hazardAt(cell, worldOf({ '0,64,-1': 'lava' }), DIRT);
    expect(advice.fluid).toBe('lava');
    expect(advice.retainBlock).toBe('dirt');
  });

  it('treats source water as fluid and flowing water as none', () => {
    const cell: Cell = { x: 0, y: 64, z: 0 };
    expect(hazardAt(cell, worldOf({ '1,64,0': 'water' }), DIRT).fluid).toBe('water');
    expect(hazardAt(cell, worldOf({ '1,64,0': 'flowing_water' }), DIRT).fluid).toBeNull();
  });
});

describe('orderCells', () => {
  const column: Cell[] = [
    { x: 0, y: 70, z: 0 },
    { x: 0, y: 71, z: 0 },
    { x: 0, y: 72, z: 0 },
  ];
  const sand = worldOf({ '0,70,0': 'sand', '0,71,0': 'sand', '0,72,0': 'sand' });

  it('breaks a sand column top-down', () => {
    expect(orderCells(column, sand, 'break').map(key)).toEqual(['0,72,0', '0,71,0', '0,70,0']);
  });

  it('places a sand column bottom-up', () => {
    expect(orderCells(column, sand, 'place').map(key)).toEqual(['0,70,0', '0,71,0', '0,72,0']);
  });

  it('keeps a non-falling cell where it was in the list', () => {
    const mixed: Cell[] = [
      { x: 0, y: 70, z: 0 },
      { x: 5, y: 70, z: 5 },
      { x: 0, y: 72, z: 0 },
    ];
    const world = worldOf({ '0,72,0': 'sand', '0,70,0': 'sand' });
    expect(orderCells(mixed, world, 'break').map(key)).toEqual(['0,72,0', '5,70,5', '0,70,0']);
  });
});
