import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { observeEntities, trackedSampleCount } from './entities.ts';
import { ALWAYS_HOSTILE } from './hostile-types.ts';
import { type FakeEntity, FakeWorld } from './perception.fakes.ts';

// The bot stands at (0.5, 64, 0.5); its eyes are in block (0, 65, 0). `clock.age` is the world age.

function mob(
  world: FakeWorld,
  id: number,
  name: string,
  x: number,
  z: number,
  extra: Partial<FakeEntity> = {},
): void {
  world.entities[id] = {
    type: 'hostile',
    name,
    position: new Vec3(x, 64, z),
    height: 1.95,
    ...extra,
  };
}

/** The fake bot with a world clock; the test moves `clock.age` between observations. */
function timedBot(world: FakeWorld, clock: { age: number }): Bot {
  return { ...world.bot, time: clock } as unknown as Bot;
}

/** A mob at (0.5, 64, z) with yaw pi, so its body faces the Body (+z direction from it). */
function facingMob(world: FakeWorld, id: number, name: string, z: number): void {
  mob(world, id, name, 0.5, z, { yaw: Math.PI });
}

describe('threat: always-hostile mobs are flagged by type', () => {
  it.each([...ALWAYS_HOSTILE])('flags %s as hostile', (name) => {
    const world = new FakeWorld();
    mob(world, 1, name, 0.5, -5.5);
    expect(observeEntities(world.bot).entities[0]?.hostile).toBe(true);
  });

  it('does not flag a neutral or conditional mob from its type alone', () => {
    for (const name of [
      'wolf',
      'enderman',
      'piglin',
      'bee',
      'iron_golem',
      'spider',
      'cave_spider',
    ]) {
      const world = new FakeWorld();
      mob(world, 1, name, 0.5, -5.5);
      expect(observeEntities(world.bot).entities[0]?.hostile, name).toBeUndefined();
    }
  });

  it('shows a spider in state attacking as attacking, not as a flag', () => {
    const world = new FakeWorld();
    facingMob(world, 1, 'spider', -2.5);
    const [spider] = observeEntities(world.bot).entities;
    expect(spider?.state).toBe('attacking');
    expect(spider?.hostile).toBeUndefined();
  });

  it('shows a wolf in state attacking as attacking, not as a flag', () => {
    const world = new FakeWorld();
    facingMob(world, 1, 'wolf', -2.5);
    const [wolf] = observeEntities(world.bot).entities;
    expect(wolf?.state).toBe('attacking');
    expect(wolf?.hostile).toBeUndefined();
  });

  it('shows no state for a mob that faces away and does not close', () => {
    const world = new FakeWorld();
    mob(world, 1, 'wolf', 0.5, -5.5, { yaw: 0 });
    expect(observeEntities(world.bot).entities[0]).not.toHaveProperty('state');
  });
});

describe('threat: closing sign', () => {
  it('a distance that falls from 10 to 8 between samples is closing', () => {
    const world = new FakeWorld();
    const clock = { age: 100 };
    const bot = timedBot(world, clock);
    mob(world, 1, 'zombie', 0.5, -9.5);
    observeEntities(bot);
    clock.age = 120;
    mob(world, 1, 'zombie', 0.5, -7.5);
    const [zombie] = observeEntities(bot).entities;
    expect(zombie?.closing).toBe(true);
    expect(zombie?.state).toBe('closing');
  });

  it('a distance that rises from 8 to 10 is not closing', () => {
    const world = new FakeWorld();
    const clock = { age: 100 };
    const bot = timedBot(world, clock);
    mob(world, 1, 'zombie', 0.5, -7.5);
    observeEntities(bot);
    clock.age = 120;
    mob(world, 1, 'zombie', 0.5, -9.5);
    expect(observeEntities(bot).entities[0]?.closing).toBeUndefined();
  });

  it('an equal distance is not closing', () => {
    const world = new FakeWorld();
    const clock = { age: 100 };
    const bot = timedBot(world, clock);
    mob(world, 1, 'zombie', 0.5, -7.5);
    observeEntities(bot);
    clock.age = 120;
    expect(observeEntities(bot).entities[0]?.closing).toBeUndefined();
  });

  it('a first sighting, with no earlier sample, is not closing', () => {
    const world = new FakeWorld();
    const bot = timedBot(world, { age: 100 });
    mob(world, 1, 'zombie', 0.5, -7.5);
    expect(observeEntities(bot).entities[0]?.closing).toBeUndefined();
  });
});

describe('threat: the closing window', () => {
  it('a sample exactly at the window edge still counts (last allowed)', () => {
    const world = new FakeWorld();
    const clock = { age: 0 };
    const bot = timedBot(world, clock);
    mob(world, 1, 'zombie', 0.5, -9.5);
    observeEntities(bot);
    clock.age = 100;
    mob(world, 1, 'zombie', 0.5, -7.5);
    expect(observeEntities(bot).entities[0]?.closing).toBe(true);
  });

  it('a sample older than the window is discarded (one tick past the edge)', () => {
    const world = new FakeWorld();
    const clock = { age: 0 };
    const bot = timedBot(world, clock);
    mob(world, 1, 'zombie', 0.5, -9.5);
    observeEntities(bot);
    clock.age = 101;
    mob(world, 1, 'zombie', 0.5, -7.5);
    expect(observeEntities(bot).entities[0]?.closing).toBeUndefined();
  });
});

describe('threat: abort, close and error paths', () => {
  it('an entity that leaves view drops its sample: no growth over 1000 leaves', () => {
    const world = new FakeWorld();
    const clock = { age: 100 };
    const bot = timedBot(world, clock);
    for (let id = 1; id <= 1000; id++) {
      mob(world, id, 'zombie', 0.5, -5.5);
      observeEntities(bot);
      delete world.entities[id];
      observeEntities(bot);
      expect(trackedSampleCount(bot)).toBe(0);
    }
  });

  it('a missing clock gives closing false, with no throw', () => {
    const world = new FakeWorld();
    mob(world, 1, 'zombie', 0.5, -9.5);
    observeEntities(world.bot);
    mob(world, 1, 'zombie', 0.5, -7.5);
    const [zombie] = observeEntities(world.bot).entities;
    expect(zombie?.closing).toBeUndefined();
    expect(trackedSampleCount(world.bot)).toBe(0);
  });
});

describe('threat: arrows, held items, fuse', () => {
  it('omits an arrow that is not closing and keeps one that is', () => {
    const world = new FakeWorld();
    const clock = { age: 100 };
    const bot = timedBot(world, clock);
    mob(world, 1, 'arrow', 0.5, -9.5);
    expect(observeEntities(bot).entities).toEqual([]);
    clock.age = 110;
    mob(world, 1, 'arrow', 0.5, -7.5);
    const [arrow] = observeEntities(bot).entities;
    expect(arrow?.type).toBe('arrow');
    expect(arrow?.closing).toBe(true);
  });

  it('reports a skeleton held item', () => {
    const world = new FakeWorld();
    mob(world, 1, 'skeleton', 0.5, -5.5, { heldItem: { name: 'bow' } });
    const [skeleton] = observeEntities(world.bot).entities;
    expect(skeleton?.held_item).toBe('bow');
    expect(skeleton?.hostile).toBe(true);
  });

  it('shows hissing only when the creeper ignited flag is set', () => {
    const world = new FakeWorld();
    const metadata: unknown[] = [];
    metadata[18] = true;
    mob(world, 1, 'creeper', 0.5, -5.5, { metadata });
    expect(observeEntities(world.bot).entities[0]?.fuse).toBe('hissing');
    metadata[18] = false;
    expect(observeEntities(world.bot).entities[0]?.fuse).toBeUndefined();
  });
});
