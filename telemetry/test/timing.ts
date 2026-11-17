import { expect } from 'vitest';

export const MiB = 1 << 20;

/**
 * Absolute ceiling in ms for a single timed run. Far above any observed time on
 * a loaded shared runner; it only catches catastrophic (quadratic or worse)
 * behaviour. Scaling is judged by `assertLinear`, never by a tight absolute.
 */
export const CEILING_MS = 30_000;

/** Minimum wall time in ms of three runs of `run(size)`. */
function minOfThree(run: (size: number) => void, size: number): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    run(size);
    min = Math.min(min, performance.now() - start);
  }
  return min;
}

export interface LinearTimes {
  t1: number;
  t2: number;
}

/**
 * Doubling check for a linear-time scan. Warms up once on a small size, then
 * takes the minimum of three runs per size. Passes when t2 <= 3 * t1 + 400 ms
 * (linear is about 2x; the slack absorbs CI noise) or t2 < 1500 ms absolute (a
 * slow but linear machine, or a fast scan with a noisy t1). A quadratic scan
 * is 4x per doubling and takes seconds at 1 MiB, so it fails both.
 */
export function assertLinear(
  run: (size: number) => void,
  sizes: readonly [number, number] = [MiB, 2 * MiB],
): LinearTimes {
  run(Math.max(1, sizes[0] >> 4));
  const t1 = minOfThree(run, sizes[0]);
  const t2 = minOfThree(run, sizes[1]);
  const ratioOk = t2 <= 3 * t1 + 400;
  const absoluteOk = t2 < 1500;
  expect(ratioOk || absoluteOk, `not linear: t1=${t1.toFixed(1)} ms, t2=${t2.toFixed(1)} ms`).toBe(
    true,
  );
  return { t1, t2 };
}
