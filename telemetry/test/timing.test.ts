import { describe, expect, it } from 'vitest';
import { assertLinear, MiB } from './timing.ts';

let sink = 0;
function spin(iterations: number): void {
  let acc = sink;
  for (let i = 0; i < iterations; i++) acc = (acc * 31 + i) | 0;
  sink = acc;
}

function perIterationMs(): number {
  spin(1e6);
  const start = performance.now();
  spin(2e7);
  return (performance.now() - start) / 2e7;
}

describe('assertLinear', () => {
  it('passes a linear function', () => {
    const per = perIterationMs();
    // About 150 ms at 1 MiB, 300 ms at 2 MiB.
    const { t1, t2 } = assertLinear((size) => spin((size / MiB) * (150 / per)));
    expect(t2).toBeLessThan(4 * t1 + 400);
  });

  it('passes a fast function whose first size is noisy', () => {
    assertLinear(() => {});
  });

  it('fails a quadratic function with t1 about 800 ms', () => {
    const per = perIterationMs();
    const run = (size: number): void => spin((size / MiB) ** 2 * (800 / per));
    expect(() => assertLinear(run)).toThrow(/not linear/);
  });
}, 60_000);
