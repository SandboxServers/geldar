import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { FakeWorld } from '../perception.fakes.ts';
import { skyGround } from './sky-ground.ts';

// The bot stands at (0.5, 64, 0.5): its feet are in row 64, so the cell under them is row 63.

/** The fake world's bot with a time of day, for the sun phase. */
function botAt(world: FakeWorld, timeOfDay?: number): Bot {
  const base = world.bot;
  return timeOfDay === undefined ? base : ({ ...base, time: { timeOfDay } } as unknown as Bot);
}

describe('ground_below', () => {
  it('is 0 when the bot stands on solid ground', () => {
    const world = new FakeWorld();
    world.set('stone', 0, 63, 0);
    expect(skyGround(world.bot).ground_below).toBe(0);
  });

  it('counts the air between the feet and the ground: stone 3 below gives 3', () => {
    const world = new FakeWorld();
    world.set('stone', 0, 60, 0);
    expect(skyGround(world.bot).ground_below).toBe(3);
  });

  it('is capped at 32 when no ground is found within 32 cells', () => {
    const world = new FakeWorld();
    world.set('stone', 0, 30, 0);
    expect(skyGround(world.bot).ground_below).toBe(32);
  });

  it('does not count leaves as ground: a body on leaves over stone 5 below gives 5', () => {
    const world = new FakeWorld();
    world.set('oak_leaves', 0, 63, 0);
    world.set('stone', 0, 58, 0);
    expect(skyGround(world.bot).ground_below).toBe(5);
  });

  it('uses only the y axis: ground beside the bot does not change it', () => {
    const world = new FakeWorld();
    world.set('stone', 1, 63, 0);
    world.set('stone', 0, 63, 1);
    expect(skyGround(world.bot).ground_below).toBe(32);
  });

  it('treats a block with no name as not loaded, and does not throw', () => {
    const bot = {
      entity: { position: new Vec3(0.5, 64, 0.5) },
      blockAt: () => ({}),
    } as unknown as Bot;
    expect(() => skyGround(bot)).not.toThrow();
    expect(skyGround(bot)).toEqual({});
  });

  it('returns nothing for the ground when blockAt answers null, and does not throw', () => {
    const bot = {
      entity: { position: new Vec3(0.5, 64, 0.5) },
      blockAt: () => null,
    } as unknown as Bot;
    expect(() => skyGround(bot)).not.toThrow();
    expect(skyGround(bot)).toEqual({});
  });
});

describe('trapped', () => {
  it('is none on open ground', () => {
    const world = new FakeWorld();
    world.set('stone', 0, 63, 0);
    expect(skyGround(world.bot).trapped).toBe('none');
  });

  it('is perched when the bot is over air with ground below', () => {
    const world = new FakeWorld();
    world.set('stone', 0, 60, 0);
    expect(skyGround(world.bot).trapped).toBe('perched');
  });

  it('is perched on leaves over stone', () => {
    const world = new FakeWorld();
    world.set('oak_leaves', 0, 63, 0);
    world.set('stone', 0, 58, 0);
    expect(skyGround(world.bot)).toEqual({ ground_below: 5, trapped: 'perched' });
  });

  it('is pit between four walls at least 2 high with ground below', () => {
    const world = new FakeWorld();
    world.set('stone', 0, 63, 0);
    for (const [x, z] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      world.set('stone', x, 64, z);
      world.set('stone', x, 65, z);
    }
    expect(skyGround(world.bot)).toEqual({ ground_below: 0, trapped: 'pit' });
  });

  it('is pit when the walls stand over air with ground three below', () => {
    const world = new FakeWorld();
    world.set('stone', 0, 60, 0);
    for (const [x, z] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      world.set('stone', x, 64, z);
      world.set('stone', x, 65, z);
    }
    expect(skyGround(world.bot)).toEqual({ ground_below: 3, trapped: 'pit' });
  });

  it('is not pit with one wall only', () => {
    const world = new FakeWorld();
    world.set('stone', 0, 63, 0);
    world.set('stone', 1, 64, 0);
    world.set('stone', 1, 65, 0);
    expect(skyGround(world.bot).trapped).toBe('none');
  });
});

describe('sun', () => {
  const edges: [number, string][] = [
    [0, 'morning'],
    [2999, 'morning'],
    [3000, 'midday'],
    [8999, 'midday'],
    [9000, 'afternoon'],
    [10999, 'afternoon'],
    [11000, 'low'],
    [11999, 'low'],
    [12000, 'set'],
    [23999, 'set'],
  ];

  it.each(edges)('maps tick %i to %s, on the exact edges', (tick, phase) => {
    const world = new FakeWorld();
    expect(skyGround(botAt(world, tick)).sun).toBe(phase);
  });

  it('is omitted, not null, when there is no sky above', () => {
    const world = new FakeWorld();
    world.set('stone', 0, 70, 0);
    const out = skyGround(botAt(world, 6000));
    expect(out).not.toHaveProperty('sun');
  });

  it('is omitted when the time of day is unknown', () => {
    const world = new FakeWorld();
    expect(skyGround(botAt(world)).sun).toBeUndefined();
  });

  it('is omitted when blockAt answers null above the bot', () => {
    const world = new FakeWorld();
    const base = botAt(world, 6000);
    const bot = {
      ...base,
      blockAt: (point: Vec3) => (point.y > 64 ? null : base.blockAt(point)),
    } as unknown as Bot;
    expect(skyGround(bot)).not.toHaveProperty('sun');
  });
});
