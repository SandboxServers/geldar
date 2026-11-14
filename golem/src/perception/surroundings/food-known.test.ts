import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { MAX_FOOD_KNOWN } from '../food-memory.ts';
import { FakeWorld } from '../perception.fakes.ts';
import { CROP_MAX_AGE, foodKnown } from './food-known.ts';

/** minecraft-data for the pinned 26.1 line: the block states give each crop's age range. */
const minecraftData = createRequire(import.meta.url)('minecraft-data') as (version: string) => {
  blocksByName: Record<string, unknown>;
};

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

  it('does not record a pumpkin block as food, since a pumpkin is not edible', () => {
    const w = world();
    w.set('pumpkin', 4, 64, 0);
    w.set('melon', 0, 64, 5);
    expect(foodKnown(w.bot).food_known?.map((f) => f.kind)).toEqual(['melon']);
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

  it('says whether a crop is ripe from its age: wheat at age 7 is ripe, at age 3 unripe', () => {
    for (const [age, kind] of [
      [7, 'wheat (ripe)'],
      [3, 'wheat (unripe)'],
    ] as const) {
      const w = world();
      const block = w.set('wheat', 4, 64, 0);
      Object.assign(block, { getProperties: () => ({ age }) });
      expect(foodKnown(w.bot).food_known).toEqual([{ kind, x: 4, y: 64, z: 0 }]);
    }
  });

  it('reads each crop as ripe at its maximum age, which minecraft-data gives as the age state', () => {
    const blocksByName = minecraftData('26.1').blocksByName as Record<
      string,
      { states?: { name: string; num_values?: number }[] } | undefined
    >;
    for (const crop of Object.keys(CROP_MAX_AGE)) {
      const age = blocksByName[crop]?.states?.find((state) => state.name === 'age');
      expect(CROP_MAX_AGE[crop], crop).toBe((age?.num_values ?? -1) - 1);
      const w = world();
      const block = w.set(crop, 4, 64, 0);
      Object.assign(block, { getProperties: () => ({ age: CROP_MAX_AGE[crop] }) });
      expect(foodKnown(w.bot).food_known?.[0]?.kind).toBe(`${crop} (ripe)`);
      Object.assign(block, { getProperties: () => ({ age: (CROP_MAX_AGE[crop] ?? 0) - 1 }) });
      expect(foodKnown(w.bot).food_known?.[0]?.kind).toBe(`${crop} (unripe)`);
    }
  });
});
