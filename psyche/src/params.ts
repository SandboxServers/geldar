// Scaled parameters: a score moves a value around its base. Score 3 is the neutral point and returns the base.
import type { Score } from './types.ts';

/** clamp(base + perPoint * (score - 3), min, max). */
export function step(
  score: Score,
  base: number,
  perPoint: number,
  min: number,
  max: number,
): number {
  const value = base + perPoint * (score - 3);
  return Math.min(max, Math.max(min, value));
}

/** base * k ** (score - 3). */
export function factor(score: Score, base: number, k: number): number {
  return base * k ** (score - 3);
}
