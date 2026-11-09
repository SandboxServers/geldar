import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { createPerception } from './index.ts';
import { FakeWorld } from './perception.fakes.ts';

// The bot stands at (0.5, 64, 0.5); its eyes are in block (0, 65, 0).

function zombie(world: FakeWorld, id: number, x: number, z: number, y = 64): void {
  world.entities[id] = {
    type: 'hostile',
    name: 'zombie',
    position: new Vec3(x, y, z),
    height: 1.95,
  };
}

describe('authorized entities', () => {
  it('reports an entity in line of sight with its distance to one decimal and a compass direction', () => {
    const world = new FakeWorld();
    zombie(world, 1, 0.5, -9.5);
    const { entities } = createPerception(world.bot).surroundings();
    expect(entities).toEqual([{ type: 'zombie', distance: 10, direction: 'north' }]);
    world.entities[1] = {
      type: 'hostile',
      name: 'zombie',
      position: new Vec3(3.5, 64, 4.5),
      height: 1.95,
    };
    expect(createPerception(world.bot).surroundings().entities).toEqual([
      { type: 'zombie', distance: 5, direction: 'south_east' },
    ]);
  });

  // Every axis and both signs: the entity is hidden by a block between it and the eyes.
  it.each([
    ['east', 8.5, 0.5, 4, 0],
    ['west', -7.5, 0.5, -3, 0],
    ['south', 0.5, 8.5, 0, 4],
    ['north', 0.5, -7.5, 0, -3],
  ])('an entity to the %s behind a block is not reported', (_label, x, z, wx, wz) => {
    const world = new FakeWorld();
    zombie(world, 1, x, z);
    expect(createPerception(world.bot).surroundings().entities).toHaveLength(1);
    world.set('stone', wx, 65, wz);
    world.set('stone', wx, 64, wz);
    expect(createPerception(world.bot).surroundings().entities).toEqual([]);
  });

  it('does not report an entity above or below behind a block', () => {
    const above = new FakeWorld();
    zombie(above, 1, 0.5, 0.5, 70);
    above.set('stone', 0, 67, 0);
    expect(createPerception(above.bot).surroundings().entities).toEqual([]);
    const below = new FakeWorld();
    zombie(below, 1, 0.5, 0.5, 58);
    below.set('stone', 0, 62, 0);
    expect(createPerception(below.bot).surroundings().entities).toEqual([]);
  });

  it('ignores entities past 24 blocks', () => {
    const world = new FakeWorld();
    zombie(world, 1, 0.5, -26);
    zombie(world, 2, 0.5, -20);
    expect(createPerception(world.bot).surroundings().entities).toHaveLength(1);
  });

  it('reports other players as agents with name, distance and held item, health unknown', () => {
    const world = new FakeWorld();
    world.entities[1] = {
      type: 'player',
      username: 'Pike',
      position: new Vec3(0.5, 64, 6.5),
      height: 1.8,
      heldItem: { name: 'iron_sword' },
    };
    world.entities[2] = { type: 'player', username: 'Kestrel', position: new Vec3(1.5, 64, 0.5) };
    world.entities[3] = {
      type: 'player',
      username: 'Hidden',
      position: new Vec3(0.5, 64, -6.5),
      height: 1.8,
    };
    world.set('stone', 0, 65, -3);
    world.set('stone', 0, 64, -3);
    const { agents, entities } = createPerception(world.bot).surroundings();
    expect(agents).toEqual([
      { name: 'Pike', distance: 6, held_item: 'iron_sword', health_estimate: 'unknown' },
    ]);
    expect(entities).toEqual([]);
  });

  it('caps the lists and keeps the nearest', () => {
    const world = new FakeWorld();
    for (let i = 0; i < 40; i++) zombie(world, i, 0.5, -1.5 - i * 0.5);
    const { entities } = createPerception(world.bot).surroundings();
    expect(entities).toHaveLength(32);
    expect(entities[0]?.distance).toBe(2);
    expect(entities[31]?.distance).toBe(17.5);
  });
});
