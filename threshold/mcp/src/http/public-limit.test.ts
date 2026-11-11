import { describe, expect, it } from 'vitest';
import { PublicRateLimit } from './public-limit.ts';

describe('PublicRateLimit', () => {
  it('allows the burst, then refuses the first request past it', () => {
    const limit = new PublicRateLimit(60, 20);
    for (let i = 0; i < 20; i++) expect(limit.take('a', 0)).toBeUndefined();
    // 60 a minute is one token a second, so the refusal waits one second.
    expect(limit.take('a', 0)).toBe(1);
  });

  it('refills one token per interval: one more request is allowed after a second', () => {
    const limit = new PublicRateLimit(60, 2);
    expect(limit.take('a', 0)).toBeUndefined();
    expect(limit.take('a', 0)).toBeUndefined();
    expect(limit.take('a', 0)).toBe(1);
    expect(limit.take('a', 1000)).toBeUndefined();
    expect(limit.take('a', 1000)).toBe(1);
  });

  it('never refills past the burst, however long the client is quiet', () => {
    const limit = new PublicRateLimit(60, 2);
    expect(limit.take('a', 0)).toBeUndefined();
    expect(limit.take('a', 3_600_000)).toBeUndefined();
    expect(limit.take('a', 3_600_000)).toBeUndefined();
    expect(limit.take('a', 3_600_000)).toBe(1);
  });

  it('rounds the wait up to whole seconds: 30 a minute waits two seconds for a token', () => {
    const limit = new PublicRateLimit(30, 1);
    expect(limit.take('a', 0)).toBeUndefined();
    expect(limit.take('a', 0)).toBe(2);
    expect(limit.take('a', 500)).toBe(2);
  });

  it('never returns less than one second, even when a token is nearly due', () => {
    const limit = new PublicRateLimit(600, 1);
    expect(limit.take('a', 0)).toBeUndefined();
    // A token is due in 100 ms, which is still a wait of one second.
    expect(limit.take('a', 0)).toBe(1);
    expect(limit.take('a', 50)).toBe(1);
  });

  it('counts each client on its own', () => {
    const limit = new PublicRateLimit(60, 1);
    expect(limit.take('a', 0)).toBeUndefined();
    expect(limit.take('a', 0)).toBe(1);
    expect(limit.take('b', 0)).toBeUndefined();
  });

  it('drops the least recently seen client at the cap, and keeps the rest', () => {
    const limit = new PublicRateLimit(60, 1, 2);
    expect(limit.take('a', 0)).toBeUndefined();
    expect(limit.take('b', 0)).toBeUndefined();
    // Touching b makes a the least recently seen.
    expect(limit.take('b', 0)).toBe(1);
    expect(limit.take('c', 0)).toBeUndefined();
    expect(limit.size).toBe(2);
    // b kept its empty bucket; a was dropped, so it starts full again.
    expect(limit.take('b', 0)).toBe(1);
    expect(limit.take('a', 0)).toBeUndefined();
    expect(limit.size).toBe(2);
  });

  it('never holds more clients than the cap', () => {
    const limit = new PublicRateLimit(60, 1, 3);
    for (let i = 0; i < 50; i++) limit.take(`client-${i}`, 0);
    expect(limit.size).toBe(3);
  });
});
