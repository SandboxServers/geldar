import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { lifeIdFor } from '../../registry.ts';
import { FakeWorld } from '../perception.fakes.ts';
import { observedActor } from './visible-actor.ts';

/** A world with the Body at the origin and stone between its eyes and the cell (0, 64, 2). */
function walled(): FakeWorld {
  const world = new FakeWorld();
  for (const [x, y] of [
    [0, 64],
    [0, 65],
    [1, 64],
    [1, 65],
  ] as const) {
    world.set('stone', x, y, 1);
  }
  return world;
}

const asBot = (world: FakeWorld) => world.bot as unknown as Bot;

describe('observedActor', () => {
  it('names a visible player with the life the lookup gives that name', () => {
    const world = new FakeWorld();
    world.entities[2] = {
      type: 'player',
      username: 'ag_chapman_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    expect(observedActor(asBot(world), 'ag_chapman_01', (u) => `life_${u}`)).toEqual({
      name: 'ag_chapman_01',
      life: 'life_ag_chapman_01',
    });
  });

  it('gives the registry life id by default', () => {
    const world = new FakeWorld();
    world.entities[2] = {
      type: 'player',
      username: 'ag_chapman_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    expect(observedActor(asBot(world), 'ag_chapman_01')?.life).toBe(lifeIdFor('ag_chapman_01'));
  });

  it('a missing username is never named', () => {
    expect(observedActor(asBot(new FakeWorld()), undefined)).toBeNull();
  });

  it("the Body's own name is never named", () => {
    const bot = asBot(new FakeWorld());
    expect(observedActor(bot, bot.username)).toBeNull();
  });

  it('a name that is not a username is refused', () => {
    const world = new FakeWorld();
    world.entities[2] = {
      type: 'player',
      username: 'x.y',
      position: new Vec3(0.5, 64, 2.5),
    };
    expect(observedActor(asBot(world), 'x.y')).toBeNull();
  });

  it('a player out of sight stays anonymous', () => {
    const world = walled();
    world.entities[2] = {
      type: 'player',
      username: 'ag_chapman_01',
      position: new Vec3(0.5, 64, 2.5),
    };
    expect(observedActor(asBot(world), 'ag_chapman_01', () => 'x')).toBeNull();
  });

  it('a player who is not in the world at all stays anonymous', () => {
    expect(observedActor(asBot(new FakeWorld()), 'ag_chapman_01')).toBeNull();
  });
});
