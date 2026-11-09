import { describe, expect, it } from 'vitest';
import { nextDelayMs } from './backoff.ts';

describe('nextDelayMs', () => {
  it('doubles from 1 s and caps at 30 s with the jitter midpoint', () => {
    const mid = () => 0.5;
    const delays = [1, 2, 3, 4, 5, 6, 7].map((attempt) => nextDelayMs(attempt, undefined, mid));
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('is 1.2 times the nominal delay at the top of the jitter range, and never above the ceiling', () => {
    const top = () => 1;
    expect(nextDelayMs(1, undefined, top)).toBe(1200);
    expect(nextDelayMs(7, undefined, top)).toBe(36000);
  });

  it('is 0.8 times the nominal delay at the bottom of the jitter range', () => {
    expect(nextDelayMs(2, undefined, () => 0)).toBe(1600);
  });
});
