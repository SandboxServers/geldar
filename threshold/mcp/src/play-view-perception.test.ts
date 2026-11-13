import type { Snapshot } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { selfProjector } from './play-view/self.ts';
import { surroundingsProjector } from './play-view/surroundings.ts';

const options = { budget: 37, daysSinceSleep: 2 };

/** A snapshot with only the surroundings the projector reads; the rest is not used. */
function withSurroundings(surroundings: Record<string, unknown>): Snapshot {
  return {
    surroundings: {
      blocks_summary: 'grass plains',
      notable_blocks: [],
      entities: [],
      agents: [],
      ...surroundings,
    },
  } as unknown as Snapshot;
}

/** A snapshot with only the self fields the projector reads. */
function withInventory(inventory: Record<string, unknown>[]): Snapshot {
  return {
    self: {
      position: { x: 0, y: 64, z: 0 },
      health: 20,
      hunger: 20,
      armor: 0,
      held_item: null,
      inventory,
      effects: [],
      budget_remaining_thoughts: 0,
      days_since_sleep: 0,
    },
  } as unknown as Snapshot;
}

describe('surroundingsProjector: nearby agents', () => {
  it('passes vertical and in_reach through to the agent on each entry', () => {
    const agents = [
      {
        name: 'Pike',
        distance: 2,
        held_item: null,
        health_estimate: 'healthy',
        vertical: 'below',
        in_reach: true,
      },
      {
        name: 'Wren',
        distance: 6,
        held_item: null,
        health_estimate: 'hurt',
        vertical: 'above',
        in_reach: false,
      },
      {
        name: 'Oak',
        distance: 4,
        held_item: null,
        health_estimate: 'healthy',
        vertical: 'level',
        in_reach: true,
      },
    ];
    const view = surroundingsProjector(withSurroundings({ agents }), options);
    expect(view.surroundings?.agents).toEqual(agents);
  });

  it('adds no vertical or in_reach key when the Body did not send them', () => {
    const agents = [{ name: 'Pike', distance: 2, held_item: null, health_estimate: 'healthy' }];
    const view = surroundingsProjector(withSurroundings({ agents }), options);
    expect(view.surroundings?.agents?.[0]).not.toHaveProperty('vertical');
    expect(view.surroundings?.agents?.[0]).not.toHaveProperty('in_reach');
  });
});

describe('selfProjector: inventory edible', () => {
  it('passes edible through on each stack the agent carries', () => {
    const inventory = [
      { item: 'wheat', count: 12, edible: true },
      { item: 'oak_log', count: 7, edible: false },
      { item: 'stone_pickaxe', count: 1, wear: 'low' },
    ];
    const view = selfProjector(withInventory(inventory), options);
    expect(view.self?.inventory).toEqual(inventory);
  });
});
