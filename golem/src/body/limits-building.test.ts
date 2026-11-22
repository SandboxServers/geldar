import { describe, expect, it } from 'vitest';
import { blockOperationsOf } from './limits.ts';

describe('block operations of the building verbs (BLD-03 flag plumbing)', () => {
  it('break costs one block operation', () => {
    expect(blockOperationsOf({ do: 'break', at: { x: 0, y: 64, z: 0 } } as never)).toBe(1);
  });

  it('plan costs no block operation: the lane is not an intent', () => {
    expect(blockOperationsOf({ do: 'plan', op: 'cancel', plan_id: 'all' } as never)).toBe(0);
  });
});
