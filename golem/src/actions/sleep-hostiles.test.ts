import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { SCENE_REGISTRY } from './sleep.fakes.ts';
import { hostilesAroundBed, monstersFact } from './sleep-hostiles.ts';

/** The bed head the box is measured from. */
const HEAD = new Vec3(0, 64, 0);

/** A named entity at a position; the default is one block east of the head, on its level. */
function at(name: string, x: number, y = 64, z = 0): { name: string; position: Vec3 } {
  return { name, position: new Vec3(x, y, z) };
}

/** The full fact the bed refusal states for these entities around HEAD. */
function factFor(entities: { name: string; position: Vec3 }[]): string {
  return monstersFact(hostilesAroundBed(entities, HEAD, SCENE_REGISTRY));
}

describe('hostilesAroundBed: which entities vanilla counts', () => {
  it('names the zombie, not the iron golem the Body can see', () => {
    expect(factFor([at('iron_golem', 4), at('zombie', 6)])).toBe(
      'there are monsters nearby: zombie 6 blocks away',
    );
  });

  it('does not count a passive mob such as a snow golem', () => {
    expect(factFor([at('snow_golem', 2)])).toBe('there are monsters nearby: none in view');
  });

  it('names enderman and zombified_piglin, which are hostile mobs', () => {
    expect(factFor([at('enderman', 2)])).toBe('there are monsters nearby: enderman 2 blocks away');
    expect(factFor([at('zombified_piglin', 3)])).toBe(
      'there are monsters nearby: zombified_piglin 3 blocks away',
    );
  });

  it('does not name a creeper at dy 6, above the box', () => {
    expect(factFor([at('creeper', 0, 70, 0)])).toBe('there are monsters nearby: none in view');
  });

  it('reads an entity with no registry entry as not hostile', () => {
    expect(factFor([at('mystery_mob', 2)])).toBe('there are monsters nearby: none in view');
  });
});

describe('hostilesAroundBed: the box, on every axis and sign', () => {
  // The box is vanilla's: dx -8..7, dy -6..4, dz -8..7 around the head (bed.js monsterRange).
  it.each([
    ['east, x=+7 is inside', at('zombie', 7), 'zombie 7 blocks away'],
    ['east, x=+8 is outside', at('zombie', 8), 'none in view'],
    ['west, x=-8 is inside', at('zombie', -8), 'zombie 8 blocks away'],
    ['west, x=-9 is outside', at('zombie', -9), 'none in view'],
    ['south, z=+7 is inside', at('zombie', 0, 64, 7), 'zombie 7 blocks away'],
    ['south, z=+8 is outside', at('zombie', 0, 64, 8), 'none in view'],
    ['north, z=-8 is inside', at('zombie', 0, 64, -8), 'zombie 8 blocks away'],
    ['north, z=-9 is outside', at('zombie', 0, 64, -9), 'none in view'],
    ['up, y=+4 is inside', at('zombie', 0, 68, 0), 'zombie 4 blocks away'],
    ['up, y=+5 is outside', at('zombie', 0, 69, 0), 'none in view'],
    ['down, y=-6 is inside', at('zombie', 0, 58, 0), 'zombie 6 blocks away'],
    ['down, y=-7 is outside', at('zombie', 0, 57, 0), 'none in view'],
  ])('%s', (_label, entity, expected) => {
    expect(factFor([entity])).toBe(
      expected === 'none in view'
        ? 'there are monsters nearby: none in view'
        : `there are monsters nearby: ${expected}`,
    );
  });
});

describe('monstersFact: the text', () => {
  it('names the nearest first and at most three', () => {
    expect(
      factFor([at('zombie', 4), at('creeper', 2), at('enderman', 3), at('zombified_piglin', 5)]),
    ).toBe(
      'there are monsters nearby: creeper 2 blocks away, enderman 3 blocks away, zombie 4 blocks away',
    );
  });

  it('lists two hostiles nearest first', () => {
    expect(factFor([at('zombie', 7), at('creeper', 3)])).toBe(
      'there are monsters nearby: creeper 3 blocks away, zombie 7 blocks away',
    );
  });

  it('says 1 block away at distance 1, singular', () => {
    expect(factFor([at('creeper', 1)])).toBe('there are monsters nearby: creeper 1 block away');
  });

  it('rounds the distance to a whole block with Math.round', () => {
    expect(factFor([at('zombie', 5.4)])).toBe('there are monsters nearby: zombie 5 blocks away');
    expect(factFor([at('zombie', 5.6)])).toBe('there are monsters nearby: zombie 6 blocks away');
  });

  it('says none in view when no counted hostile is in the box', () => {
    expect(factFor([at('iron_golem', 2), at('zombie', 20)])).toBe(
      'there are monsters nearby: none in view',
    );
    expect(monstersFact([])).toBe('there are monsters nearby: none in view');
  });
});
