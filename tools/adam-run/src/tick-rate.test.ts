import { describe, expect, it } from 'vitest';
import { type TickPoint, tickRate } from './tick-rate.ts';

const T0 = Date.UTC(2026, 10, 10, 9);

/** server_tps points every 20 s, the world advancing `tpsRate` ticks per second. */
function points(count: number, tpsRate: number, startTick = 1000): TickPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    atMs: T0 + i * 20_000,
    tick: startTick + Math.round(i * 20 * tpsRate),
  }));
}

/** The newest event time of a list of points. */
function endOf(p: readonly TickPoint[]): number {
  return p.reduce((latest, q) => Math.max(latest, q.atMs), 0);
}

describe('the tick rate from server_tps', () => {
  it('reads 20 ticks a second from a world that ran at full speed', () => {
    const p = points(16, 20);
    expect(tickRate(p, endOf(p))).toBe(20);
  });

  it('reads the slower rate of a lagging server, not a fixed value', () => {
    const p = points(16, 10);
    expect(tickRate(p, endOf(p))).toBe(10);
  });

  it('sorts the points by time before it reads them', () => {
    const p = points(16, 20).reverse();
    expect(tickRate(p, T0 + 15 * 20_000)).toBe(20);
  });

  it('is null with no points, a single point, or a stretch shorter than a minute', () => {
    expect(tickRate([], T0)).toBeNull();
    expect(tickRate(points(1, 20), T0)).toBeNull();
    expect(tickRate(points(3, 20), T0 + 40_000)).toBeNull();
  });

  it('is null when the newest point is more than a minute old, so a stopped plugin reads as no data', () => {
    const p = points(16, 20);
    expect(tickRate(p, endOf(p) + 61_000)).toBeNull();
    expect(tickRate(p, endOf(p) + 60_000)).toBe(20);
  });

  it('reads only the newest stretch: an older stretch past a gap of more than a minute is ignored', () => {
    const old = points(10, 5, 0);
    const restartAt = endOf(old) + 300_000;
    const recent = Array.from({ length: 16 }, (_, i) => ({
      atMs: restartAt + i * 20_000,
      tick: 50_000 + i * 400,
    }));
    expect(tickRate([...old, ...recent], endOf(recent))).toBe(20);
  });

  it('is null when the world counter went backwards', () => {
    const p = points(16, 20).map((q, i) => ({ ...q, tick: 100_000 - i * 400 }));
    expect(tickRate(p, endOf(p))).toBeNull();
  });
});
