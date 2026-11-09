import { describe, expect, it, vi } from 'vitest';
import { FakeClock, msAt, RealClock, TICKS_PER_DAY, tickAt, ticksPerSecond } from './clock.ts';

describe('tick arithmetic', () => {
  it('ticksPerSecond divides a day by its length', () => {
    expect(ticksPerSecond(2400)).toBe(10);
    expect(TICKS_PER_DAY).toBe(24000);
  });

  for (const day of [2400, 24, 25]) {
    it(`round trips at day length ${day}`, () => {
      for (const t of [1, 7, 1000, 12000]) {
        expect(tickAt(msAt(t, day), day)).toBeGreaterThanOrEqual(t);
        expect(tickAt(msAt(t, day) - 1, day)).toBeLessThan(t);
      }
    });
  }

  it('maps tick 1000 to 1000 ms at day length 24', () => {
    expect(msAt(1000, 24)).toBe(1000);
  });
});

describe('FakeClock', () => {
  it('fires sleeps in time order across one advance', async () => {
    const clock = new FakeClock();
    const fired: string[] = [];
    const late = clock.sleep(200).then(() => fired.push('late'));
    const early = clock.sleep(100).then(() => fired.push('early'));
    await clock.advance(500);
    await Promise.all([late, early]);
    expect(fired).toEqual(['early', 'late']);
    expect(clock.nowMs()).toBe(500);
  });

  it('does not fire a sleep that is not yet due', async () => {
    const clock = new FakeClock(10);
    let done = false;
    void clock.sleep(100).then(() => {
      done = true;
    });
    await clock.advance(99);
    expect(done).toBe(false);
    await clock.advance(1);
    expect(done).toBe(true);
  });

  it('rejects an aborted sleep and does not fire it', async () => {
    const clock = new FakeClock();
    const ac = new AbortController();
    const p = clock.sleep(100, ac.signal);
    const caught = p.then(
      () => 'resolved',
      () => 'rejected',
    );
    ac.abort(new Error('stop'));
    await clock.advance(200);
    expect(await caught).toBe('rejected');
    await expect(clock.sleep(5, ac.signal)).rejects.toThrow('stop');
  });
});

describe('FakeClock details', () => {
  it('runs chained sleeps inside one advance', async () => {
    const clock = new FakeClock();
    const seen: number[] = [];
    const loop = (async () => {
      for (let n = 0; n < 3; n++) {
        await clock.sleep(100);
        seen.push(clock.nowMs());
      }
    })();
    await clock.advance(300);
    await loop;
    expect(seen).toEqual([100, 200, 300]);
  });

  it('removes an aborted sleep from the pending list', async () => {
    const clock = new FakeClock();
    const ac = new AbortController();
    const p = clock.sleep(100, ac.signal).catch(() => 'aborted');
    void clock.sleep(100);
    expect(clock.pendingCount).toBe(2);
    ac.abort(new Error('stop'));
    expect(await p).toBe('aborted');
    expect(clock.pendingCount).toBe(1);
    await clock.advance(100);
    expect(clock.pendingCount).toBe(0);
  });

  it('rejects a negative or non-finite advance', async () => {
    const clock = new FakeClock();
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(clock.advance(bad)).rejects.toThrow(RangeError);
    }
    expect(clock.nowMs()).toBe(0);
  });
});
describe('RealClock', () => {
  it('sleeps and rejects on an immediate abort', async () => {
    const clock = new RealClock();
    const before = clock.nowMs();
    await clock.sleep(20);
    expect(clock.nowMs()).toBeGreaterThanOrEqual(before);
    const ac = new AbortController();
    ac.abort(new Error('gone'));
    await expect(clock.sleep(20, ac.signal)).rejects.toThrow('gone');
  }, 5_000);

  it('clears the timer when aborted while pending', async () => {
    vi.useFakeTimers();
    try {
      const clock = new RealClock();
      const ac = new AbortController();
      const p = clock.sleep(60_000, ac.signal);
      const caught = p.then(
        () => 'resolved',
        (e: Error) => e.message,
      );
      setTimeout(() => ac.abort(new Error('late stop')), 20);
      expect(vi.getTimerCount()).toBe(2);
      await vi.advanceTimersByTimeAsync(20);
      expect(await caught).toBe('late stop');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});