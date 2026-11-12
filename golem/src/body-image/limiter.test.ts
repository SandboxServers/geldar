import { describe, expect, it } from 'vitest';
import { HOUR_LIMIT, HOUR_MS, ImageLimiter, MIN_GAP_MS } from './limiter.ts';

function clock() {
  let t = 0;
  return { now: () => t, set: (value: number) => (t = value) };
}

describe('ImageLimiter: one image per 5 s', () => {
  it('refuses the 2nd call within 5 s and says how long to wait', () => {
    const c = clock();
    const limiter = new ImageLimiter(c.now);
    expect(limiter.take()).toEqual({ ok: true });
    c.set(MIN_GAP_MS - 1);
    expect(limiter.take()).toEqual({ ok: false, retryAfterMs: 1 });
  });

  it('allows the next call exactly 5 s after the last one', () => {
    const c = clock();
    const limiter = new ImageLimiter(c.now);
    limiter.take();
    c.set(MIN_GAP_MS);
    expect(limiter.take()).toEqual({ ok: true });
  });

  it('a refused call takes nothing: the window still runs from the last image taken', () => {
    const c = clock();
    const limiter = new ImageLimiter(c.now);
    limiter.take();
    c.set(1_000);
    expect(limiter.take().ok).toBe(false);
    c.set(MIN_GAP_MS);
    expect(limiter.take()).toEqual({ ok: true });
  });
});

describe('ImageLimiter: 30 per rolling hour', () => {
  it('refuses the 31st in an hour; the wait runs until the first image leaves the hour', () => {
    const c = clock();
    const limiter = new ImageLimiter(c.now);
    for (let i = 0; i < HOUR_LIMIT; i++) {
      c.set(i * MIN_GAP_MS);
      expect(limiter.take()).toEqual({ ok: true });
    }
    c.set(HOUR_LIMIT * MIN_GAP_MS);
    expect(limiter.take()).toEqual({ ok: false, retryAfterMs: HOUR_MS - HOUR_LIMIT * MIN_GAP_MS });
  });

  it('allows an image again once the oldest one is an hour old', () => {
    const c = clock();
    const limiter = new ImageLimiter(c.now);
    for (let i = 0; i < HOUR_LIMIT; i++) {
      c.set(i * MIN_GAP_MS);
      limiter.take();
    }
    c.set(HOUR_MS - 1);
    expect(limiter.take().ok).toBe(false);
    c.set(HOUR_MS);
    expect(limiter.take()).toEqual({ ok: true });
  });
});
