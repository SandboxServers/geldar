import type { MindEvent } from '@geldar/animus/src/ports/body.ts';
import { describe, expect, it } from 'vitest';
import { deathHandler } from './death.ts';
import type { EventBase, MapContext } from './types.ts';

const base: EventBase = { seq: 3, tick: 20, atMs: 0, wakeOn: null };
const ctx = { runs: new Map() } as unknown as MapContext;

function death(payload: Record<string, unknown>): MindEvent {
  return {
    type: 'death',
    lifeId: 'life-1',
    tick: 20,
    at: '2026-11-11T00:00:00Z',
    payload,
  } as unknown as MindEvent;
}

describe('death handler: place, drops and respawn point', () => {
  it('carries the place as x and z only, with negative and positive values on each axis', () => {
    const out = deathHandler.map(death({ cause: 'FALL', x: -12, y: 64, z: 9 }), base, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'death', where: { x: -12, z: 9 } });
    expect(out[0]).not.toHaveProperty('where.y');
    const east = deathHandler.map(death({ cause: 'FALL', x: 30, y: 64, z: -30 }), base, ctx);
    expect(east[0]).toMatchObject({ where: { x: 30, z: -30 } });
  });

  it('omits the place when x or z is missing or outside the contract range', () => {
    expect(deathHandler.map(death({ cause: 'FALL', x: 4 }), base, ctx)[0]).not.toHaveProperty(
      'where',
    );
    const far = deathHandler.map(death({ cause: 'FALL', x: 40000000, z: 1 }), base, ctx);
    expect(far[0]).not.toHaveProperty('where');
  });

  it('carries the dropped count and the respawn point', () => {
    const out = deathHandler.map(
      death({ cause: 'FALL', drops: 5, respawn_x: 0, respawn_y: 64, respawn_z: -2 }),
      base,
      ctx,
    );
    expect(out[0]).toMatchObject({ drops: 5, respawn_point: { x: 0, y: 64, z: -2 } });
  });

  it('omits the dropped count when it is absent, negative or not a whole number', () => {
    for (const drops of [undefined, -1, 2.5, 'many']) {
      const out = deathHandler.map(death({ cause: 'FALL', drops }), base, ctx);
      expect(out[0]).not.toHaveProperty('drops');
    }
  });

  it('a death maps to one event, with no second event for the same death', () => {
    const out = deathHandler.map(death({ cause: 'FALL', x: 1, z: 1, drops: 2 }), base, ctx);
    expect(out).toHaveLength(1);
  });

  it('carries the dimension when it is one of the four contract names, and drops it otherwise', () => {
    for (const dimension of ['overworld', 'nether', 'end', 'other']) {
      const out = deathHandler.map(death({ cause: 'FALL', dimension }), base, ctx);
      expect(out[0]).toMatchObject({ dimension });
    }
    for (const dimension of [undefined, 'Nether', 'the_nether', 7]) {
      const out = deathHandler.map(death({ cause: 'FALL', dimension }), base, ctx);
      expect(out[0]).not.toHaveProperty('dimension');
    }
  });

  it('carries each dropped stack by name, count and place, and drops invalid records', () => {
    const out = deathHandler.map(
      death({
        cause: 'FALL',
        drops: 4,
        drop_items: [
          { item: 'oak_log', count: 3, x: 190, y: 61, z: 224 },
          { item: 'stone', count: 1 },
          { item: 'minecraft:stone', count: 1 },
          { item: 'Stone', count: 1 },
          { item: 'dirt', count: 0 },
          { item: 'dirt', count: 2.5 },
          'apple',
        ],
      }),
      base,
      ctx,
    );
    expect(out[0]).toMatchObject({
      drop_items: [
        { item: 'oak_log', count: 3, x: 190, y: 61, z: 224 },
        { item: 'stone', count: 1 },
      ],
    });
  });

  it('omits drop_items when none of the records is valid, and keeps the dropped count', () => {
    const out = deathHandler.map(
      death({ cause: 'FALL', drops: 2, drop_items: [{ item: 'DIRT', count: 2 }] }),
      base,
      ctx,
    );
    expect(out[0]).not.toHaveProperty('drop_items');
    expect(out[0]).toMatchObject({ drops: 2 });
  });

  it('keeps at most 41 stacks, the plugin maximum', () => {
    const many = Array.from({ length: 50 }, () => ({ item: 'dirt', count: 1 }));
    const out = deathHandler.map(death({ cause: 'FALL', drop_items: many }), base, ctx);
    expect((out[0] as { drop_items: unknown[] }).drop_items).toHaveLength(41);
  });
});
