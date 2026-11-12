import { describe, expect, it } from 'vitest';
import { selfProjector } from './self.ts';
import type { SnapshotProjector } from './types.ts';

type Input = Parameters<SnapshotProjector>[0];
type Options = Parameters<SnapshotProjector>[1];

/** A snapshot with only the self fields the projector reads; the rest is not needed here. */
function snapshotWith(self: Record<string, unknown>): Input {
  return {
    self: {
      position: { x: 0, y: 64, z: 0 },
      health: 20,
      hunger: 20,
      armor: 6,
      held_item: null,
      inventory: [{ item: 'iron_chestplate', count: 1, wear: 'low' }],
      effects: [],
      ...self,
    },
  } as unknown as Input;
}

const options = { budget: 3, daysSinceSleep: 0 } as unknown as Options;

describe('selfProjector: status flags and air', () => {
  it('passes the true status flags and the breath level through to the agent', () => {
    const view = selfProjector(
      snapshotWith({ status_flags: ['underwater', 'in_water'], air: 12 }),
      options,
    );
    expect(view.self).toMatchObject({ status_flags: ['underwater', 'in_water'], air: 12 });
  });

  it('omits both keys when the snapshot has none (full breath, no flags)', () => {
    const view = selfProjector(snapshotWith({}), options);
    expect(view.self).not.toHaveProperty('status_flags');
    expect(view.self).not.toHaveProperty('air');
  });

  it('keeps the armour and the inventory wear the Body reports', () => {
    const view = selfProjector(snapshotWith({}), options);
    expect(view.self).toMatchObject({
      armor: 6,
      inventory: [{ item: 'iron_chestplate', count: 1, wear: 'low' }],
    });
  });
});
