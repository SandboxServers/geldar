import { describe, expect, it } from 'vitest';
import { createPerception } from './index.ts';
import { FakeWorld } from './perception.fakes.ts';

// The bot stands at (0.5, 64, 0.5): the eye row is y 65. A furnace three blocks east is in sight.

function furnaceReport(properties: Record<string, unknown> | null) {
  const world = new FakeWorld();
  const furnace = world.set('furnace', 3, 65, 0);
  if (properties !== null) Object.assign(furnace, { getProperties: () => properties });
  return createPerception(world.bot).surroundings().notable_blocks;
}

describe('furnace lit state', () => {
  it('reports lit true for a furnace whose lit state is true', () => {
    expect(furnaceReport({ lit: true })).toEqual([
      { type: 'furnace', x: 3, y: 65, z: 0, lit: true },
    ]);
  });

  it('reports lit false for a furnace whose lit state is false', () => {
    expect(furnaceReport({ lit: false })).toEqual([
      { type: 'furnace', x: 3, y: 65, z: 0, lit: false },
    ]);
  });

  it('reads the string form of the lit state', () => {
    expect(furnaceReport({ lit: 'true' })).toEqual([
      { type: 'furnace', x: 3, y: 65, z: 0, lit: true },
    ]);
  });

  it('reports lit false for a furnace that gives no block properties', () => {
    expect(furnaceReport(null)).toEqual([{ type: 'furnace', x: 3, y: 65, z: 0, lit: false }]);
  });

  it('leaves lit off a chest', () => {
    const world = new FakeWorld();
    world.set('chest', 3, 65, 0);
    expect(createPerception(world.bot).surroundings().notable_blocks).toEqual([
      { type: 'chest', x: 3, y: 65, z: 0 },
    ]);
  });
});
