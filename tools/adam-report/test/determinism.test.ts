import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../src/cli.ts';
import { renderMarkdown, stableJson } from '../src/render.ts';
import { computeReport } from '../src/report.ts';
import { toLiteSnapshot } from '../src/snapshot.ts';
import type { RunData } from '../src/types.ts';
import {
  action,
  criteria,
  event,
  fakeDb,
  intent,
  lifeTables,
  MIN_MS,
  manifest,
  receipt,
  snap,
  T0,
  thought,
} from './fixture.ts';

const CRITERIA_YAML = [
  'survival_days: 1',
  'death_fails_run: true',
  'latency_p95_max_ms: 15000',
  'latency_hard_limit_ms: 25000',
  'continuous_hours: 24',
  'continuous_world_days: 5',
  'max_gap_seconds: null',
  'intents_without_call_min: 3',
  'model_floor_verdict: null',
  '',
].join('\n');

const MANIFEST_JSON = JSON.stringify({
  run_id: 'run-det',
  life_id: 'life-1',
  world_seed: 'seed-det',
  git_sha: 'abc1234',
  model_tags: [
    { tag: 'model-b', digest: 'sha256:bb' },
    { tag: 'model-a', digest: 'sha256:aa' },
  ],
  shard_config_hash: 'cfg-det',
  start_time: new Date(T0).toISOString(),
  restarts: [],
  tps_target: 20,
});

/** Several rows of each kind, in one order. Order matters to the loader, not to the report. */
function manyRows(): RunData {
  const thoughts = Array.from({ length: 6 }, (_, i) =>
    thought(`th-${i}`, {
      atMs: T0 + i * MIN_MS,
      tick: i * 300,
      latencyMs: 1000 + i * 700,
      called: i % 3 !== 2,
      snapshot: toLiteSnapshot(snap({ hunger: 10 + i })),
    }),
  );
  return {
    thoughts,
    intents: [intent('in-1'), intent('in-2', { state: 'failed' }), intent('in-3')],
    actions: [action('ac-1', { intentId: 'in-1' }), action('ac-2', { intentId: 'in-3' })],
    receipts: [receipt('ac-1', 'committed', T0 + MIN_MS), receipt('ac-2', 'committed', T0)],
    events: [event('sleep', 0, T0 + MIN_MS), event('sleep', 0, T0)],
  };
}

const reversed = (data: RunData): RunData => ({
  thoughts: [...data.thoughts].reverse(),
  intents: [...data.intents].reverse(),
  actions: [...data.actions].reverse(),
  receipts: [...data.receipts].reverse(),
  events: [...data.events].reverse(),
});

describe('report determinism', () => {
  let work: string;
  beforeEach(() => {
    work = mkdtempSync(path.join(tmpdir(), 'adam-det-'));
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it('two runs of the same input write the same bytes except generated_at', async () => {
    const criteriaPath = path.join(work, 'criteria.yaml');
    const manifestPath = path.join(work, 'manifest.json');
    writeFileSync(criteriaPath, CRITERIA_YAML, 'utf8');
    writeFileSync(manifestPath, MANIFEST_JSON, 'utf8');
    const argv = (out: string) => [
      '--life',
      'life-1',
      '--from',
      '2026-11-10T00:00:00Z',
      '--to',
      '2026-11-11T00:00:00Z',
      '--manifest',
      manifestPath,
      '--criteria',
      criteriaPath,
      '--out',
      out,
    ];
    const tables = lifeTables();
    const outA = path.join(work, 'a');
    const outB = path.join(work, 'b');
    const depsAt = (now: string) => ({
      env: {},
      connect: () => fakeDb(tables),
      now: () => new Date(now),
      log: () => undefined,
    });
    expect(await run(argv(outA), depsAt('2026-11-10T10:00:00.000Z'))).toBe(0);
    expect(await run(argv(outB), depsAt('2026-11-10T11:00:00.000Z'))).toBe(0);

    const jsonA = JSON.parse(readFileSync(path.join(outA, 'run-report.json'), 'utf8'));
    const jsonB = JSON.parse(readFileSync(path.join(outB, 'run-report.json'), 'utf8'));
    expect(jsonA.generatedAt).not.toBe(jsonB.generatedAt);
    delete jsonA.generatedAt;
    delete jsonB.generatedAt;
    expect(stableJson(jsonA)).toBe(stableJson(jsonB));

    const mdA = readFileSync(path.join(outA, 'run-report.md'), 'utf8');
    const mdB = readFileSync(path.join(outB, 'run-report.md'), 'utf8');
    const dropHeader = (md: string) => md.replace(/^- Generated at: .*$/m, '');
    expect(mdA).not.toBe(mdB);
    expect(dropHeader(mdA)).toBe(dropHeader(mdB));
  });

  it('stable ordering: shuffled input rows and manifest tags give the same bytes', () => {
    const data = manyRows();
    const base = { manifest: manifest(), criteria: criteria(), data };
    const shuffled = {
      manifest: { ...manifest(), modelTags: [...manifest().modelTags].reverse() },
      criteria: criteria(),
      data: reversed(data),
    };
    const a = computeReport(base);
    const b = computeReport(shuffled);
    expect(stableJson(b)).toBe(stableJson(a));
    expect(renderMarkdown(b, 'FIXED')).toBe(renderMarkdown(a, 'FIXED'));
  });

  it('the receipt note names the smallest offending action id whatever the row order', () => {
    const data = manyRows();
    const names = (rows: RunData) =>
      computeReport({ manifest: manifest(), criteria: criteria(), data: rows }).measures.find(
        (m) => m.id === 'receipts',
      )?.note;
    expect(names(data)).toBe('economic action ac-1 has no prepared receipt');
    expect(names(reversed(data))).toBe('economic action ac-1 has no prepared receipt');
  });
});
