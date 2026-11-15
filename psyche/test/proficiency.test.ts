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
