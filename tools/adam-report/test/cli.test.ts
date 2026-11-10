import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type RunDeps, run } from '../src/cli.ts';
import { fakeDb, lifeTables, T0 } from './fixture.ts';

const FROM = '2026-11-10T00:00:00Z';
const TO = '2026-11-11T00:00:00Z';

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
  run_id: 'run-cli',
  life_id: 'life-1',
  world_seed: 'seed-cli',
  git_sha: 'abc1234',
  model_tags: [{ tag: 'model-a', digest: 'sha256:aa' }],
  shard_config_hash: 'cfg-cli',
  start_time: new Date(T0).toISOString(),
  restarts: [],
  tps_target: 20,
});

describe('the adam-report command line', () => {
  let work: string;
  let manifestPath: string;
  let criteriaPath: string;
  let out: string;
  let logs: string[];
  let connect: ReturnType<typeof vi.fn>;

  /** The full, valid argument list. A test removes or changes one flag from it. */
  const validArgv = (): string[] => [
    '--life', 'life-1', '--from', FROM, '--to', TO,
    '--manifest', manifestPath, '--criteria', criteriaPath, '--out', out,
  ];

  const depsWith = (tables = lifeTables(), failOn?: string): RunDeps => ({
    env: {},
    connect: connect.mockImplementation(() => fakeDb(tables, failOn)),
    now: () => new Date('2026-11-10T10:00:00.000Z'),
    log: (line) => logs.push(line),
  });

  beforeEach(() => {
    work = mkdtempSync(path.join(tmpdir(), 'adam-cli-'));
    manifestPath = path.join(work, 'manifest.json');
    criteriaPath = path.join(work, 'criteria.yaml');
    out = path.join(work, 'out');
    writeFileSync(manifestPath, MANIFEST_JSON, 'utf8');
    writeFileSync(criteriaPath, CRITERIA_YAML, 'utf8');
    logs = [];
    connect = vi.fn();
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  describe('usage errors exit 2 before any connection', () => {
    for (const flag of ['--life', '--from', '--to', '--out', '--manifest']) {
      it(`a missing ${flag} exits 2`, async () => {
        const argv = validArgv();
        const at = argv.indexOf(flag);
        argv.splice(at, 2);
        expect(await run(argv, depsWith())).toBe(2);
        expect(connect).not.toHaveBeenCalled();
        expect(logs.join('\n')).toContain(`missing ${flag}`);
      });
    }

    it('a date without the T separator exits 2', async () => {
      const argv = validArgv().map((v) => (v === FROM ? '2026-11-10' : v));
      expect(await run(argv, depsWith())).toBe(2);
      expect(connect).not.toHaveBeenCalled();
    });

    it('a date that does not parse exits 2', async () => {
      const argv = validArgv().map((v) => (v === TO ? 'T-not-a-time' : v));
      expect(await run(argv, depsWith())).toBe(2);
    });

    it('--from after --to exits 2', async () => {
      const argv = validArgv().map((v) => {
        if (v === FROM) return '2026-11-12T00:00:00Z';
        return v;
      });
      expect(await run(argv, depsWith())).toBe(2);
    });

    it('an --out inside .git is refused with exit 2 and nothing is written', async () => {
      const argv = validArgv().map((v) => (v === out ? path.join(work, '.git', 'report') : v));
      expect(await run(argv, depsWith())).toBe(2);
      expect(connect).not.toHaveBeenCalled();
      expect(existsSync(path.join(work, '.git'))).toBe(false);
    });
  });

  it('a database error from the loader exits 1, names the error, and writes nothing', async () => {
    expect(await run(validArgv(), depsWith(lifeTables(), 'thoughts'))).toBe(1);
    expect(logs.join('\n')).toContain('fake database error on thoughts');
    expect(existsSync(out)).toBe(false);
  });

  it('success exits 0 and writes both files', async () => {
    expect(await run(validArgv(), depsWith())).toBe(0);
    const json = JSON.parse(readFileSync(path.join(out, 'run-report.json'), 'utf8'));
    expect(json.schema).toBe('adam-run-report/1');
    expect(json.generatedAt).toBe('2026-11-10T10:00:00.000Z');
    const md = readFileSync(path.join(out, 'run-report.md'), 'utf8');
    expect(md.startsWith('# Adam run report: run-cli')).toBe(true);
    expect(logs).toHaveLength(2);
  });

  it('a verdict of FAIL does not change the exit code', async () => {
    const tables = lifeTables();
    tables.events = [{ type: 'death', world_day: 0, at: new Date(T0 + 60_000) }];
    expect(await run(validArgv(), depsWith(tables))).toBe(0);
    const json = JSON.parse(readFileSync(path.join(out, 'run-report.json'), 'utf8'));
    expect(json.measures.find((m: { id: string }) => m.id === 'survival').verdict).toBe('FAIL');
  });

  it('UNKNOWN verdicts, with no rows at all, do not change the exit code', async () => {
    expect(await run(validArgv(), depsWith({}))).toBe(0);
    const json = JSON.parse(readFileSync(path.join(out, 'run-report.json'), 'utf8'));
    expect(json.measures.every((m: { verdict: string }) => m.verdict === 'UNKNOWN')).toBe(true);
  });
});
