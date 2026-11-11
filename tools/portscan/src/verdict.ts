export interface Verdict {
  /** True only when the open set equals the expected set exactly. */
  pass: boolean;
  /** Every open port, ascending. */
  open: number[];
  /** Expected ports that are not open, ascending. */
  missing: number[];
  /** Open ports that are not expected, ascending. */
  extra: number[];
}

function ascending(values: Iterable<number>): number[] {
  return [...values].sort((a, b) => a - b);
}

/** Exact-set verdict: an extra open port fails, and so does a missing expected port. */
export function verdict(expected: readonly number[], open: readonly number[]): Verdict {
  const want = new Set(expected);
  const got = new Set(open);
  const missing = ascending([...want].filter((port) => !got.has(port)));
  const extra = ascending([...got].filter((port) => !want.has(port)));
  return {
    pass: missing.length === 0 && extra.length === 0,
    open: ascending(got),
    missing,
    extra,
  };
}
