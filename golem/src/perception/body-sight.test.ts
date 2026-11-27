import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { canSeeBody, canTossTo } from './body-sight.ts';
import { canSeePoint } from './notable-blocks.ts';
import { FakeWorld } from './perception.fakes.ts';
import { findVisibleAgent } from './visible-agent.ts';

/** A standing player five blocks south of the Body (which stands at 0.5, 64, 0.5). */
const FEET = new Vec3(0.5, 64, 5.5);
const HEIGHT = 1.8;

function bot(world: FakeWorld): Bot {
  return world.bot as unknown as Bot;
}

describe('canSeeBody and canTossTo (decision 0446)', () => {
  it('sees a player in the open and can toss to it', () => {
    const world = new FakeWorld();
    expect(canSeeBody(bot(world), FEET, HEIGHT)).toBe(true);
    expect(canTossTo(bot(world), FEET, HEIGHT)).toBe(true);
  });

  it('sees a player behind a waist-high plank, whose middle line is blocked, and can toss over it', () => {
    const world = new FakeWorld();
    world.set('oak_planks', 0, 64, 4);
    // The old rule, one line to the middle, called this player out of sight.
    expect(canSeePoint(bot(world), FEET.offset(0, HEIGHT / 2, 0))).toBe(false);
    expect(canSeeBody(bot(world), FEET, HEIGHT)).toBe(true);
    expect(canTossTo(bot(world), FEET, HEIGHT)).toBe(true);
  });

  it('sees the feet under a block at head height, but a toss there is blocked', () => {
    const world = new FakeWorld();
    world.set('stone', 0, 65, 4);
    expect(canSeeBody(bot(world), FEET, HEIGHT)).toBe(true);
    expect(canTossTo(bot(world), FEET, HEIGHT)).toBe(false);
  });

  it('sees nothing of a player behind a wall two blocks high', () => {
    const world = new FakeWorld();
    world.set('stone', 0, 64, 4);
    world.set('stone', 0, 65, 4);
    expect(canSeeBody(bot(world), FEET, HEIGHT)).toBe(false);
    expect(canTossTo(bot(world), FEET, HEIGHT)).toBe(false);
  });

  it('findVisibleAgent finds a player behind a waist-high plank, as goto and follow use it', () => {
    const world = new FakeWorld();
    world.entities[2] = { type: 'player', username: 'Pike', position: FEET, height: HEIGHT };
    world.set('oak_planks', 0, 64, 4);
    expect(findVisibleAgent(bot(world), 'Pike')?.username).toBe('Pike');
    world.set('oak_planks', 0, 65, 4);
    expect(findVisibleAgent(bot(world), 'Pike')).toBeNull();
  });
});
