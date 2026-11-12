import type { Snapshot } from '@geldar/contract';
import { buildSnapshot } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import { toPlayView } from '../play-view.ts';
import type { PlayViewOptions } from './types.ts';

const OPTIONS: PlayViewOptions = { budget: 99, daysSinceSleep: 0 };

function withFoodKnown(foodKnown?: Snapshot['surroundings']['food_known']): Snapshot {
  const base = buildSnapshot({
    agentId: 'ag_ranger_01',
    shard: 'phase0',
    revision: 4,
    snapshotN: 1,
    day: 3,
    ticks: 12000,
    timeOfDay: 'dusk',
    position: { x: 10, y: 64, z: -5 },
    health: 18,
    food: 15,
    inventory: [],
    neighbours: [],
    budget: 99,
    daysSinceSleep: 0,
  });
  const surroundings: Snapshot['surroundings'] = { ...base.surroundings };
  if (foodKnown === undefined) delete surroundings.food_known;
  else surroundings.food_known = foodKnown;
  return { ...base, surroundings };
}

describe('play-view food_known', () => {
  it('passes an empty list through as empty', () => {
    const view = toPlayView(withFoodKnown([]), OPTIONS);
    expect(view.snapshot.surroundings.food_known).toEqual([]);
  });

  it('passes a populated list through unchanged', () => {
    const food: NonNullable<Snapshot['surroundings']['food_known']> = [
      { kind: 'apple', x: 1, y: 64, z: 2 },
      { kind: 'bread', x: -3, y: 65, z: 7 },
    ];
    const view = toPlayView(withFoodKnown(food), OPTIONS);
    expect(view.snapshot.surroundings.food_known).toEqual(food);
  });

  it('leaves the key out when the Body does not report it', () => {
    const view = toPlayView(withFoodKnown(), OPTIONS);
    expect(view.snapshot.surroundings).not.toHaveProperty('food_known');
  });
});
