import { describe, expect, it } from 'vitest';
import { type Cell, cheapestHeld, scaffoldFor } from './scaffold.ts';

const at: Cell = { x: 0, y: 64, z: 0 };
const key = (c: Cell): string => `${c.x},${c.y},${c.z}`;
const noSolid = (): boolean => false;

describe('scaffoldFor', () => {
  it('pillars a cell 6 high with no stand, and removes the scaffold that sits on the plan', () => {
    const target: Cell = { x: 2, y: 70, z: 0 };
    const onPlan: Cell = { x: 0, y: 66, z: 0 };
    const out = scaffoldFor({
      target,
      at,
      stand: 'none',
      held: [{ name: 'dirt', count: 10 }],
      plan: [target, onPlan],
      solid: noSolid,
    });
    expect(out.kind).toBe('scaffold');
    if (out.kind !== 'scaffold') return;
    expect(out.method).toBe('pillar');
    expect(out.block).toBe('dirt');
    expect(out.place.map(key)).toEqual([
      '0,64,0',
      '0,65,0',
      '0,66,0',
      '0,67,0',
      '0,68,0',
      '0,69,0',
    ]);
    expect(out.remove.map(key)).toEqual(['0,66,0']);
  });

  it('keeps the scaffold when no plan cell sits on it', () => {
    const out = scaffoldFor({
      target: { x: 2, y: 70, z: 0 },
      at,
      stand: 'none',
      held: [{ name: 'dirt', count: 6 }],
      plan: [{ x: 2, y: 70, z: 0 }],
      solid: noSolid,
    });
    expect(out.kind === 'scaffold' && out.remove).toEqual([]);
  });

  it('places nothing when a stand exists', () => {
    const out = scaffoldFor({
      target: { x: 2, y: 70, z: 0 },
      at,
      stand: { x: 1, y: 70, z: 0 },
      held: [{ name: 'dirt', count: 64 }],
      plan: [],
      solid: noSolid,
    });
    expect(out).toEqual({ kind: 'not_needed' });
  });

  it('returns missing_materials and places nothing when the agent holds too few', () => {
    const target: Cell = { x: 2, y: 70, z: 0 };
    const short = scaffoldFor({
      target,
      at,
      stand: 'none',
      held: [{ name: 'dirt', count: 5 }],
      plan: [],
      solid: noSolid,
    });
    expect(short).toEqual({ kind: 'missing_materials', needed: 6 });
    const none = scaffoldFor({ target, at, stand: 'none', held: [], plan: [], solid: noSolid });
    expect(none).toEqual({ kind: 'missing_materials', needed: 6 });
  });

  it('uses only the cheapest placeable block the agent holds', () => {
    const out = scaffoldFor({
      target: { x: 2, y: 66, z: 0 },
      at,
      stand: 'none',
      held: [
        { name: 'glass', count: 64 },
        { name: 'stone', count: 9 },
        { name: 'dirt', count: 9 },
      ],
      plan: [],
      solid: noSolid,
    });
    expect(out.kind === 'scaffold' && out.block).toBe('dirt');
    expect(cheapestHeld([{ name: 'glass', count: 64 }])).toBeNull();
  });

  it('bridges across a gap on the agent level, with no pillar, in each direction', () => {
    const solid = (c: Cell): boolean => c.y === 63 && c.x === 0 && c.z === 0;
    const east = scaffoldFor({
      target: { x: 3, y: 64, z: 0 },
      at,
      stand: 'none',
      held: [{ name: 'dirt', count: 8 }],
      plan: [],
      solid,
    });
    expect(east.kind === 'scaffold' && east.method).toBe('bridge');
    expect(east.kind === 'scaffold' && east.place.map(key)).toEqual(['1,63,0', '2,63,0']);

    const west = scaffoldFor({
      target: { x: -3, y: 64, z: 0 },
      at,
      stand: 'none',
      held: [{ name: 'dirt', count: 8 }],
      plan: [],
      solid,
    });
    expect(west.kind === 'scaffold' && west.place.map(key)).toEqual(['-1,63,0', '-2,63,0']);

    const north = scaffoldFor({
      target: { x: 0, y: 64, z: -3 },
      at,
      stand: 'none',
      held: [{ name: 'dirt', count: 8 }],
      plan: [],
      solid: (c) => c.y === 63 && c.x === 0 && c.z === 0,
    });
    expect(north.kind === 'scaffold' && north.place.map(key)).toEqual(['0,63,-1', '0,63,-2']);
  });

  it('never pillars up the target column itself', () => {
    const out = scaffoldFor({
      target: { x: 0, y: 66, z: 0 },
      at,
      stand: 'none',
      held: [{ name: 'dirt', count: 8 }],
      plan: [],
      solid: noSolid,
    });
    expect(out).toEqual({ kind: 'not_needed' });
  });
});
