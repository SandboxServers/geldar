import type { Snapshot } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { selfProjector } from './self.ts';

const options = { budget: 37, daysSinceSleep: 2 };

/** A snapshot with only the self fields the projector reads; the rest is not used. */
function snapshotWith(self: Record<string, unknown>): Snapshot {
  return {
    self: {
      position: { x: 0, y: 64, z: 0 },
      health: 20,
      hunger: 20,
      armor: 0,
      held_item: null,
      inventory: [],
      effects: [],
      budget_remaining_thoughts: 0,
      days_since_sleep: 0,
      ...self,
    },
  } as unknown as Snapshot;
}

describe('selfProjector: sky and ground', () => {
  it('passes ground_below, trapped and sun through to the agent', () => {
    const view = selfProjector(
      snapshotWith({ ground_below: 3, trapped: 'perched', sun: 'midday' }),
      options,
    );
    expect(view.self).toMatchObject({ ground_below: 3, trapped: 'perched', sun: 'midday' });
  });

  it('leaves the three fields out when the Body did not send them', () => {
    const view = selfProjector(snapshotWith({}), options);
    expect(view.self).not.toHaveProperty('ground_below');
    expect(view.self).not.toHaveProperty('trapped');
    expect(view.self).not.toHaveProperty('sun');
  });
});
