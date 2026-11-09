/**
 * The percentile of a list by nearest rank: sort ascending (a copy; the input is not touched),
 * take index `ceil(p / 100 * n) - 1`. `NaN` for an empty list; `p <= 0` or `p > 100` throws.
 */
export function percentile(values: number[], p: number): number {
  if (!(p > 0 && p <= 100)) throw new RangeError(`percentile p must be in (0, 100], got ${p}`);
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] as number;
}
