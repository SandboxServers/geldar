import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, levelForXp } from '../src/index.ts';

describe('levelForXp', () => {
  it('uses the default thresholds 10, 30 and 70', () => {
    expect(DEFAULT_THRESHOLDS).toEqual([10, 30, 70]);
  });

  it('switches level at each threshold: 9, 10, 29, 30, 69, 70', () => {
    expect(levelForXp(0)).toBe(0);
    expect(levelForXp(9)).toBe(0);
    expect(levelForXp(10)).toBe(1);
    expect(levelForXp(29)).toBe(1);
    expect(levelForXp(30)).toBe(2);
    expect(levelForXp(69)).toBe(2);
    expect(levelForXp(70)).toBe(3);
    expect(levelForXp(1000)).toBe(3);
  });

  it('takes custom thresholds', () => {
    expect(levelForXp(2, [1, 2, 3])).toBe(2);
    expect(levelForXp(2, [1, 5, 9])).toBe(1);
    expect(levelForXp(0, [1, 5, 9])).toBe(0);
  });
});

describe('levelForXp threshold validation', () => {
  it('throws RangeError when any threshold is not finite', () => {
    const bad: Array<[number, number, number]> = [
      [Number.NaN, 30, 70],
      [Number.NEGATIVE_INFINITY, 30, 70],
      [10, Number.NaN, 70],
      [10, Number.POSITIVE_INFINITY, 70],
      [10, 30, Number.NaN],
      [10, 30, Number.POSITIVE_INFINITY],
    ];
    for (const thresholds of bad) {
      expect(() => levelForXp(5, thresholds), String(thresholds)).toThrow(RangeError);
    }
  });

  it('throws RangeError when the thresholds decrease', () => {
    const bad: Array<[number, number, number]> = [
      [30, 10, 70],
      [10, 70, 30],
      [10, 30, 20],
    ];
    for (const thresholds of bad) {
      expect(() => levelForXp(5, thresholds), String(thresholds)).toThrow(RangeError);
    }
  });

  it('accepts equal thresholds, which are non-decreasing', () => {
    expect(levelForXp(9, [10, 10, 10])).toBe(0);
    expect(levelForXp(10, [10, 10, 10])).toBe(3);
  });
});
