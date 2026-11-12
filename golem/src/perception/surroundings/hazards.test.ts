import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { FakeWorld } from '../perception.fakes.ts';
import { hazards, MAX_HAZARDS } from './hazards.ts';

// The bot stands at (0.5, 64, 0.5) on a stone floor at row 63, so the feet row 64 has no drop in it.

function floor(): FakeWorld {
  const world = new FakeWorld();
  for (let x = -10; x <= 10; x++) {
    for (let z = -10; z <= 10; z++) world.set('stone', x, 63, z);
  }
  return world;
}

function listed(world: FakeWorld): unknown[] {
  return hazards(world.bot).hazards ?? [];
}

describe('hazards near the Body', () => {
  it.each([
    ['lava', 'lava', 2, 0, 'e', 2],
    ['deep_water', 'water', 0, 3, 's', 3],
    ['fire', 'fire', -2, 0, 'w', 2],
    ['fire', 'soul_fire', 0, -2, 'n', 2],
    ['cactus', 'cactus', 3, -3, 'ne', 4],
  ])('detects %s (block %s) at a known cell', (kind, name, x, z, dir, dist) => {
    const world = floor();
    world.set(name, x, 64, z);
    expect(listed(world)).toEqual([{ kind, dir, dist }]);
  });

  it('reports a drop: an open feet-row cell with no floor for three cells below', () => {
    const world = floor();
    world.clear(5, 63, 0);
    expect(listed(world)).toEqual([{ kind: 'drop', dir: 'e', dist: 5 }]);
  });

  it('reaches 8 blocks and not 9', () => {
    const inside = floor();
    inside.set('lava', 8, 64, 0);
    expect(listed(inside)).toEqual([{ kind: 'lava', dir: 'e', dist: 8 }]);
    const outside = floor();
    outside.set('lava', 9, 64, 0);
    expect(listed(outside)).toEqual([]);
  });

  it('keeps exactly four, the nearest, and drops the fifth', () => {
    const world = floor();
    for (let x = 2; x <= 6; x++) world.set('lava', x, 64, 0);
    expect(MAX_HAZARDS).toBe(4);
    expect(listed(world).map((h) => (h as { dist: number }).dist)).toEqual([2, 3, 4, 5]);
  });

  it.each([
    ['east', 5, 0, 'e', 5],
    ['west', -5, 0, 'w', 5],
    ['south', 0, 5, 's', 5],
    ['north', 0, -5, 'n', 5],
    ['south-east', 3, 3, 'se', 4],
    ['north-west', -3, -3, 'nw', 4],
  ])('gives the direction %s (x %i, z %i) as %s', (_label, x, z, dir, dist) => {
    const world = floor();
    world.set('lava', x, 64, z);
    expect(listed(world)).toEqual([{ kind: 'lava', dir, dist }]);
  });

  it('does not report lava behind a wall, and reports lava in sight', () => {
    // A stone wall at x = 2 over rows 64 and 65 hides the lava at (4, 64, 0); the lava at (0, 64, -5) is open.
    const world = floor();
    for (let z = -1; z <= 1; z++) {
      world.set('stone', 2, 64, z);
      world.set('stone', 2, 65, z);
    }
    world.set('lava', 4, 64, 0);
    world.set('lava', 0, 64, -5);
    expect(listed(world)).toEqual([{ kind: 'lava', dir: 'n', dist: 5 }]);
  });

  it('skips cells in unloaded chunks (blockAt null) without throwing', () => {
    const world = floor();
    world.set('lava', 2, 64, 0);
    world.set('lava', 6, 64, 0);
    world.clear(5, 63, 0);
    const real = world.bot;
    const bot = {
      ...real,
      blockAt: (point: Vec3) => (point.x >= 4 ? null : real.blockAt(point)),
    } as unknown as Bot;
    expect(hazards(bot).hazards).toEqual([{ kind: 'lava', dir: 'e', dist: 2 }]);
  });

  it('returns an empty list when the Body has no entity yet', () => {
    const world = floor();
    world.set('lava', 2, 64, 0);
    const bot = { ...world.bot, entity: undefined } as unknown as Bot;
    expect(hazards(bot)).toEqual({});
  });

  it('returns an empty list on open, safe ground', () => {
    expect(listed(floor())).toEqual([]);
  });
});
