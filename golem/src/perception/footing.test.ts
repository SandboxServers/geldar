import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { footing } from './footing.ts';
import { createPerception } from './index.ts';
import { FakeWorld } from './perception.fakes.ts';

// The bot stands at (0.5, 64, 0.5): its feet are in block row 64, so the block under them is row 63
// and the block at its head is row 65.

describe('footing', () => {
  it('reports the block under the feet and the block at the head', () => {
    const world = new FakeWorld();
    world.set('oak_leaves', 0, 63, 0);
    world.set('stone', 0, 65, 0);
    expect(footing(world.bot)).toEqual({ standing_on: 'oak_leaves', block_above_feet: 'stone' });
  });

  it('reports air for a bot in the open, which is still a valid answer', () => {
    const world = new FakeWorld();
    expect(footing(world.bot)).toEqual({ standing_on: 'air', block_above_feet: 'air' });
  });

  it('leaves both names out when the chunk is not loaded', () => {
    const world = new FakeWorld();
    const unloaded = { ...world.bot, blockAt: () => null } as unknown as Bot;
    expect(footing(unloaded)).toEqual({});
  });

  it('is part of the surroundings: a Body on a canopy says what it stands on', () => {
    // The live case: standing on oak leaves, the oak log two blocks below the feet, out of sight.
    const world = new FakeWorld();
    world.set('oak_leaves', 0, 63, 0);
    world.set('oak_log', 0, 62, 0);
    const surroundings = createPerception(world.bot).surroundings();
    expect(surroundings.standing_on).toBe('oak_leaves');
    expect(surroundings.block_above_feet).toBe('air');
    expect(surroundings.notable_blocks).toEqual([]);
  });
});
