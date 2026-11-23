import { describe, expect, it } from 'vitest';
import { BASE_GAP_TICKS, gapTicksFor, SLOW_GAP_TICKS, TickThrottle } from './throttle.ts';

/** Returns the TPS values in order, then the last one forever. */
function tpsSequence(values: (number | undefined)[]): () => number | undefined {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

describe('gapTicksFor (BLD-15 health throttle)', () => {
  it('keeps the base gap at 20 TPS', () => {
    expect(gapTicksFor(20)).toBe(BASE_GAP_TICKS);
    expect(BASE_GAP_TICKS).toBe(4);
  });

  it('keeps the base gap at exactly 18 TPS (the boundary is inclusive)', () => {
    expect(gapTicksFor(18)).toBe(BASE_GAP_TICKS);
  });

  it('doubles the gap at 15 TPS', () => {
    expect(gapTicksFor(15)).toBe(SLOW_GAP_TICKS);
    expect(SLOW_GAP_TICKS).toBe(BASE_GAP_TICKS * 2);
  });

  it('doubles the gap at exactly 12 TPS', () => {
    expect(gapTicksFor(12)).toBe(SLOW_GAP_TICKS);
  });

  it('pauses at 8 TPS', () => {
    expect(gapTicksFor(8)).toBeNull();
  });

  it('pauses just below 12 TPS', () => {
    expect(gapTicksFor(11.99)).toBeNull();
  });

  it('treats an unknown TPS as full speed, since no load is reported', () => {
    expect(gapTicksFor(undefined)).toBe(BASE_GAP_TICKS);
  });
});

describe('TickThrottle (tick-based, fake clock)', () => {
  it('lets the first cell go at once, then waits the base gap in ticks at 20 TPS', () => {
    const throttle = new TickThrottle(() => 20);
    expect(throttle.before(10)).toBe('go');
    expect(throttle.before(11)).toBe('gap');
    expect(throttle.before(13)).toBe('gap');
    expect(throttle.before(14)).toBe('go');
  });

  it('delays by the doubled gap in ticks at 15 TPS', () => {
    const throttle = new TickThrottle(() => 15);
    expect(throttle.before(0)).toBe('go');
    for (let tick = 1; tick < SLOW_GAP_TICKS; tick++) expect(throttle.before(tick)).toBe('gap');
    expect(throttle.before(SLOW_GAP_TICKS)).toBe('go');
  });

  it('returns tps and runs nothing below 12 TPS, then goes on the tick TPS recovers', () => {
    const readTps = tpsSequence([8, 8, 8, 20]);
    const throttle = new TickThrottle(readTps);
    expect(throttle.before(0)).toBe('tps');
    expect(throttle.before(1)).toBe('tps');
    expect(throttle.before(2)).toBe('tps');
    expect(throttle.before(3)).toBe('go');
  });

  it('the gap keeps counting through a pause: the cell after it waits for the gap to pass', () => {
    const readTps = tpsSequence([20, 5, 5, 20, 20]);
    const throttle = new TickThrottle(readTps);
    expect(throttle.before(0)).toBe('go');
    expect(throttle.before(1)).toBe('tps');
    expect(throttle.before(2)).toBe('tps');
    expect(throttle.before(3)).toBe('gap');
    expect(throttle.before(4)).toBe('go');
  });

  it('propagates an error from the TPS source instead of swallowing it', () => {
    const throttle = new TickThrottle(() => {
      throw new Error('tps source failed');
    });
    expect(() => throttle.before(0)).toThrow('tps source failed');
  });

  it('lets 100,000 cells pass one per gap with no cap', () => {
    const throttle = new TickThrottle(() => 20);
    let tick = 0;
    let completed = 0;
    while (completed < 100_000) {
      if (throttle.before(tick) === 'go') completed += 1;
      tick += 1;
    }
    expect(tick).toBe((100_000 - 1) * BASE_GAP_TICKS + 1);
  });
});
