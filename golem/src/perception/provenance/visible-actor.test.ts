import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { lifeIdFor } from '../../registry.ts';
import { type HurtEvent, HurtReporter } from '../hurt.ts';
import { watchHurts } from '../hurt-trigger.ts';
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
      basis: 'seen',
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

  it('a loose spelling of a visible player is not named', () => {
    const world = new FakeWorld();
    world.entities[2] = {
      type: 'player',
      username: 'ag_bob',
      position: new Vec3(0.5, 64, 2.5),
    };
    expect(observedActor(asBot(world), 'Bob')).toBeNull();
    expect(observedActor(asBot(world), 'bob')).toBeNull();
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

describe('observedActor as the watchHurts resolver', () => {
  it('a hurt caused by a visible player names that player', () => {
    const world = new FakeWorld();
    // The cause needs an id that differs from the Body's (which has none), as a mineflayer entity does.
    world.entities[2] = Object.assign(
      { type: 'player', username: 'ag_ada_01', position: new Vec3(0.5, 64, 2.5) },
      { id: 2 },
    );
    const bot = Object.assign(new EventEmitter(), asBot(world), { health: 20 });
    const seen: HurtEvent[] = [];
    const reporter = new HurtReporter((hurt) => seen.push(hurt));
    watchHurts(
      bot as unknown as Bot,
      reporter,
      () => 1,
      (username) => observedActor(bot as unknown as Bot, username, (u) => `life_${u}`),
    );
    bot.emit('entityHurt', bot.entity, world.entities[2]);
    bot.health = 15;
    bot.emit('health');
    expect(seen[0]?.actor).toEqual({ name: 'ag_ada_01', life: 'life_ag_ada_01', basis: 'seen' });
  });
});
