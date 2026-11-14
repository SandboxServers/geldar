import type { PlanMessage } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { planExpiredBy } from './plan.ts';

/** A plan that expires at `expiresTick`; `planExpiredBy` reads nothing else. */
function planExpiringAt(expiresTick: number): PlanMessage {
  return { expires_tick: expiresTick } as PlanMessage;
}

describe('planExpiredBy', () => {
  // At 50 ms a tick (20 ticks a second), a plan from tick 0 that expires at tick 100 has 5000 ms.
  it('is not expired one whole tick short of its window', () => {
    expect(planExpiredBy(planExpiringAt(100), 0, 4950, 50)).toBe(false);
  });

  it('is expired on the first millisecond past the last whole tick', () => {
    expect(planExpiredBy(planExpiringAt(100), 0, 4951, 50)).toBe(true);
  });

  it('is expired when the snapshot tick itself reaches the expiry tick', () => {
    expect(planExpiredBy(planExpiringAt(100), 99, 0, 50)).toBe(false);
    expect(planExpiredBy(planExpiringAt(100), 100, 0, 50)).toBe(true);
  });

  it('counts elapsed time in the tick length it is given', () => {
    // 4951 ms is 100 whole ticks at 50 ms, but only 50 at 100 ms.
    expect(planExpiredBy(planExpiringAt(100), 0, 4951, 100)).toBe(false);
  });
});
