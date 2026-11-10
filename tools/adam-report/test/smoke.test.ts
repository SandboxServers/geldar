import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCriteria } from '../src/config.ts';
import { renderMarkdown, stableJson } from '../src/render.ts';
import { computeReport } from '../src/report.ts';
import type { Manifest, RunData } from '../src/types.ts';

const criteria = parseCriteria(readFileSync(new URL('../criteria.yaml', import.meta.url), 'utf8'));

const manifest: Manifest = {
  runId: 'run-smoke',
  lifeId: 'life-smoke',
  worldSeed: 'seed-smoke',
  gitSha: '0000000',
  modelTags: [],
  shardConfigHash: 'hash-smoke',
  startTimeMs: 0,
  restarts: [],
  tpsTarget: 20,
};

const empty: RunData = { thoughts: [], intents: [], actions: [], receipts: [], events: [] };

describe('adam report pipeline on an empty snapshot', () => {
  it('gives UNKNOWN for every measure, never PASS by default', () => {
    const report = computeReport({ manifest, criteria, data: empty });
    expect(report.measures.map((m) => m.id)).toEqual([
      'survival',
      'intents',
      'receipts',
      'resume',
      'model_floor',
      'calls',
      'latency',
      'continuity',
    ]);
    for (const m of report.measures) expect(m.verdict, m.id).toBe('UNKNOWN');
  });

  it('is byte-stable for the same input and writes the pending note for an unanswered threshold', () => {
    const first = stableJson(computeReport({ manifest, criteria, data: empty }));
    const second = stableJson(computeReport({ manifest, criteria, data: empty }));
    expect(second).toBe(first);
    const md = renderMarkdown(
      computeReport({ manifest, criteria, data: empty }),
      '2026-01-01T00:00:00.000Z',
    );
    expect(md).toContain('not computed: definition pending');
    expect(md).toContain('Generated at: 2026-01-01T00:00:00.000Z');
  });
});
