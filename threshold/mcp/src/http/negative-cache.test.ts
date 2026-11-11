import { describe, expect, it } from 'vitest';
import { NegativeCache } from './negative-cache.ts';

// window 1000 ms, room for 2 addresses, flagged after 2 failures
const make = () => new NegativeCache(1000, 2, 2);

describe('NegativeCache', () => {
  it('flags an address after its failures within the window, and no other', () => {
    const cache = make();
    cache.record('a', 0);
    expect(cache.recent('a', 1)).toBe(false);
    cache.record('a', 2);
    expect(cache.recent('a', 999)).toBe(true);
    expect(cache.recent('b', 999)).toBe(false);
  });

  it('forgets an address once the window has passed', () => {
    const cache = make();
    cache.record('a', 0);
    cache.record('a', 1);
    expect(cache.recent('a', 1000)).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('starts a new count when a failure comes after the window', () => {
    const cache = make();
    cache.record('a', 0);
    cache.record('a', 1);
    cache.record('a', 1500);
    expect(cache.recent('a', 1501)).toBe(false);
  });

  it('evicts the oldest address at the cap and never grows past it', () => {
    const cache = make();
    for (const key of ['a', 'b', 'c']) {
      cache.record(key, 0);
      cache.record(key, 1);
    }
    expect(cache.size).toBe(2);
    expect(cache.recent('a', 2)).toBe(false);
    expect(cache.recent('b', 2)).toBe(true);
    expect(cache.recent('c', 2)).toBe(true);
  });
});
