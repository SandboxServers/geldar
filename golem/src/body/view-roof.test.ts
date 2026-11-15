import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { createBodyView } from './view.ts';

/**
 * A bot standing at x 0, y 64, z 0 (feet cell 0,64,0; head cell 0,65,0) with the given solid cells.
 * Only what `createBodyView` reads at construction and in `roofWithin` is filled in.
 */
function roofBot(solid: Vec3[]): Bot {
  const emitter = new EventEmitter() as unknown as Record<string, unknown>;
  const cells = new Set(solid.map((at) => `${at.x},${at.y},${at.z}`));
  emitter.entity = {
    position: new Vec3(0.5, 64, 0.5),
    velocity: new Vec3(0, 0, 0),
    onGround: true,
    isInWater: false,
    isInLava: false,
  };
  emitter.entities = {};
  emitter.health = 20;
  emitter.food = 20;
  emitter.time = { age: 100, timeOfDay: 15_000 };
  emitter.thunderState = 0;
  emitter.spawnPoint = new Vec3(0, 64, 0);
  emitter.inventory = { items: () => [] };
  emitter.blockAt = (at: Vec3) =>
    cells.has(`${Math.floor(at.x)},${Math.floor(at.y)},${Math.floor(at.z)}`)
      ? { name: 'stone', boundingBox: 'block' }
      : { name: 'air', boundingBox: 'empty' };
  return emitter as unknown as Bot;
}

describe('view: roofWithin reads the cells above the head', () => {
  it('sees a roof one, two and three blocks above the head', () => {
    expect(createBodyView(roofBot([new Vec3(0, 66, 0)])).roofWithin?.(3)).toBe(true);
    expect(createBodyView(roofBot([new Vec3(0, 67, 0)])).roofWithin?.(3)).toBe(true);
    expect(createBodyView(roofBot([new Vec3(0, 68, 0)])).roofWithin?.(3)).toBe(true);
  });

  it('misses a roof four blocks above the head when only three are read', () => {
    expect(createBodyView(roofBot([new Vec3(0, 69, 0)])).roofWithin?.(3)).toBe(false);
  });

  it('is false in the open, and ignores a block in the head cell itself', () => {
    expect(createBodyView(roofBot([])).roofWithin?.(3)).toBe(false);
    expect(createBodyView(roofBot([new Vec3(0, 65, 0)])).roofWithin?.(3)).toBe(false);
  });
});
