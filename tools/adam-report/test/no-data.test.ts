import { describe, expect, it } from 'vitest';
import { computeReport } from '../src/report.ts';
import type { Criteria, Manifest, RunData } from '../src/types.ts';
import { criteria, manifest } from './fixture.ts';

/** No rows at all: a life that never wrote a thought, an intent, an action, a receipt or an event. */
const NO_DATA: RunData = { thoughts: [], intents: [], actions: [], receipts: [], events: [] };

const RESTARTS: Manifest['restarts'] = [
  { atMs: 1, kind: 'planned' },
  { atMs: 2, kind: 'body' },
];

const variants: { name: string; criteria: Criteria; manifest: Manifest }[] = [
  { name: 'every criterion answered, no restarts', criteria: criteria(), manifest: manifest() },
  {
    name: 'every criterion answered, with both restarts in the manifest',
    criteria: criteria(),
    manifest: manifest({ restarts: RESTARTS }),
  },
  {
    name: 'the gap threshold answered as 3600 s',
    criteria: criteria({ maxGapSeconds: 3600 }),
    manifest: manifest({ restarts: RESTARTS }),
  },
  {
    name: 'every criterion pending (null)',
    criteria: criteria({
      survivalDays: null,
      deathFailsRun: null,
      latencyP95MaxMs: null,
      latencyHardLimitMs: null,
      continuousHours: null,
      continuousWorldDays: null,
      intentsWithoutCallMin: null,
    }),
    manifest: manifest(),
  },
];

describe('a run with no data at all', () => {
  it.each(variants)('gives UNKNOWN for every measure: $name', (v) => {
    const report = computeReport({ manifest: v.manifest, criteria: v.criteria, data: NO_DATA });
    expect(report.measures.length).toBeGreaterThan(0);
    for (const m of report.measures) expect(m.verdict, m.id).toBe('UNKNOWN');
  });

  it('never reports a PASS by default, and writes the window as empty', () => {
    const report = computeReport({ manifest: manifest(), criteria: criteria(), data: NO_DATA });
    expect(report.measures.some((m) => m.verdict === 'PASS')).toBe(false);
    expect(report.window).toEqual({ from: '', to: '', thoughtRows: 0, hours: 0 });
    expect(report.run).toEqual({ aborted: false, partial: true });
  });
});
