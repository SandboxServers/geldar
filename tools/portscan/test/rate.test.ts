import { describe, expect, it } from 'vitest';
import { createRateGate } from '../src/rate.ts';

// The fake clock is advanced by the gate's own sleep, so the tests see the slot the gate chose.
function fakeClock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  delays: number[];
} {
  let time = 0;
  const delays: number[] = [];
  return {
    now: () => time,
    sleep: async (ms: number) => {
      delays.push(ms);
      time += ms;
    },
    delays,
  };
}

describe('createRateGate', () => {
  it('spaces serial waits 1000 / perSecond ms apart', async () => {
    const clock = fakeClock();
    const gate = createRateGate(10, clock.now, clock.sleep);
    const starts: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      await gate.wait();
      starts.push(clock.now());
    }
    expect(starts).toEqual([0, 100, 200, 300, 400]);
  });

  it('queues concurrent waits into distinct slots, one 100 ms gap each', async () => {
    const clock = fakeClock();
    const gate = createRateGate(10, clock.now, clock.sleep);
    await Promise.all([1, 2, 3, 4, 5].map(() => gate.wait()));
    // The first wait starts at once; each of the other four sleeps for exactly one slot.
    expect(clock.delays).toEqual([100, 100, 100, 100]);
    expect(clock.now()).toBe(400);
  });

  it('refuses a rate that is zero, negative or not finite', () => {
    const clock = fakeClock();
    expect(() => createRateGate(0, clock.now, clock.sleep)).toThrow(RangeError);
    expect(() => createRateGate(-1, clock.now, clock.sleep)).toThrow(RangeError);
    expect(() => createRateGate(Number.POSITIVE_INFINITY, clock.now, clock.sleep)).toThrow(
      RangeError,
    );
  });
});
