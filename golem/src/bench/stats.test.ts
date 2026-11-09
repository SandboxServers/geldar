import { describe, expect, it } from 'vitest';
import { percentile } from './stats.ts';

const oneToTwenty = Array.from({ length: 20 }, (_, i) => i + 1);

describe('percentile', () => {
  it('takes the nearest rank', () => {
    expect(percentile(oneToTwenty, 50)).toBe(10);
    expect(percentile(oneToTwenty, 95)).toBe(19);
    expect(percentile(oneToTwenty, 100)).toBe(20);
  });

  it('is NaN for an empty list', () => {
    expect(percentile([], 50)).toBeNaN();
  });

  it('throws RangeError for p out of (0, 100]', () => {
    expect(() => percentile([1], 0)).toThrow(RangeError);
    expect(() => percentile([1], -5)).toThrow(RangeError);
    expect(() => percentile([1], 101)).toThrow(RangeError);
    expect(() => percentile([1], Number.NaN)).toThrow(RangeError);
  });

  it('does not mutate the input', () => {
    const input = [3, 1, 2];
    expect(percentile(input, 50)).toBe(2);
    expect(input).toEqual([3, 1, 2]);
  });
});
