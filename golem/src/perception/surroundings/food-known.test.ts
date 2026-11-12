import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { MAX_FOOD_KNOWN } from '../food-memory.ts';
import { FakeWorld } from '../perception.fakes.ts';
import { foodKnown } from './food-known.ts';

function world(): FakeWorld {
  const w = new FakeWorld();
  w.set('stone', 0, 63, 0);
  return w;
}

describe('food_known probe', () => {
  it('is an empty list when no food has been seen', () => {
    const w = world();
    expect(foodKnown(w.bot)).toEqual({ food_known: [] });
  });

  it('records an animal in sight with its kind and coordinates', () => {
    const w = world();
    w.entities[7] = { type: 'animal', name: 'cow', position: new Vec3(3.5, 64, 2.5) };
    expect(foodKnown(w.bot).food_known).toEqual([{ kind: 'cow', x: 3, y: 64, z: 2 }]);
  });

  it('records crops and berries, and remembers them after they leave sight', () => {
    const w = world();
    w.set('wheat', 4, 64, 0);
    w.set('sweet_berry_bush', 0, 64, 5);
    const bot = w.bot;
    expect(foodKnown(bot).food_known).toHaveLength(2);
    w.clear(4, 64, 0);
    w.clear(0, 64, 5);
    expect(
      foodKnown(bot)
        .food_known?.map((f) => f.kind)
        .sort(),
    ).toEqual(['sweet_berry_bush', 'wheat']);
  });

  it('ignores a hostile mob and a non-food item', () => {
    const w = world();
    w.entities[1] = { type: 'hostile', name: 'zombie', position: new Vec3(2.5, 64, 0.5) };
    w.entities[2] = {
      type: 'other',
      name: 'item',
      position: new Vec3(1.5, 64, 1.5),
      metadata: [],
    };
    expect(foodKnown(w.bot).food_known).toEqual([]);
  });

  it('keeps the newest 10, newest first', () => {
    const w = world();
    const bot = w.bot;
    for (let i = 0; i < MAX_FOOD_KNOWN + 3; i += 1) {
      w.entities[100 + i] = { type: 'animal', name: 'pig', position: new Vec3(1.5 + i, 64, 0.5) };
      foodKnown(bot);
    }
    const known = foodKnown(bot).food_known ?? [];
    expect(known).toHaveLength(MAX_FOOD_KNOWN);
    expect(known[0]?.x).toBe(1 + MAX_FOOD_KNOWN + 2);
  });
});
