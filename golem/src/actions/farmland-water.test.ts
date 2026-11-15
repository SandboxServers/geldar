import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { FARMLAND_FACT, farmlandFact } from './farmland-water.ts';

const FARMLAND = new Vec3(0, 63, 0);

function key(p: Vec3): string {
  return `${p.x},${p.y},${p.z}`;
}

/** A fake bot whose cells read as air, except the `water` cells and the `unloaded` ones (null), by `x,y,z`. */
function fakeBot(water: string[] = [], unloaded: string[] = []): Bot {
  const wet = new Set(water);
  const gone = new Set(unloaded);
  return {
    blockAt: (p: Vec3) => {
      if (gone.has(key(p))) return null;
      return { name: wet.has(key(p)) ? 'water' : 'air', position: p };
    },
  } as unknown as Bot;
}

describe('farmlandFact: water within 4 blocks, at the farmland height or one above', () => {
  it('is moist when water is 4 blocks away on the same level', () => {
    expect(farmlandFact(fakeBot(['4,63,0']), FARMLAND)).toBe(FARMLAND_FACT.moist);
  });

  it('is moist at the corner of the box, 4 blocks out on both axes', () => {
    expect(farmlandFact(fakeBot(['-4,63,-4']), FARMLAND)).toBe(FARMLAND_FACT.moist);
  });

  it('is dry when the nearest water is 5 blocks away on the same level', () => {
    expect(farmlandFact(fakeBot(['5,63,0']), FARMLAND)).toBe(FARMLAND_FACT.dry);
  });

  it('is dry when the water is 2 blocks below the farmland', () => {
    expect(farmlandFact(fakeBot(['0,61,0']), FARMLAND)).toBe(FARMLAND_FACT.dry);
  });

  it('is moist when the water is one block above the farmland', () => {
    expect(farmlandFact(fakeBot(['0,64,0']), FARMLAND)).toBe(FARMLAND_FACT.moist);
  });

  it('gives no fact when a cell of the box is not loaded and no water is seen', () => {
    expect(farmlandFact(fakeBot([], ['2,63,2']), FARMLAND)).toBeUndefined();
  });

  it('still says moist when water is seen beside an unloaded cell', () => {
    expect(farmlandFact(fakeBot(['4,63,0'], ['2,63,2']), FARMLAND)).toBe(FARMLAND_FACT.moist);
  });

  it('uses the fixed texts', () => {
    expect(FARMLAND_FACT.moist).toBe('this farmland is moist: water is within 4 blocks');
    expect(FARMLAND_FACT.dry).toBe('this farmland is dry: no water within 4 blocks');
  });
});
