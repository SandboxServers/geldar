import { describe, expect, it } from 'vitest';
import { factor, type Score, step } from '../src/index.ts';

const SCORES: Score[] = [1, 2, 3, 4, 5];

describe('step', () => {
  it('returns the base at score 3', () => {
    expect(step(3, 6, -2, 2, 14)).toBe(6);
    expect(step(3, 6, 5, 0, 100)).toBe(6);
  });

  it('gives the floors 10, 8, 6, 4, 2 for step(a, 6, -2, 2, 14) at scores 1 to 5', () => {
    expect(SCORES.map((score) => step(score, 6, -2, 2, 14))).toEqual([10, 8, 6, 4, 2]);
  });

  it('moves up with a positive perPoint, on both sides of 3', () => {
    expect(step(4, 6, 2, 0, 100)).toBe(8);
    expect(step(2, 6, 2, 0, 100)).toBe(4);
    expect(step(5, 6, 2, 0, 100)).toBe(10);
    expect(step(1, 6, 2, 0, 100)).toBe(2);
  });

  it('clamps to the maximum', () => {
    expect(step(5, 6, 10, 2, 14)).toBe(14);
  });

  it('clamps to the minimum', () => {
    expect(step(1, 6, 10, 2, 14)).toBe(2);
    expect(step(5, 6, -10, 2, 14)).toBe(2);
  });
});

describe('factor', () => {
  it('returns the base at score 3', () => {
    expect(factor(3, 7, 2)).toBe(7);
    expect(factor(3, 9, 0.5)).toBe(9);
  });

  it('scales by k to the power of (score - 3) on both sides of 3', () => {
    expect(factor(1, 8, 2)).toBe(2);
    expect(factor(2, 8, 2)).toBe(4);
    expect(factor(4, 9, 3)).toBe(27);
    expect(factor(5, 8, 2)).toBe(32);
  });
});
