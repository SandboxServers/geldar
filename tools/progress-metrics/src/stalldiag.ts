/** The diagnostic fields of a `stall_diag` line that the report reads. Missing or mistyped fields are null. */
export type StallDiag = {
  control: string | null;
  below: string | null;
  at: string | null;
  corrections10s: number | null;
  ticksSinceCorrection: number | null;
  pathStatus: string | null;
  recovery: string | null;
};

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** `blocks` is an object with `below` and `at` block ids. */
export function readStallDiag(o: Record<string, unknown>): StallDiag {
  const blocks =
    typeof o.blocks === 'object' && o.blocks !== null ? (o.blocks as Record<string, unknown>) : {};
  return {
    control: str(o.control),
    below: str(blocks.below),
    at: str(blocks.at),
    corrections10s: numOrNull(o.corrections_10s),
    ticksSinceCorrection: numOrNull(o.ticks_since_correction),
    pathStatus: str(o.path_status),
    recovery: str(o.recovery),
  };
}

/** Stall lines with this many or more position corrections in 10 s count as rubber-banding lines. */
export const HIGH_CORRECTIONS = 10;
/** An agent is flagged when at least this share of its stall lines (with a corrections value) are high. */
export const RUBBER_SHARE = 0.5;
export const RUBBER_MIN_LINES = 2;
