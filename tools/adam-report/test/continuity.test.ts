import { describe, expect, it } from 'vitest';
import { continuityMeasure, longestGapSeconds } from '../src/continuity.ts';
import type { Restart, ThoughtRow, Verdict } from '../src/types.ts';
import { MIN_MS, T0, thought } from './fixture.ts';

const WIN = 'window';
const HOUR = 3_600_000;
const GAP_LIMIT = 3600;

/** Thoughts from T0, `stepMs` apart, across `hours`; the world day rises evenly to `days` days. */
function series(hours: number, days: number, stepMs = 30 * MIN_MS): ThoughtRow[] {
  const count = Math.round((hours * HOUR) / stepMs) + 1;
  return Array.from({ length: count }, (_, i) =>
    thought(`t${i}`, {
      atMs: T0 + i * stepMs,
      day: Math.floor((i * (days - 1)) / (count - 1)),
    }),
  );
}

const PLANNED: Restart = { atMs: T0 + HOUR, kind: 'planned' };
const BODY: Restart = { atMs: T0 + 2 * HOUR, kind: 'body' };

function measure(thoughts: ThoughtRow[], restarts: Restart[] = [PLANNED, BODY], gap = GAP_LIMIT) {
  return continuityMeasure(
    {
      thoughts,
      restarts,
      continuousHours: 24,
      continuousWorldDays: 5,
      maxGapSeconds: gap,
    },
    WIN,
  );
}

interface Case {
  name: string;
  thoughts: ThoughtRow[];
  restarts?: Restart[];
  gap?: number | null;
  verdict: Verdict;
}

const cases: Case[] = [
  {
    name: '25 h over 6 world days with both restarts and small gaps PASS',
    thoughts: series(25, 6),
    verdict: 'PASS',
  },
  {
    name: 'a run under 24 real hours FAILs once the gap threshold is answered',
    thoughts: series(23, 6),
    verdict: 'FAIL',
  },
  {
    name: 'fewer than 5 world days FAILs',
    thoughts: series(25, 4),
    verdict: 'FAIL',
  },
  {
    name: 'a gap over the threshold FAILs',
    thoughts: series(24, 6, 2 * HOUR),
    verdict: 'FAIL',
  },
  {
    name: 'no planned restart FAILs',
    thoughts: series(25, 6),
    restarts: [BODY],
    verdict: 'FAIL',
  },
  {
    name: 'no Body restart FAILs',
    thoughts: series(25, 6),
    restarts: [PLANNED],
    verdict: 'FAIL',
  },
  {
    name: 'a run under 24 real hours is UNKNOWN while the gap threshold is pending',
    thoughts: series(23, 6),
    gap: null,
    verdict: 'UNKNOWN',
  },
  {
    name: 'a passing-shape run is UNKNOWN while the gap threshold is pending',
    thoughts: series(25, 6),
    gap: null,
    verdict: 'UNKNOWN',
  },
  {
    name: 'fewer than two thoughts is UNKNOWN',
    thoughts: [thought('t0')],
    verdict: 'UNKNOWN',
  },
  {
    name: 'no thoughts is UNKNOWN',
    thoughts: [],
    verdict: 'UNKNOWN',
  },
];

describe('continuity measure', () => {
  it.each(cases)('$name', (c) => {
    const m = measure(c.thoughts, c.restarts, c.gap === undefined ? GAP_LIMIT : c.gap);
    expect(m.verdict).toBe(c.verdict);
  });

  it('reports the longest gap even while the gap threshold is pending', () => {
    const m = measure(series(25, 6), [PLANNED, BODY], null);
    expect(m.values.longest_gap_seconds).toBe(1800);
    expect(m.values.run_hours).toBe(25);
    expect(m.values.world_days).toBe(6);
  });

  it('is UNKNOWN with the pending note when the 24 h criterion is not answered', () => {
    const m = continuityMeasure(
      {
        thoughts: series(25, 6),
        restarts: [PLANNED, BODY],
        continuousHours: null,
        continuousWorldDays: 5,
        maxGapSeconds: GAP_LIMIT,
      },
      WIN,
    );
    expect(m.verdict).toBe('UNKNOWN');
    expect(m.note).toBe('not computed: definition pending');
  });

  it('gives the longest real gap in seconds, and null with fewer than two thoughts', () => {
    expect(longestGapSeconds(series(25, 6))).toBe(1800);
    expect(longestGapSeconds([thought('t0')])).toBeNull();
  });
});
