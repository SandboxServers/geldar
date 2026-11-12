import type { Bot } from 'mineflayer';
import { FakeWorld } from '../perception/perception.fakes.ts';

// Test doubles for the body-image tests. No production code imports this file.

/** A flat world: stone at y 63 over x and z in [-8, 8]; everything else is loaded air. */
export function flatWorld(): FakeWorld {
  const world = new FakeWorld();
  for (let x = -8; x <= 8; x++) {
    for (let z = -8; z <= 8; z++) world.set('stone', x, 63, z);
  }
  return world;
}

/** The bot with cells at x above `loadedToX` unloaded (null), the rest as the world has them. */
export function partlyLoadedBot(world: FakeWorld, loadedToX: number): Bot {
  const base = world.bot;
  return {
    ...base,
    blockAt: (point: { x: number; y: number; z: number }) =>
      point.x > loadedToX ? null : base.blockAt(point as never),
  } as unknown as Bot;
}

/** The bot with no cell loaded at all. */
export function unloadedBot(world: FakeWorld): Bot {
  return { ...world.bot, blockAt: () => null } as unknown as Bot;
}
