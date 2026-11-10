import { describe, expect, it } from 'vitest';
import { type BenchFile, checkBench, newestBenchFile } from './bench-gate.ts';

const HEAD = 'eba101b2f00dcafe1234567890abcdef12345678';
const SCENARIOS = ['wood-to-stone-tools', 'food', 'shelter', 'bed', 'chest', 'blocked-path'];

/** A synthetic result in the bench writer's shape: meta.commit, truncated, summary rows per scenario and TPS. */
function result(
  over: { commit?: string; truncated?: boolean; pct20?: Record<string, number> } = {},
) {
  const summary = SCENARIOS.flatMap((scenario) =>
    [20, 10, 5].map((tps) => ({
      scenario,
      tps,
      runs: 5,
      passed: 5,
      successPct: tps === 20 ? (over.pct20?.[scenario] ?? 100) : 100,
    })),
  );
  return {
    meta: { stamp: '20261110T024026Z', commit: over.commit ?? 'eba101b' },
    truncated: over.truncated ?? false,
    note: '',
    cells: [],
    summary,
  };
}

const file = (json: unknown, name = '20261110T024026Z-eba101b.json'): BenchFile => ({
  file: name,
  text: typeof json === 'string' ? json : JSON.stringify(json),
});

describe('newestBenchFile', () => {
  it('picks the newest timestamp in the name, not the order given', () => {
    const names = [
      '20261109T233614Z-35e16c0.json',
      '20261110T024026Z-898b9b9.json',
      '20261110T010000Z-aaaaaaa.json',
    ];
    expect(newestBenchFile(names)).toBe('20261110T024026Z-898b9b9.json');
    expect(newestBenchFile([...names].reverse())).toBe('20261110T024026Z-898b9b9.json');
  });

  it('ignores names without the result form, and returns null when none is left', () => {
    expect(newestBenchFile(['notes.md', 'latest.json', '20261110T024026Z.json'])).toBeNull();
    expect(newestBenchFile([])).toBeNull();
    expect(newestBenchFile(['junk.json', '20261109T000000Z-abcdef0.json'])).toBe(
      '20261109T000000Z-abcdef0.json',
    );
  });
});

describe('checkBench', () => {
  it('passes a complete run at HEAD with every 20 TPS row at 100%, and records the rows', () => {
    const verdict = checkBench(file(result()), HEAD);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.summary.file).toBe('20261110T024026Z-eba101b.json');
      expect(verdict.summary.commit).toBe('eba101b');
      expect(verdict.summary.tps20).toEqual(
        SCENARIOS.map((s) => ({ scenario: s, successPct: 100 })),
      );
    }
  });

  it('refuses when there is no bench file, and names the benchmark to run', () => {
    const verdict = checkBench(null, HEAD);
    expect(verdict).toEqual({
      ok: false,
      problems: [
        'benchmark gate: no bench-results/*.json file; run OPS-0 (the 20 TPS benchmark) first',
      ],
    });
  });

  it.each<[string, BenchFile, string]>([
    ['a file that is not JSON', file('{"meta":'), 'is not valid JSON'],
    ['JSON that is not a bench result', file({ hello: 1 }), 'has no meta.commit'],
    ['a result with no summary rows', file({ ...result(), summary: 'x' }), 'has no summary rows'],
    [
      'a truncated run',
      file(result({ truncated: true })),
      'is a truncated run; re-run OPS-0 to completion',
    ],
  ])('refuses %s', (_label, bench, expected) => {
    const verdict = checkBench(bench, HEAD);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.problems).toEqual([expect.stringContaining(expected)]);
  });

  it('refuses a result recorded at another commit, and shows both short shas', () => {
    const verdict = checkBench(file(result({ commit: '898b9b9' })), HEAD);
    expect(verdict).toEqual({
      ok: false,
      problems: [
        'benchmark gate: 20261110T024026Z-eba101b.json was recorded at 898b9b9, HEAD is eba101b; re-run OPS-0 at HEAD',
      ],
    });
  });

  it('refuses a 20 TPS cell below 100%, and lists that cell', () => {
    const verdict = checkBench(file(result({ pct20: { 'blocked-path': 80 } })), HEAD);
    expect(verdict).toEqual({
      ok: false,
      problems: ['benchmark gate: 20 TPS blocked-path is 80% success, not 100%; re-run OPS-0'],
    });
  });

  it('lists every failing 20 TPS cell and ignores failures at 10 and 5 TPS', () => {
    const json = result({ pct20: { food: 60, bed: 0 } });
    const rows = json.summary.map((row) => (row.tps === 5 ? { ...row, successPct: 20 } : row));
    const verdict = checkBench(file({ ...json, summary: rows }), HEAD);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.problems).toEqual([
        'benchmark gate: 20 TPS food is 60% success, not 100%; re-run OPS-0',
        'benchmark gate: 20 TPS bed is 0% success, not 100%; re-run OPS-0',
      ]);
    }
  });

  it('refuses a run with no 20 TPS rows at all', () => {
    const json = result();
    const rows = json.summary.filter((row) => row.tps !== 20);
    const verdict = checkBench(file({ ...json, summary: rows }), HEAD);
    expect(verdict).toEqual({
      ok: false,
      problems: ['benchmark gate: 20261110T024026Z-eba101b.json has no 20 TPS rows; re-run OPS-0'],
    });
  });
});
