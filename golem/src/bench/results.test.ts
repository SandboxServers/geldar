import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunMeta } from './meta.ts';
import { collectMeta, commitLabel, parseVersionReply, timeStamp } from './meta.ts';
import {
  appendRows,
  cellAchievedTps,
  findingsOf,
  markdownRow,
  resultFileName,
  summarize,
  writeResults,
} from './results.ts';
import type { CellResult } from './types.ts';

const META: RunMeta = {
  date: '2026-11-09',
  stamp: '20261109T031500Z',
  commit: 'abc1234',
  minecraft: '26.1.2',
  paperBuild: '58',
  mineflayer: '4.39.0',
  pathfinder: '2.4.5',
  host: { platform: 'win32', release: '10', cpu: 'cpu', cores: 8, totalMem: 1, node: 'v22' },
};

function cellOf(partial: Partial<CellResult> = {}): CellResult {
  return {
    scenario: 'goto-smoke',
    tps: 20,
    runs: 2,
    passed: 1,
    actions: [
      { kind: 'goto', status: 'completed', reason: null, latencyMs: 100, worldTicks: 40 },
      { kind: 'goto', status: 'completed', reason: null, latencyMs: 300, worldTicks: 60 },
      { kind: 'goto', status: 'failed', reason: 'blocked', latencyMs: 900, worldTicks: 90 },
    ],
    actionStats: { goto: { total: 3, completed: 2, failed: { blocked: 1 } } },
    runWallMs: [1, 2],
    failures: [],
    perRun: [],
    notes: [],
    ...partial,
  };
}

const HEAD = '| Date | Commit | Note |';
const TABLE = `# T\n\n${HEAD}\n|---|---|\n| 1 | 2 |\n\nafter\n`;

describe('appendRows', () => {
  it('keeps the header and earlier rows and adds the new row last in the table', () => {
    const out = appendRows(TABLE, ['| 3 | 4 |']);
    expect(out).toBe(`# T\n\n${HEAD}\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nafter\n`);
  });

  it('keeps CRLF as CRLF and LF as LF, and the final newline', () => {
    const crlf = appendRows(TABLE.replace(/\n/g, '\r\n'), ['| 3 | 4 |']);
    expect(crlf).toContain('| 1 | 2 |\r\n| 3 | 4 |\r\n');
    expect(crlf.replace(/\r\n/g, '')).not.toContain('\n');
    expect(crlf.endsWith('\r\n')).toBe(true);
    expect(appendRows(TABLE, ['| 3 | 4 |'])).not.toContain('\r');
    expect(appendRows(`${HEAD}\n|---|`, ['| x |'])).toBe(`${HEAD}\n|---|\n| x |`);
  });

  it('appends to the results table, not to a later table or any other pipe line', () => {
    const doc = `${TABLE}\n| other | table |\n|---|---|\n| z | z |\n`;
    const out = appendRows(doc, ['| 3 | 4 |']);
    expect(out).toContain('| 1 | 2 |\n| 3 | 4 |\n\nafter');
    expect(out.indexOf('| 3 | 4 |')).toBeLessThan(out.indexOf('| other | table |'));
    expect(() => appendRows('| other | table |\n|---|---|\n', ['| x |'])).toThrow(/results table/);
  });

  it('is pure and throws without a table', () => {
    const before = TABLE;
    appendRows(before, ['| 3 | 4 |']);
    expect(before).toBe(TABLE);
    expect(() => appendRows('no table', ['| x |'])).toThrow();
  });
});

describe('markdownRow', () => {
  it('has 12 cells even with a pipe in the note', () => {
    const row = summarize([cellOf()])[0];
    if (!row) throw new Error('no row');
    const text = markdownRow(META, row, { note: 'a|b', file: 'f.json' });
    expect(text.split(/(?<!\\)\|/)).toHaveLength(14);
    expect(text).toContain('a\\|b');
    expect(text).toContain('1/2 (50%)');
    expect(text).toContain('| 100 | 300 |');
  });

  it('prints n/a for a cell with no completed action', () => {
    const row = summarize([cellOf({ actions: [], actionStats: {}, runs: 0, passed: 0 })])[0];
    if (!row) throw new Error('no row');
    const text = markdownRow(META, row, { note: '', file: 'f.json' });
    expect(text).toContain('| n/a | n/a | n/a |');
  });
});

describe('summarize', () => {
  it('takes latency percentiles over completed actions only, in ms and world ticks', () => {
    const row = summarize([cellOf()])[0];
    expect(row?.latencyMs).toEqual({ p50: 100, p95: 300 });
    expect(row?.worldTicks).toEqual({ p50: 40, p95: 60 });
    expect(row?.byKind.goto).toMatchObject({ total: 3, completed: 2, p50: 100 });
    expect(row?.actionsOk).toBe(2);
    expect(row?.actionsTotal).toBe(3);
  });

  it('uses null for an empty list', () => {
    const row = summarize([cellOf({ actions: [], actionStats: {} })])[0];
    expect(row?.latencyMs).toEqual({ p50: null, p95: null });
  });
});

describe('meta', () => {
  it('builds a file name without colons', () => {
    const stamp = timeStamp(new Date('2026-11-09T03:15:00.123Z'));
    expect(stamp).toBe('20261109T031500Z');
    expect(resultFileName({ stamp, commit: 'abc1234+dirty' })).not.toContain(':');
  });

  it('adds +dirty when git status is not empty', () => {
    const git = (dirty: string) => (args: string[]) =>
      args[0] === 'rev-parse' ? 'abc1234\n' : dirty;
    expect(commitLabel(git(' M x.ts\n'))).toBe('abc1234+dirty');
    expect(commitLabel(git(''))).toBe('abc1234');
  });

  it('parses the Paper version reply, and prints unknown otherwise', () => {
    expect(
      parseVersionReply('This server is running Paper version 26.1.2-58-main (MC: 26.1.2)'),
    ).toEqual({ minecraft: '26.1.2', paperBuild: '58' });
    expect(parseVersionReply('Checking version, please wait...')).toEqual({
      minecraft: 'unknown',
      paperBuild: 'unknown',
    });
  });

  it('collects host data and retries the version placeholder', async () => {
    const replies = ['Checking version, please wait...', 'Paper version 26.1.2-58 (MC: 26.1.2)'];
    const meta = await collectMeta(
      { version: async () => replies.shift() ?? '' },
      {
        git: (args) => (args[0] === 'rev-parse' ? 'abc1234' : ''),
        now: () => new Date('2026-11-09T03:15:00Z'),
        sleep: async () => undefined,
      },
    );
    expect(meta).toMatchObject({ date: '2026-11-09', commit: 'abc1234', paperBuild: '58' });
    expect(meta.host.cores).toBeGreaterThan(0);
    expect(JSON.stringify(meta.host)).not.toMatch(/hostname/);
  });
});

const timing = (ageStart: number | null, ageEnd: number | null) => ({
  mspt: null,
  targetMspt: null,
  timeOfDay: null,
  reconnects: 0,
  resetMs: null,
  ageStart,
  ageEnd,
  achievedTps: null,
});
describe('cellAchievedTps', () => {
  it('is the sum of ticks over the sum of wall seconds across the runs', () => {
    const cell = cellOf({
      runWallMs: [3_000, 1_000],
      perRun: [timing(0, 100), timing(100, 120)],
    });
    expect(cellAchievedTps(cell)).toBe(30);
    expect(summarize([cell])[0]?.achievedTps).toBe(30);
  });

  it('is null under 100 ticks in total, without ages and without wall time', () => {
    expect(cellAchievedTps(cellOf({ runWallMs: [1_000], perRun: [timing(0, 80)] }))).toBeNull();
    expect(cellAchievedTps(cellOf({ runWallMs: [5_000], perRun: [timing(null, 200)] }))).toBeNull();
    expect(cellAchievedTps(cellOf({ runWallMs: [0], perRun: [timing(0, 200)] }))).toBeNull();
  });
});

describe('findingsOf age step', () => {
  it('reports the step as observed when the age deltas are multiples of 20', () => {
    const cell = cellOf({ perRun: [timing(7, 107), timing(127, 167)] });
    expect(findingsOf([cell])[0]).toBe(
      'age-step: 20 (every observed age delta is a multiple of it)',
    );
  });

  it('reports a different observed step instead of the assumed 20', () => {
    const cell = cellOf({ perRun: [timing(0, 30), timing(30, 90)] });
    expect(findingsOf([cell])[0]).toBe('age-step: 30 observed, not the assumed 20');
  });
});

describe('findingsOf', () => {
  it('states the age step as assumed or observed and adds a wall-ratio line per slower cell', () => {
    const slow = cellOf({
      tps: 5,
      actions: [
        { kind: 'goto', status: 'completed', reason: null, latencyMs: 400, worldTicks: 20 },
      ],
    });
    expect(findingsOf([cellOf()])).toEqual(['age-step: 20 (standing assumption, not measured)']);
    expect(findingsOf([cellOf(), slow])).toEqual([
      'age-step: 20 (standing assumption, not measured)',
      'wall-ratio: goto-smoke mean action wall time 200 ms at 20 TPS, 400 ms at 5 TPS (ratio 2.00, dilation would give 4.0)',
    ]);
  });

  it('skips a slower cell without a completed action or without a 20 TPS partner', () => {
    expect(findingsOf([cellOf({ tps: 5 })])).toEqual([
      'age-step: 20 (standing assumption, not measured)',
    ]);
    expect(findingsOf([cellOf(), cellOf({ tps: 5, actions: [] })])).toEqual([
      'age-step: 20 (standing assumption, not measured)',
    ]);
  });
});

describe('writeResults', () => {
  it('writes the JSON and, with record, copies it and appends rows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bench-'));
    const doc = join(root, 'docs', 'analysis', 'phase0');
    await import('node:fs/promises').then((fs) => fs.mkdir(doc, { recursive: true }));
    await writeFile(join(doc, 'bench-results.md'), `${HEAD}\n|---|\n`);
    const input = { meta: META, cells: [cellOf()], truncated: false, note: 'n' };

    const plain = await writeResults(input, { root, record: false });
    expect(plain.recordedFile).toBeNull();
    expect(await readFile(join(doc, 'bench-results.md'), 'utf8')).toBe(`${HEAD}\n|---|\n`);

    const done = await writeResults(input, { root, record: true });
    const copy = await readFile(done.recordedFile as string, 'utf8');
    expect(copy).toBe(await readFile(done.file, 'utf8'));
    expect(copy.endsWith('}\n')).toBe(true);
    expect(JSON.parse(copy).summary).toHaveLength(1);
    expect(JSON.parse(copy).meta.worldAgeResolutionTicks).toBe(20);
    expect(JSON.parse(copy).meta.findings).toEqual([
      'age-step: 20 (standing assumption, not measured)',
    ]);
    const table = await readFile(join(doc, 'bench-results.md'), 'utf8');
    expect(table.split('\n')).toHaveLength(4);
    expect(table.startsWith(HEAD)).toBe(true);
    expect(table).toContain('bench-runs/20261109T031500Z-abc1234.json');

    // A cell with no runs (cut off by --max-minutes) is in the JSON but not in the table.
    const empty = cellOf({ scenario: 'idle', runs: 0, passed: 0, actions: [] });
    await writeResults(
      { ...input, cells: [cellOf(), empty], truncated: true },
      { root, record: true },
    );
    const after = await readFile(join(doc, 'bench-results.md'), 'utf8');
    expect(after).toContain('| goto-smoke |');
    expect(after).not.toContain('| idle |');
  });
});
