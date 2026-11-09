import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import { sleep, worldAge } from './world-clock.ts';

const botAt = (age: unknown) => ({ time: { age } }) as unknown as Bot;

describe('worldAge', () => {
  it('reads a finite age', () => {
    expect(worldAge(botAt(240))).toBe(240);
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, '20'])('is null for %j', (age) => {
    expect(worldAge(botAt(age))).toBeNull();
  });

  it('is null before the first time packet', () => {
    expect(worldAge({} as unknown as Bot)).toBeNull();
  });
});

describe('sleep', () => {
  it('resolves after the delay', async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const pending = sleep(100).then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(99);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
