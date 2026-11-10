import { describe, expect, it } from 'vitest';
import { latencyMeasure, percentile } from '../src/calls.ts';
import type { ThoughtRow, Verdict } from '../src/types.ts';
import { PENDING } from '../src/types.ts';
import { MIN_MS, T0, thought } from './fixture.ts';

const WIN = 'window';
const P95_MAX = 15000;
const HARD = 25000;

/** A called thought with the given latency; the id carries the index so rows stay distinct. The
 * i-th call is i minutes after T0, so `n` calls span n-1 minutes. */
const took = (i: number, ms: number): ThoughtRow =>
  thought(`t${i}`, { called: true, latencyMs: ms, atMs: T0 + i * MIN_MS });
/** `n` thoughts at `ms` each. */
const many = (n: number, ms: number): ThoughtRow[] =>
  Array.from({ length: n }, (_, i) => took(i, ms));

const run = (thoughts: ThoughtRow[]) =>
  latencyMeasure({ thoughts, p95MaxMs: P95_MAX, hardLimitMs: HARD }, WIN);

interface Case {
  name: string;
  thoughts: ThoughtRow[];
  verdict: Verdict;
  values: Record<string, number>;
}

const cases: Case[] = [
  {
    name: 'p95 under 15 s PASS, with p50, p95 and max reported',
    thoughts: many(20, 1000),
    verdict: 'PASS',
    values: { samples: 20, p50_ms: 1000, p95_ms: 1000, max_ms: 1000, over_hard_limit: 0 },
  },
  {
    name: 'p95 over 15 s FAIL',
    thoughts: [...many(10, 1000), ...Array.from({ length: 10 }, (_, i) => took(100 + i, 16000))],
    verdict: 'FAIL',
    values: { samples: 20, p95_ms: 16000, max_ms: 16000, over_hard_limit: 0 },
  },
  {
    name: 'p95 exactly at the limit is not under it: FAIL',
    thoughts: many(20, P95_MAX),
    verdict: 'FAIL',
    values: { p95_ms: P95_MAX },
  },
  {
    name: 'one thought over the 25 s hard limit FAILs and is flagged',
    thoughts: [...many(19, 1000), took(99, 26000)],
    verdict: 'FAIL',
    values: { p95_ms: 1000, max_ms: 26000, over_hard_limit: 1 },
  },
  {
    name: 'exactly the hard limit is not a breach',
    thoughts: [...many(19, 1000), took(99, HARD)],
    verdict: 'PASS',
    values: { over_hard_limit: 0 },
  },
  {
    name: 'an errored call is excluded from latency and counted apart',
    thoughts: [...many(20, 1000), thought('e1', { called: true, errored: true, latencyMs: 90000 })],
    verdict: 'PASS',
    values: { samples: 20, max_ms: 1000, errored_calls: 1 },
  },
  {
    name: 'fewer than 20 timed calls cannot PASS: UNKNOWN',
    thoughts: many(19, 1000),
    verdict: 'UNKNOWN',
    values: { samples: 19 },
  },
  {
    name: '20 calls inside 10 minutes cannot PASS: UNKNOWN',
    thoughts: Array.from({ length: 20 }, (_, i) =>
      thought(`t${i}`, { called: true, latencyMs: 1000, atMs: T0 + (i % 9) * MIN_MS }),
    ),
    verdict: 'UNKNOWN',
    values: { samples: 20 },
  },
  {
    name: 'a FAIL stands on a few calls: 3 calls over the hard limit FAIL',
    thoughts: [took(0, 26000), took(1, 1000), took(2, 1000)],
    verdict: 'FAIL',
    values: { over_hard_limit: 1 },
  },
  {
    name: 'no thoughts is UNKNOWN',
    thoughts: [],
    verdict: 'UNKNOWN',
    values: { samples: 0 },
  },
  {
    name: 'only tired cycles (no model call) is UNKNOWN',
    thoughts: [thought('t1', { called: false, latencyMs: null })],
    verdict: 'UNKNOWN',
    values: { samples: 0 },
  },
];

describe('thought latency measure', () => {
  it.each(cases)('$name', (c) => {
    const m = run(c.thoughts);
    expect(m.verdict).toBe(c.verdict);
    expect(m.values).toMatchObject(c.values);
  });

  it('gives UNKNOWN with the pending note when the p95 criterion is not answered', () => {
    const m = latencyMeasure({ thoughts: many(5, 1000), p95MaxMs: null, hardLimitMs: HARD }, WIN);
    expect(m.verdict).toBe('UNKNOWN');
    expect(m.note).toBe(PENDING);
  });

  it('uses the nearest-rank percentile', () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(ten, 50)).toBe(5);
    expect(percentile(ten, 95)).toBe(10);
    expect(percentile([], 50)).toBeNull();
  });
});
