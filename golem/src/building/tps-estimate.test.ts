import { describe, expect, it } from 'vitest';
import { MAX_TPS, TPS_MIN_INTERVALS, TPS_WINDOW_TICKS, TpsEstimator } from './tps-estimate.ts';

/** Feeds ticks spaced `gapMs` apart on a fake clock; returns the estimator. */
function feed(count: number, gapMs: number, start = 0): { est: TpsEstimator; now: number } {
  let now = start;
  const est = new TpsEstimator(() => now);
  for (let i = 0; i < count; i++) {
    est.onTick();
    now += gapMs;
  }
  return { est, now: now - gapMs };
}

describe('TpsEstimator', () => {
  it('has no estimate before the minimum number of intervals', () => {
    const { est } = feed(TPS_MIN_INTERVALS, 50);
    expect(est.tps()).toBeUndefined();
  });

  it('reads 20 TPS for ticks 50 ms apart', () => {
    const { est } = feed(TPS_MIN_INTERVALS + 3, 50);
    expect(est.tps()).toBeCloseTo(20, 6);
  });

  it('reads 10 TPS for ticks 100 ms apart', () => {
    const { est } = feed(TPS_MIN_INTERVALS + 3, 100);
    expect(est.tps()).toBeCloseTo(10, 6);
  });

  it('reads 15 TPS for ticks 66.67 ms apart', () => {
    const { est } = feed(TPS_MIN_INTERVALS + 3, 1000 / 15);
    expect(est.tps()).toBeCloseTo(15, 3);
  });

  it('caps the estimate at 20 for ticks faster than 50 ms', () => {
    const { est } = feed(TPS_MIN_INTERVALS + 3, 25);
    expect(est.tps()).toBe(MAX_TPS);
  });

  it('reads the cap when the clock did not move over the window', () => {
    const { est } = feed(TPS_MIN_INTERVALS + 1, 0);
    expect(est.tps()).toBe(MAX_TPS);
  });

  it('forgets slow ticks that left the window', () => {
    // Slow ticks first (5 TPS), then a full window of 20 TPS ticks: the estimate follows the recent ones.
    let now = 0;
    const est = new TpsEstimator(() => now);
    for (let i = 0; i < 10; i++) {
      est.onTick();
      now += 200;
    }
    for (let i = 0; i < TPS_WINDOW_TICKS + 1; i++) {
      est.onTick();
      now += 50;
    }
    expect(est.tps()).toBeCloseTo(20, 6);
  });
});
