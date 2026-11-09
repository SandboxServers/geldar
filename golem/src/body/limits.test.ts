import { describe, expect, it } from 'vitest';
import { blockOperationsOf, LimitTracker } from './limits.ts';

describe('LimitTracker', () => {
  const limits = { maxWorldTicks: 100, maxBlockOperations: 10 };

  it('is within limits at the start', () => {
    expect(new LimitTracker(limits, 500).exceeded()).toBeNull();
  });

  it('reaches max_world_ticks when the count equals the maximum, counted from the start tick', () => {
    const tracker = new LimitTracker(limits, 500);
    tracker.observeTick(599);
    expect(tracker.exceeded()).toBeNull();
    tracker.observeTick(600);
    expect(tracker.ticksUsed).toBe(100);
    expect(tracker.exceeded()).toBe('max_world_ticks');
  });

  it('never moves the tick back', () => {
    const tracker = new LimitTracker(limits, 0);
    tracker.observeTick(50);
    tracker.observeTick(10);
    expect(tracker.ticksUsed).toBe(50);
  });

  it('reaches max_block_operations, ignoring bad counts', () => {
    const tracker = new LimitTracker(limits, 0);
    tracker.addBlockOperations(9);
    tracker.addBlockOperations(-5);
    tracker.addBlockOperations(Number.NaN);
    expect(tracker.exceeded()).toBeNull();
    tracker.addBlockOperations(1);
    expect(tracker.blockOperationsUsed).toBe(10);
    expect(tracker.exceeded()).toBe('max_block_operations');
  });

  it('names the tick limit first when both ran out', () => {
    const tracker = new LimitTracker(limits, 0);
    tracker.observeTick(100);
    tracker.addBlockOperations(10);
    expect(tracker.exceeded()).toBe('max_world_ticks');
  });
});

describe('blockOperationsOf', () => {
  it('costs mine its count, place one, build its blocks, others nothing', () => {
    expect(blockOperationsOf({ do: 'mine', block: 'stone', count: 7 })).toBe(7);
    expect(blockOperationsOf({ do: 'place', block: 'stone', at: 'feet' })).toBe(1);
    expect(
      blockOperationsOf({
        do: 'build',
        blueprint: {
          name: 'x',
          blocks: [
            { block: 'stone', dx: 0, dy: 0, dz: 0 },
            { block: 'stone', dx: 1, dy: 0, dz: 0 },
          ],
        },
      }),
    ).toBe(2);
    expect(blockOperationsOf({ do: 'eat' })).toBe(0);
  });
});
