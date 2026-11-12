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
});
